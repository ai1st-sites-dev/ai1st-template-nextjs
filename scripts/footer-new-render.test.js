#!/usr/bin/env node
/**
 * footer-new-render.test.js — #1455 验收 1–4 里「只看渲染出来的 HTML 就能判」的那几条。
 *
 * 跑法:  node scripts/footer-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么是单测而不是只在图册上量：验收 3 / 4 要的是**数据的变体**（服务列空、`contact: false`、
 * `nav` 空、`contact` 整个为空），图册只有一份演示内容，按构造造不出这些。这里直接拿组件在 node 里
 * 渲染（`ts.transpileModule` + `renderToStaticMarkup`，`block-slots.test.js` 同一种做法）。
 * 几何那几条（reverse 贴右、三端、横向滚动、purge）要浏览器：#1458 起整页图册退役，它们归 admin › Blocks & Themes
 * 那条 e2e（`tests/e2e/specs/1458-admin-fixed-regions.spec.ts`，单格页 `/__catalog/footer-new/<形态>`）。
 *
 * 🔴 每一段都带一格反向对照（同一进程、单变量），证明判据真会红：一道只在真组件上跑的检查恒绿时，
 *    「它在起作用」和「它瞎了」给出同一个读数。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const SECTION = path.join(NEXT, 'blocks', 'footer-new', 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx（源码可以在内存里替换，反向对照用）──────────────────────────────
const sourceOverride = new Map();
function compile(filename) {
  const src = sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8');
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
}
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(compile(filename), filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  const mod = require(SECTION);
  return { C: mod.default, SHAPES: mod.SHAPES };
}

let C; let SHAPES; let DEMO;
try {
  ({ C, SHAPES } = loadSection());
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['footer-new'];
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 footer-new 那一份');

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, { shape, data }));
const count = (html, needle) => html.split(needle).length - 1;

const shapes = Object.keys(SHAPES);
// 夹具：演示内容去掉两个可选部件（它们在第 ② 段单独开关）。
const base = clone(DEMO);
delete base.cta;
delete base.newsletter;

// ══ ① 验收 1：4 个形态两两不同；dark / reverse 各自让每个形态的 HTML 变 ═══════════════════════
console.log('① 4 个形态两两不同 · dark / reverse 各改每个形态的 HTML');
check(shapes.length === 4 && ['slim-row', 'centered', 'columns', 'minimal'].every((s) => shapes.includes(s)),
  `形态表是定稿那 4 个（${shapes.join(' · ')}）`);
{
  const htmls = shapes.map((s) => render(s, base));
  check(new Set(htmls).size === shapes.length, `同一份夹具下 ${shapes.length} 个形态的 HTML 两两不同（${new Set(htmls).size} 种）`);
  for (const opt of ['dark', 'reverse']) {
    const same = shapes.filter((s, i) => render(s, { ...base, options: { [opt]: true } }) === htmls[i]);
    check(same.length === 0, `勾上 ${opt}：4 个形态的 HTML 全都变了`, `没变的：${same.join(' · ')}`);
  }
  // reverse 下 columns 品牌列的整列靠右（贴右边缘的几何在浏览器那份脚本里量，这里钉 class）。
  const rev = render('columns', { ...base, options: { reverse: true } });
  check(/data-footer-col="brand"/.test(rev) && /class="[^"]*align-items-end text-end[^"]*" data-footer-col="brand"/.test(rev),
    'reverse：columns 的品牌列带 align-items-end + text-end（整列靠右，不只是文字右对齐）');
  // 反向对照：把 dark 那个开关从组件里拿掉（读成恒 false），上面那条必须红。
  const broken = fs.readFileSync(SECTION, 'utf-8').replace("const { dark = false, reverse = false } = data.options || {};",
    'const dark = false; const { reverse = false } = data.options || {};');
  if (broken === fs.readFileSync(SECTION, 'utf-8')) bad('反向对照没改到源码（锚点找不到）—— 这一格什么都没证明');
  else {
    const { C: Cb } = loadSection(broken);
    const same = shapes.filter((s) => render(s, { ...base, options: { dark: true } }, Cb) === render(s, base, Cb));
    check(same.length === 4, `反向对照：组件不读 dark ⟹ 4 个形态都被点名「没变」（${same.length}/4）`);
    loadSection();
  }
}

// ══ ② 验收 2：cta 三种 style 各出一种、不同时出现；newsletter 的位置 ═══════════════════════════════
console.log('\n② 可选部件：cta 条 · 订阅框');
for (const s of shapes) {
  const none = render(s, base);
  check(count(none, 'data-footer-cta=') === 0, `${s}：cta 空 ⟹ 顶上什么都没有`);
  for (const style of ['band', 'bar', 'row']) {
    const h = render(s, { ...base, cta: { ...DEMO.cta, style } });
    const got = ['band', 'bar', 'row'].filter((x) => h.includes(`data-footer-cta="${x}"`));
    check(got.length === 1 && got[0] === style, `${s}：cta.style=${style} ⟹ 只出 ${style}`, `出了 ${got.join(' + ') || '（没有）'}`);
    // CTA 条在最顶上：它是 <footer> 的第一个子元素。（不锚 `^`：React 19 会把 logo 的 `<link rel="preload">`
    // 提到最前面，那一行不在 <footer> 里。）
    check(new RegExp(`<footer[^>]*><div[^>]*data-footer-cta="${style}"`).test(h), `${s}：${style} 是页脚里的第一个部件`, h.slice(0, 260));
  }
  check(count(none, 'data-footer-newsletter') === 0, `${s}：newsletter 空 ⟹ 没有订阅框`);
  const nl = render(s, { ...base, newsletter: DEMO.newsletter });
  const n = count(nl, 'data-footer-newsletter');
  if (s === 'slim-row') check(n === 0, 'slim-row：newsletter 有值也不渲染（没地方）', `出了 ${n} 个`);
  else check(n === 1, `${s}：newsletter 有值 ⟹ 恰好 1 个订阅框`, `出了 ${n} 个`);
}
{
  // 位置：columns 挂品牌列里；centered 在联系一行之后；minimal 在按钮之后。
  const withNl = { ...base, newsletter: DEMO.newsletter, cta: { ...DEMO.cta, style: 'band' } };
  const col = render('columns', withNl);
  const brandStart = col.indexOf('data-footer-col="brand"');
  const brandEnd = col.indexOf('data-footer-col="services"');
  const at = col.indexOf('data-footer-newsletter');
  check(brandStart > 0 && at > brandStart && at < brandEnd, 'columns：订阅框在品牌列里（服务列之前）');
  const cen = render('centered', withNl);
  check(cen.indexOf('2150 Yonge St, Toronto') > 0 && cen.indexOf('data-footer-newsletter') > cen.indexOf('2150 Yonge St, Toronto'),
    'centered：订阅框在联系一行之后');
  const min = render('minimal', withNl);
  const bodyStart = min.indexOf('class="container-lg py-12"');
  const btn = min.indexOf(`>${DEMO.cta.buttons[0].label}</a>`, bodyStart);
  check(btn > bodyStart && min.indexOf('data-footer-newsletter') > btn, 'minimal：订阅框在那个按钮之后');
}

// ══ ③ 验收 3：列规矩 ═════════════════════════════════════════════════════════════════════════════
console.log('\n③ columns 的列：空列不渲染');
{
  const cols = (d) => ['services', 'areas', 'pages', 'contact'].filter((k) => render('columns', d).includes(`data-footer-col="${k}"`));
  check(cols(base).join(',') === 'services,areas,pages,contact', `全填：4 列都在（${cols(base).join(' · ')}）`);
  const noSvc = clone(base); noSvc.columns.services = [];
  check(cols(noSvc).join(',') === 'areas,pages,contact', `columns.services 空 ⟹ 服务列不渲染、其余照常（${cols(noSvc).join(' · ')}）`);
  const noContact = clone(base); noContact.columns.contact = false;
  check(cols(noContact).join(',') === 'services,areas,pages', `contact:false ⟹ 联系列不渲染（${cols(noContact).join(' · ')}）`);
  const noNav = clone(base); noNav.nav = [];
  check(cols(noNav).join(',') === 'services,areas,contact', `nav 空 ⟹ pages 列不渲染（${cols(noNav).join(' · ')}）`);
}

// ══ ④ 验收 4：联系信息每个形态都在；contact 整个为空 ⟹ 没有空图标、没有空行 ═══════════════════
console.log('\n④ 联系信息');
{
  const phone = DEMO.contact.phone;
  for (const s of shapes) check(render(s, base).includes(phone), `${s}：HTML 里有电话 ${phone}`);
  // 联系列不出的时候（contact:false），columns 仍要有电话：挂到品牌列里。
  const noContact = clone(base); noContact.columns.contact = false;
  check(render('columns', noContact).includes(phone), 'columns + contact:false：电话仍在（挂进品牌列）');
  const empty = { ...base, contact: {} };
  const icons = ['bi-telephone', 'bi-geo-alt', 'bi-clock', 'bi-envelope'];
  for (const s of shapes) {
    const h = render(s, empty);
    const left = icons.filter((i) => h.includes(i));
    check(left.length === 0, `${s}：contact 为空 ⟹ 没有联系图标`, `还剩 ${left.join(' · ')}`);
    // 空行：一个没有任何子节点的 flex 容器（`<div class="d-flex …"></div>`）。
    const emptyBoxes = (h.match(/<(div|span|ul)[^>]*><\/\1>/g) || []);
    check(emptyBoxes.length === 0, `${s}：contact 为空 ⟹ 没有空的容器`, emptyBoxes.slice(0, 3).join(' '));
  }
  // 反向对照：把「空的不渲染」拿掉（地址恒渲染），空图标那一条必须红。
  const src = fs.readFileSync(SECTION, 'utf-8');
  const broken = src.replace("contact.address ? { key: 'address', icon: 'bi-geo-alt', text: contact.address } : null,",
    "{ key: 'address', icon: 'bi-geo-alt', text: contact.address || '' },");
  if (broken === src) bad('反向对照没改到源码（锚点找不到）—— 这一格什么都没证明');
  else {
    const { C: Cb } = loadSection(broken);
    const hit = shapes.filter((s) => render(s, empty, Cb).includes('bi-geo-alt'));
    check(hit.length > 0, `反向对照：地址空也渲染 ⟹ 有形态被点名留着空图标（${hit.join(' · ')}）`);
    loadSection();
  }
}

console.log(`\n${fail ? '🔴' : '✅'} footer-new-render: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
