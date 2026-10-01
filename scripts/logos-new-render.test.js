#!/usr/bin/env node
/**
 * logos-new-render.test.js — #1496 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/logos-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（4 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立）· AC3 的 DOM 与规则一半（sm 时正文照画、
 * 字号规则）· AC4 / AC5 / AC6 的规则一半（row 间距、grid 列数、itemsColumns 在 row 下不起作用、logoColor 滤镜）·
 * AC7（链接）· AC8（bg + 不自己算亮度 / 拼渐变）· AC9（validateSite）· AC10（block-roles · 首页配方池）·
 * AC12 的编辑器 schema 一半 · AC13（trusted-brands / hero-new 零改动）。
 * 几何与计算样式（16 种组合三端无横向滚动、sm 字号与可见、row 行距 == 列距、grid 列数、filter、计算色）要浏览器：
 * `tests/e2e/specs/1496-logos-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 8）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'logos-new');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const pending = []; // 要 await 的格子（建站选图那一条是 async），汇总前一起等完

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 milestones-render.test.js）──────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.logos-new-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

let C; let DEMO; let manifestLib; let M;
try {
  C = require(SECTION).default;
  const demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  DEMO = demo.DEMO_CONTENT['logos-new'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('logos-new');
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 logos-new');
if (!M) die('blocks/ 里没有 logos-new');

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (shape, data) => renderToStaticMarkup(React.createElement(C, {
  data, locale: 'en', block: { id: 'l', type: 'logos-new', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("logos-new")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'introSize', 'itemsLayout', 'itemsColumns', 'itemStyle', 'logoColor'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：4 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立 ═══════════════════════════════════
console.log('── AC1 四个预设');
{
  // 列：名字 · 形态目录 · introPosition · introAlign · introSize · itemsLayout · itemsColumns · itemStyle · logoColor（正文预设表逐字）
  const WANT = [
    ['Strip', 'strip', 'top', 'center', 'sm', 'row', '4', 'plain', 'mono'],
    ['Grid', 'grid', 'top', 'center', 'lg', 'grid', '3', 'plain', 'mono'],
    ['Cards', 'cards', 'top', 'center', 'lg', 'grid', '3', 'card', 'original'],
    ['Side intro', 'side-intro', 'left', 'left', 'sm', 'grid', '3', 'plain', 'mono'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 4 条与正文表逐字相同（名字 · 形态 · 七列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这七个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']], ['introSize', ['sm', 'lg']],
    ['itemsLayout', ['row', 'grid']], ['itemsColumns', ['3', '4', '6']],
    ['itemStyle', ['plain', 'card']], ['logoColor', ['mono', 'original']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与旋钮表逐字（values[0] = 默认）`);
  check(M.parts === undefined, `没有部件（parts 不写；${JSON.stringify(M.parts)}）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 4 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 4, `同一份夹具下 4 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  // 反向对照：夹具里写死七个旋钮 ⟹ 形态不再起作用，4 份（去掉 data-shape）应当塌成 1 份。
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死七个旋钮 ⟹ 4 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('strip', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Strip：七个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余六个不变（组件里没有联动纠正）。
  const base = M.presets[2].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('cards', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Cards 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余六个不变`, moved.join(' · '));
  const client = (SRC_TEXT.match(/use client|useState/g) || []).length;
  check(client === 0, `Section.tsx 里 grep -c "use client\\|useState" = ${client}（纯服务端组件）`);
}

// ══ AC3（DOM 与规则一半）：introSize ════════════════════════════════════════════════════════════════
console.log('\n── AC3 introSize');
{
  const sm = render('strip', clone(DEMO));
  check(sm.includes('data-slot="headline"') && sm.includes('data-slot="body"') && sm.includes(esc(DEMO.body)),
    'introSize=sm（Strip）：标题和正文节点都在（sm 不藏内容，Chris 2026-09-30）');
  const lg = render('grid', clone(DEMO));
  check(sm.replace(/data-(shape|intro-size|items-layout|items-columns)="[^"]*"/g, '') === lg.replace(/data-(shape|intro-size|items-layout|items-columns)="[^"]*"/g, ''),
    'sm / lg 同一份 markup（Strip 与 Grid 去掉那几个旋钮属性之后逐字相同）—— 区别全在根上的 data-intro-size');
  check(/\[data-intro-size="sm"\] \.lo-title \{\s*font-size: 1\.125rem !important;\s*font-weight: 600 !important;/.test(CSS), 'block.css：sm 时标题 1.125rem / 600');
  check(/\[data-intro-size="sm"\] \.lo-body \{\s*font-size: 0\.9375rem !important;/.test(CSS), 'block.css：sm 时正文 .9375rem');
  check(!/\[data-intro-size="sm"\][^{]*\{[^}]*display:\s*none/.test(CSS), 'block.css：没有任何 sm 规则藏东西（display: none 0 处）');
  check(/class="display-5 [^"]*lo-title"/.test(lg), 'lg：标题是正常大标题（display-5）');
}

// ══ AC4 / AC5 / AC6（规则与 DOM 一半）═══════════════════════════════════════════════════════════════
console.log('\n── AC4 / AC5 / AC6 row · grid · logoColor 规则');
{
  check(/\[data-items-layout="row"\] \.lo-grid \{\s*display: flex;\s*flex-wrap: wrap;\s*justify-content: center;\s*gap: 1rem;/.test(CSS),
    'row：flex 换行、居中、gap 1rem（上下左右同一个间距）');
  check(/\[data-items-layout="row"\] \.lo-inner \{\s*padding: 0 0\.75rem;/.test(CSS), 'row：logo 左右内边距 .75rem');
  check(/\[data-items-layout="grid"\] \.lo-grid \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/.test(CSS)
    && /min-width: 768px\) \{\s*\[data-block="logos-new"\]\[data-items-layout="grid"\] \.lo-grid \{\s*grid-template-columns: repeat\(3,/.test(CSS)
    && /\[data-items-layout="grid"\]\[data-items-columns="6"\] \.lo-grid \{\s*grid-template-columns: repeat\(6,/.test(CSS),
    'grid：手机 2 列 · ≥768 3 列 · ≥992 按 itemsColumns（4 / 6）');
  check(!/\[data-items-layout="row"\][^{]*\[data-items-columns=/.test(CSS) && !/\[data-items-columns="[^"]+"\](?!\s*\.lo-grid)/.test(CSS.replace(/\[data-items-layout="grid"\]\[data-items-columns="[46]"\] \.lo-grid/g, '')),
    'itemsColumns 只出现在 grid 的选择器里（row 下没有规则认它）');
  const rowOf = (cols) => render('strip', withOpts({ itemsColumns: cols }));
  const strip = (h) => h.replace(/ data-items-columns="[^"]*"/, '');
  check(strip(rowOf('3')) === strip(rowOf('6')) && strip(rowOf('4')) === strip(rowOf('6')) && rowOf('3') !== rowOf('6'),
    'itemsLayout=row 时拧 itemsColumns 3 / 4 / 6：HTML 除 data-items-columns 外逐字相同（不起作用、不报错）');
  check(/\[data-logo-color="mono"\] \.lo-logo \{\s*filter: grayscale\(1\);\s*opacity: 0\.6;/.test(CSS), '浅底 mono：grayscale(1) + 60% 不透明');
  check(/\[data-tone="dark"\]\[data-logo-color="mono"\] \.lo-logo,[\s\S]*?\{\s*filter: brightness\(0\) invert\(1\);/.test(CSS), '深底 mono：brightness(0) invert(1)');
  check(!/\[data-logo-color="original"\]/.test(CSS), 'original：没有任何规则给它加滤镜');
  check(/\[data-item-style="card"\] \.lo-inner \{\s*background: #fff;\s*border: 1px solid[^;]*;\s*border-radius: 1rem;\s*height: 6rem;/.test(CSS)
    && /\.lo-inner \{\s*height: 4\.5rem;/.test(CSS), 'card：白底 1px 描边 1rem 圆角 高 6rem；plain 高 4.5rem');
  check(/\.lo-logo \{\s*display: block;\s*max-height: 2rem;\s*max-width: 100%;/.test(CSS), 'logo 图最高 2rem、不超出格子');
  const imgs = (r = render('strip', clone(DEMO))) => (r.match(/<img [^>]*>/g) || []);
  check(imgs().length === DEMO.items.length && DEMO.items.every((it) => render('strip', clone(DEMO)).includes(`alt="${esc(it.alt)}"`)),
    `每个 logo 一张 <img>，alt 是品牌名（${imgs().length}）`);
  const noImg = withOpts({}, { items: [...clone(DEMO.items), { alt: 'No picture' }] });
  check(imgs(render('strip', noImg)).length === DEMO.items.length && !render('strip', noImg).includes('No picture'), '没有 imageUrl 的那一项不画（没有纯文字兜底）');
}

// ══ AC7：链接 ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 链接');
{
  const h = render('grid', clone(DEMO));
  const cells = itemsOf(h);
  const linked = DEMO.items.map((it) => !!it.href);
  const got = cells.map((c) => /^[^<]*>\s*<a class="lo-inner[^"]*" href="[^"]+" target="_blank" rel="noopener">/.test(c));
  check(JSON.stringify(got) === JSON.stringify(linked) && linked.includes(true) && linked.includes(false),
    `有 href 的格是 <a target="_blank" rel="noopener">、没有的不是（${got.map((x) => (x ? 'a' : '-')).join('')}）`);
  check(cells.filter((c, i) => !linked[i]).every((c) => !/<a\b/.test(c.split('data-part="item"')[0])), '没有 href 的格里没有 <a>');
  check(DEMO.items.filter((it) => it.href).every((it) => h.includes(`href="${esc(it.href)}"`)), 'href 原样写出');
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  const at = (bg) => render('grid', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light（深字）');
  check(attr(at('brand'), 'data-tone') === 'brand' && /style="background:var\(--x-primary\)"/.test(sectionTag(at('brand'))), 'brand ⟹ data-tone="brand"、底色 var(--x-primary)');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark',
    '渐变 {stops:[#7d52f4,#f7b733],angle:135} ⟹ linear-gradient(135deg,…) + data-tone="dark"');
  check(attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), '没写 bg ⟹ light、<section> 没有 style');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处（都调 contrast.js 的共用函数）`);
  const { ON_DEEP_MUTED } = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  check(/\[data-tone="dark"\] \.text-muted,/.test(ON_DEEP_MUTED) && !/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS),
    'dark / brand 时正文白 .92：全站那条（site-css.js §ON_DEEP_MUTED），block.css 里没有自己那份');
  check(/\[data-tone="dark"\] \.lo-title,[\s\S]*?\{\s*color: #fff !important;/.test(CSS), 'block.css：dark / brand 时标题反白');
  check(/\[data-tone="dark"\]\[data-item-style="card"\] \.lo-inner,[\s\S]*?\{\s*background: rgba\(255, 255, 255, 0\.06\);\s*border-color: rgba\(255, 255, 255, 0\.15\);/.test(CSS),
    'block.css：深底 card 半透明底 + 半透明白描边');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer-new').slots.bg), 'bg 槽对象与 footer-new 的 slots.bg 逐字相同');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const logo = (i) => ({ imageUrl: `https://example.com/logo-${i}.svg`, alt: `Brand ${i}` });
  const v = (data, shape) => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'logos-new', ...(shape ? { shape } : {}), data: { headline: 'H', ...data } }] }], scope: 'edit',
  }));
  for (const [n, word] of [[2, '至少要 3 项'], [13, '最多只能有 12 项']]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => logo(i)) });
    check(r.length === 1 && r[0].includes('"items"') && r[0].includes(word), `items ${n} 个 ⟹ 报一条、点名 items（${r.length} 条）`, JSON.stringify(r));
  }
  for (const n of [3, 12]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => logo(i)) });
    check(r.length === 0, `items ${n} 个 ⟹ 放行`, JSON.stringify(r));
  }
  for (const key of ['imageUrl', 'alt']) {
    const items = [logo(1), logo(2), logo(3)]; delete items[1][key];
    const r = v({ items });
    check(r.length === 1 && r[0].includes(`"items" 第 2 项没有 ${key}`), `某项缺 ${key} ⟹ 报一条（点名第几项、缺哪个）`, JSON.stringify(r));
  }
  const blank = [logo(1), logo(2), { imageUrl: 'https://example.com/x.svg', alt: '  ' }];
  check(v({ items: blank }).length === 1, 'alt 只有空白 ⟹ 也算缺');
  const withHref = [logo(1), logo(2), { ...logo(3), href: 'https://example.com' }];
  check(v({ items: withHref }).length === 0, 'href 是可选的：写了放行');
  check(M.slots.items.minItems === 3 && M.slots.items.maxItems === 12 && M.slots.items.max === undefined
    && JSON.stringify(M.slots.items.itemRequires) === '["imageUrl","alt"]',
    'items 用 minItems 3 / maxItems 12 声明（没有 max —— max 是工具栏「数量」那一维）；每项必须有 imageUrl / alt');
  // 反向对照：manifest 里拿掉 itemRequires ⟹ 同一份缺 alt 的数据放行（证明拦它的是这一个声明，不是别的检查）。
  const saved = M.slots.items.itemRequires;
  delete M.slots.items.itemRequires;
  let leak;
  try { const items = [logo(1), logo(2), logo(3)]; delete items[1].alt; leak = v({ items }); } finally { M.slots.items.itemRequires = saved; }
  check(leak.length === 0, `反向对照：去掉 itemRequires ⟹ 缺 alt 的那份放行（${leak.length} 条）—— 拦它的就是这个声明`);
  // manifest 那一侧：itemRequires 里写了 shape 没声明的键 ⟹ 载入时当场红（拷一份块目录进临时目录，只改这一个键）。
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'logos-new-'));
  let thrown = '';
  try {
    fs.cpSync(BLOCK, path.join(tmp, 'logos-new'), { recursive: true });
    const mf = path.join(tmp, 'logos-new', 'manifest.json');
    const raw = JSON.parse(fs.readFileSync(mf, 'utf-8'));
    raw.slots.items.itemRequires = ['imageUrl', 'title'];
    fs.writeFileSync(mf, JSON.stringify(raw));
    try { manifestLib.loadManifests(tmp); } catch (e) { thrown = e.message; }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  check(thrown.includes('itemRequires') && thrown.includes('title'), 'itemRequires 里写了 shape 没声明的键 ⟹ manifest 载入当场红', thrown || '没抛');
  // r2 —— itemRequires 跟 #1495 同一个写法（点号路径）。同一道「shape 里声明过」的检查要认得嵌套键：
  //    `image.imageUrl` 对 `[{image: {imageUrl, alt}, …}]` 放行（gallery-new 那种），拼错的子键照样当场红。
  const loadWith = (patch) => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'logos-new-'));
    try {
      fs.cpSync(BLOCK, path.join(dir, 'logos-new'), { recursive: true });
      const mf = path.join(dir, 'logos-new', 'manifest.json');
      const raw = JSON.parse(fs.readFileSync(mf, 'utf-8'));
      patch(raw.slots.items);
      fs.writeFileSync(mf, JSON.stringify(raw));
      manifestLib.loadManifests(dir);
      return '';
    } catch (e) { return e.message; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const nested = (req) => (it) => { it.shape = '[{image: {imageUrl, alt}, title?, caption?}]'; it.itemRequires = req; };
  check(loadWith(nested(['image.imageUrl'])) === '', '点号路径 image.imageUrl 对嵌套 shape ⟹ 载入放行（#1495 gallery-new 的写法）', loadWith(nested(['image.imageUrl'])));
  const typo = loadWith(nested(['image.imageUri']));
  check(typo.includes('itemRequires') && typo.includes('image.imageUri'), '嵌套路径拼错 image.imageUri ⟹ 载入当场红', typo || '没抛');
  const deep = loadWith(nested(['title.text']));
  check(deep.includes('title.text'), 'title 不是对象（shape 里没有 title: {…}）⟹ title.text 当场红', deep || '没抛');
  check(loadWith((it) => { it.itemRequires = ['image url']; }).includes('itemRequires'), '路径里有空格（不是 字段 / 字段.子字段）⟹ 当场红');
  const r2 = v({ items: [logo(1), logo(2), logo(3)], options: { itemsColumns: 4 } });
  check(r2.length === 1 && r2[0].includes('options.itemsColumns'), 'options.itemsColumns 写成数字 4 ⟹ 报一条（取值是字符串）', JSON.stringify(r2));
  for (const p of M.presets) {
    const r = v({ ...clone(DEMO), options: p.knobs }, p.shape);
    check(r.length === 0, `预设 ${p.name} 那组值 + 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
}

// ══ r2（QA1 #1496 18:47）：logo 列表槽不进建站选图 —— 否则 logo 会被整批换成生成的门店照片 ════════════
console.log('\n── r2 generateImages: false（logo 不被选图覆盖）');
{
  const { fillImageSlots } = require(path.join(NEXT, 'scripts', 'lib', 'image-slots.js'));
  const all = manifestLib.loadManifests();
  const get = (t) => (all instanceof Map ? all.get(t) : all[t]);
  const logos = [1, 2, 3].map((i) => ({ imageUrl: `https://cdn.example.com/brand-${i}.svg`, alt: `Brand ${i}` }));
  const run = async (manifests) => {
    const pages = [{ slug: 'home', blocks: [{ id: 'b1', type: 'logos-new', weight: 1, data: { headline: 'Certified', items: clone(logos) } }] }];
    // produce 是桩（不调 AI，#1499）：被选中的槽都会拿到这张图。
    await fillImageSlots({ pages, manifests, industry: 'auto repair shop', primaryColor: '#0ea5e9', themeWord: 'minimal', produce: async () => '/images/generated.jpg' });
    return pages[0].blocks[0].data.items;
  };
  check(M.slots.items.generateImages === false, 'manifest：items 槽声明 generateImages: false');
  check(JSON.stringify(manifestLib.imageSlotsOf(get('logos-new'))) === '[]', `imageSlotsOf(logos-new) == []（${JSON.stringify(manifestLib.imageSlotsOf(get('logos-new')))}）`);
  pending.push((async () => {
    const after = await run(all);
    check(JSON.stringify(after) === JSON.stringify(logos), '建站选图跑一遍（produce 桩）⟹ 3 个 logo 的 imageUrl 原样不动', JSON.stringify(after));
    // 反向对照：拿掉这一个声明 ⟹ 同一条路把 3 个 logo 全换成生成图（证明挡住它的就是这个声明）。
    const bare = new Map(all instanceof Map ? all : Object.entries(all));
    const m2 = clone(get('logos-new')); delete m2.slots.items.generateImages; bare.set('logos-new', m2);
    const leaked = await run(all instanceof Map ? bare : Object.fromEntries(bare));
    check(leaked.every((x) => x.imageUrl === '/images/generated.jpg'), `反向对照：去掉 generateImages ⟹ 3 个 logo 全被换成生成图（${leaked.filter((x) => x.imageUrl === '/images/generated.jpg').length}/3）`);
  })());
  // 别的块的图槽一个都不少（这条开关只在写了它的槽上生效）。
  for (const [t, want] of [['hero-new', 'band'], ['features-new', 'items'], ['gallery', 'items']]) {
    check(manifestLib.imageSlotsOf(get(t)).some((x) => x.name === want), `${t} 的 ${want} 仍是内容图槽`);
  }
  const strErr = (() => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'logos-new-'));
    try {
      fs.cpSync(BLOCK, path.join(dir, 'logos-new'), { recursive: true });
      const mf = path.join(dir, 'logos-new', 'manifest.json');
      const raw = JSON.parse(fs.readFileSync(mf, 'utf-8'));
      raw.slots.items.generateImages = 'false';
      fs.writeFileSync(mf, JSON.stringify(raw));
      manifestLib.loadManifests(dir);
      return '';
    } catch (e) { return e.message; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  })();
  check(strErr.includes('generateImages'), 'generateImages 写成字符串 "false" ⟹ manifest 载入当场红（否则静默当成没写）', strErr || '没抛');
}

// ══ AC10：block-roles · 首页配方池 ════════════════════════════════════════════════════════════════
console.log('\n── AC10 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['logos-new'] === M.roleDefault, `block-roles.json 的 logos-new（${roles['logos-new']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  check(pool.includes('logos-new') && !pool.includes('trusted-brands'), `poolFor 含 logos-new、不含 trusted-brands（池子 ${pool.length} 种）`);
  check('trusted-brands' in recipe.NOT_IN_POOL && !('logos-new' in recipe.NOT_IN_POOL), "'trusted-brands' in NOT_IN_POOL（logos-new 不在）");
  // 交付前的 main = 块库里没有 logos-new、排除名单里也没有 trusted-brands。
  const without = new Map([...all].filter(([k]) => k !== 'logos-new'));
  const saved = recipe.NOT_IN_POOL['trusted-brands'];
  let before;
  let leaked;
  delete recipe.NOT_IN_POOL['trusted-brands'];
  try { before = recipe.poolFor(without); leaked = recipe.poolFor(all); } finally { recipe.NOT_IN_POOL['trusted-brands'] = saved; }
  const swapped = before.map((t) => (t === 'trusted-brands' ? 'logos-new' : t));
  check(pool.length === before.length && JSON.stringify(pool) === JSON.stringify(swapped),
    `种数 == 交付前（${before.length} → ${pool.length}），集合 = 交付前把 trusted-brands 换成 logos-new`);
  // 反向对照：从排除名单拿掉 trusted-brands ⟹ 两个都进池、种数 +1。
  check(leaked.includes('logos-new') && leaked.includes('trusted-brands') && leaked.length === pool.length + 1,
    `反向对照：不排除 trusted-brands ⟹ 两个都进池（${leaked.length} 种 = ${pool.length} + 1）—— 判据分得开`);
  check(M.prompt.group === 'homepage' && M.prompt.order === all.get('trusted-brands').prompt.order,
    `prompt.group == homepage、order ${M.prompt.order} 与 trusted-brands 同档`);
  const lines = M.prompt.lines.join('\n');
  check(/only logo images the business uploaded/.test(lines) && /never invent a partner/.test(lines) && /alt is the brand name/.test(lines)
    && /leave this block out/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：只放上传的 logo、不编造合作方、alt 写品牌名、没 logo 就别放、bg 在 data 顶层');
}

// ══ AC12（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC12 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'logos-new');
  check(!!on, 'Puck 组件里有 logos-new（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'introCta', 'items', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → 链接 → items → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), '第一个字段：预设 4 个 → 七个旋钮（控件顺序 intro → items → item）');
  const items = on.fields.find((f) => f.slot === 'items');
  check(!!items && items.control === 'list', `items 是列表字段（能增删、挪顺序；${items && items.control}）`);
  const cta = on.fields.find((f) => f.slot === 'introCta');
  check(!!cta && cta.kind === 'link' && cta.subs.some((x) => x.sub === 'href'), 'introCta 是链接字段（文字 + Link）');
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[2].knobs) === 'Cards' && presetNameFor(man, { ...M.presets[2].knobs, logoColor: 'mono' }) === 'custom',
    '点 Cards = 那一组旋钮；拧偏一个（logoColor=mono）⟹ custom');
}

// ══ AC13：trusted-brands 与 hero-new 零改动 ═════════════════════════════════════════════════════════
console.log('\n── AC13 trusted-brands / hero-new 零改动');
{
  let diff = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    // 这是 #1496 交付自己的「别碰」判据。logos-new 已经在 merge-base 上 = #1496 落地了，T3 那张票合法地删 trusted-brands，
    //    不该在它自己的分支上红（同 faq-new-render.test.js AC13）。
    let landed = true;
    try { execFileSync('git', ['cat-file', '-e', `${base}:templates/nextjs/blocks/logos-new/manifest.json`], { cwd: NEXT, stdio: 'ignore' }); } catch { landed = false; }
    if (landed) console.log(`  ⏭  logos-new 已在 merge-base ${base.slice(0, 8)} 上（#1496 已落地），这一格只管 #1496 自己的交付 —— 不算通过`);
    else diff = execFileSync('git', ['diff', '--name-only', base, '--', 'blocks/trusted-brands', 'blocks/hero-new'], { cwd: NEXT, encoding: 'utf8' }).trim();
  } catch (e) { console.log(`  ⚠️  取不到 git 读数（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  if (diff !== null) check(diff === '', `blocks/trusted-brands 与 blocks/hero-new 相对 merge-base 没有改动${diff ? `：${diff}` : ''}`);
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['trusted-brands'] === 'optional', `block-roles.json 里 trusted-brands 仍是 optional（${roles['trusted-brands']}）`);
}

Promise.all(pending).then(() => {
  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
}, (e) => die(e && e.stack || String(e)));
