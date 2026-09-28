#!/usr/bin/env node
/**
 * footer-new-render.test.js — #1455 验收 1–4 / #1464 验收 1、2、5 里「只看渲染出来的 HTML 就能判」的那几条。
 *
 * 跑法:  node scripts/footer-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么是单测而不是只在图册上量：验收 3 / 4 要的是**数据的变体**（服务列空、`contact: false`、
 * `nav` 空、`contact` 整个为空），图册只有一份演示内容，按构造造不出这些。这里直接拿组件在 node 里
 * 渲染（`ts.transpileModule` + `renderToStaticMarkup`，`block-slots.test.js` 同一种做法）。
 * 几何那几条（reverse 左右上下、三端横向滚动）要浏览器：#1464 起归 `tests/e2e/specs/1464-footer-new-knobs.spec.ts`
 * （单格页 `/__catalog/footer-new/<预设>`，1440 / 820 / 390，带阳性对照）。
 * 📌 #1464 起一份 markup + 旋钮 layout / cta + 6 个预设（形态目录 = 预设名）；部件 newsletter 换成 `form`
 *    （hero 那个表单部件）。
 * 📌 #1469 起开关 `reverse` → 旋钮 `brand`（left | right），开关 `dark` → 颜色槽 `bg`（纯色 / brand / 渐变），
 *    `form` 从 `style: inline | stacked` 改成 `mode: teaser | full`（表单是站级资产，块只选画法）。
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
// #1464 —— `@/lib/config` 读的是构建期生成的 `config-data`（node 里没有），表单部件要它的 siteId / leadApi /
// getServices：换成一份内存里的替身（只服务渲染，提交那条路不在这份测试的射程里）。
const CONFIG_STUB = path.join(__dirname, '.footer-new-config-stub.js');
require.cache[CONFIG_STUB] = { id: CONFIG_STUB, filename: CONFIG_STUB, loaded: true,
  exports: { siteId: 't-site', leadApi: 'https://lead.example', defaultLocale: 'en', getServices: () => [{ id: 'brakes', name: 'Brakes' }] } };
Module._resolveFilename = function resolve(req, ...rest) {
  if (req === '@/lib/config') return CONFIG_STUB;
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  if (req.startsWith('@blocks/')) return origResolve.call(this, path.join(NEXT, 'blocks', req.slice(8)), ...rest);
  return origResolve.call(this, req, ...rest);
};

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION);
}

let mod; let DEMO; let MANIFEST;
try {
  mod = loadSection();
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['footer-new'];
  MANIFEST = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'footer-new', 'manifest.json'), 'utf-8'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 footer-new 那一份');
const C = mod.default;

const clone = (v) => JSON.parse(JSON.stringify(v));
// #1462 —— 图标是内联 SVG，表由服务端查好传进来；不给表的话一个图标都不画，下面 ④ 那条「没有空图标」就瞎了。
const ICONS = require(path.join(NEXT, 'scripts', 'lib', 'icons.js')).iconTableFor('footer-new', DEMO);
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, { shape, data, iconTable: ICONS }));
const count = (html, needle) => html.split(needle).length - 1;
const withKnobs = (d, knobs) => ({ ...d, options: { ...(d.options || {}), ...knobs } });
// #1469 PM 19:54 口径：`brand=right` 跟任何预设都对不上 ⟹ 根上 `data-preset="custom"`（这是对的读数）；
// 比「样子」时两边都先去掉它。只在比较这一步去，组件照样输出。
const noPreset = (h) => h.replace(/ data-preset="[^"]*"/, '');

// ══ 定稿表（票正文，Chris 2026-09-27；顺序就是这张表的顺序）══════════════════════════════════════
const TABLE = [
  ['slim-row', 'row', 'none'],
  ['stacked', 'stacked', 'none'],
  ['columns', 'columns', 'none'],
  ['cta-row', 'row', 'centered'],
  ['cta-stacked', 'stacked', 'inline'],
  ['cta-columns', 'columns', 'boxed'],
];
const PRESET_NAMES = TABLE.map((r) => r[0]);
const LAYOUTS = ['row', 'stacked', 'columns'];
const CTAS = ['none', 'centered', 'boxed', 'inline'];

// 夹具：演示内容（Northside Auto Care）去掉表单部件（它在第 ③ 段单独开关）；cta 内容留着，由旋钮决定出不出。
const base = clone(DEMO);
delete base.form;

// ══ ① 验收 1：manifest 6 个预设 · 旋钮值与定稿表一致 · 目录 == 6 个预设名 · 6 个预设两两不同 ═══════════
console.log('① 6 个预设：manifest · 目录 · 两两不同 · bg / brand 各改 HTML');
{
  const presets = Array.isArray(MANIFEST.presets) ? MANIFEST.presets : [];
  check(JSON.stringify(presets.map((p) => p.name)) === JSON.stringify(PRESET_NAMES),
    `manifest presets 6 条、名字与顺序逐字等于定稿表（${presets.map((p) => p.name).join(' · ')}）`);
  const wrong = TABLE.filter(([n, l, c]) => {
    const p = presets.find((x) => x.name === n);
    return !p || p.shape !== n || p.knobs.layout !== l || p.knobs.brand !== 'left' || p.knobs.cta !== c || Object.keys(p.knobs).length !== 3;
  });
  check(wrong.length === 0, '每个预设的 shape = 自己的名字、三个旋钮值与定稿表一致（brand 都是 left）', `对不上：${wrong.map((r) => r[0]).join(' · ')}`);
  const knobs = (MANIFEST.slots.options.knobs || []).map((k) => `${k.name}=${k.values.join('|')}`);
  check(knobs.join(' ; ') === 'layout=row|stacked|columns ; brand=left|right ; cta=none|centered|boxed|inline',
    `旋钮顺序 = 控件顺序：${knobs.join(' ; ')}`);
  const dirs = fs.readdirSync(path.join(NEXT, 'blocks', 'footer-new'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify([...PRESET_NAMES].sort()), `blocks/footer-new/ 的目录集合 == 6 个预设名（${dirs.join(' · ')}）`);
  check(!dirs.includes('centered') && !dirs.includes('minimal'), 'centered / minimal 两个老目录不在');

  const htmls = PRESET_NAMES.map((s) => render(s, base));
  check(new Set(htmls).size === 6, `同一份夹具下 6 个预设的 HTML 两两不同（${new Set(htmls).size} 种）`);
  const labels = PRESET_NAMES.filter((s, i) => !htmls[i].includes(`data-preset="${s}"`) || !htmls[i].includes(`data-shape="${s}"`));
  check(labels.length === 0, '每个预设渲染出来戴的就是自己的名字（data-shape + data-preset）', `没戴上：${labels.join(' · ')}`);
  // bg 深色：6 个预设全变。brand=right：4 个非 stacked 预设全变、stacked 两个不变（AC3：stacked 居中，brand 不起作用）。
  const STACKED = ['stacked', 'cta-stacked'];
  const bgChanged = (Comp) => PRESET_NAMES.filter((s, i) => render(s, { ...base, bg: '#0f172a' }, Comp) === (Comp ? render(s, base, Comp) : htmls[i]));
  const brandSame = (Comp) => PRESET_NAMES.filter((s, i) => noPreset(render(s, withKnobs(base, { brand: 'right' }), Comp)) === noPreset(Comp ? render(s, base, Comp) : htmls[i]));
  {
    const same = bgChanged();
    check(same.length === 0, 'bg=#0f172a：6 个预设的 HTML 全都变了', `没变的：${same.join(' · ')}`);
    const bs = brandSame();
    check(bs.length === 2 && STACKED.every((s) => bs.includes(s)),
      'brand=right：4 个非 stacked 预设全变、stacked / cta-stacked 两个不变（比较前去掉 data-preset）', `没变的：${bs.join(' · ') || '（无）'}`);
  }
  // 反向对照：把组件读 bg / brand 的那一行换成恒空 / 恒 left，上面两条必须被点名。锚点找不到不许静默跳过。
  const src = fs.readFileSync(SECTION, 'utf-8');
  for (const [what, from, to, want] of [
    ['bg', 'const bg = data.bg;', 'const bg = undefined as FooterNewData[\'bg\'];', 6],
    ['brand', 'const brandSide = knobs.brand;', "const brandSide: BrandSide = 'left';", 4],
  ]) {
    const broken = src.replace(from, to);
    if (broken === src) { bad(`反向对照（${what}）没改到源码（锚点找不到）—— 这一格什么都没证明`); continue; }
    const Cb = loadSection(broken).default;
    const same = what === 'bg' ? bgChanged(Cb) : brandSame(Cb).filter((s) => !STACKED.includes(s));
    check(same.length === want, `反向对照：组件不读 ${what} ⟹ ${want} 个预设都被点名「没变」（${same.length}/${want}）`);
    loadSection();
  }
  // 不认识的形态名落回 slim-row（跟 header 同一条规矩）。
  check(render('no-such-preset', base) === htmls[0], '不认识的形态名 ⟹ 渲染成 slim-row');
}

// ══ ② 验收 2：layout × cta 12 种都能渲染 · cta=none 没有 CTA 条节点 · 三种互斥 · Custom ══════════════
console.log('\n② layout × cta 12 种组合');
{
  const seen = new Set();
  for (const layout of LAYOUTS) {
    for (const cta of CTAS) {
      const h = render('slim-row', withKnobs(base, { layout, cta }));
      seen.add(h);
      const got = ['centered', 'boxed', 'inline'].filter((x) => h.includes(`data-footer-cta="${x}"`));
      if (cta === 'none') check(count(h, 'data-footer-cta') === 0, `${layout} + none：DOM 里没有 CTA 条节点`, `出了 ${got.join(' + ')}`);
      else check(got.length === 1 && got[0] === cta && count(h, 'data-footer-cta') === 1, `${layout} + ${cta}：只出 ${cta} 那一条`, `出了 ${got.join(' + ') || '（没有）'}`);
      check(h.includes(`ftr-layout-${layout}`) && h.includes(`ftr-cta-${cta}`), `${layout} + ${cta}：根上挂着两个旋钮类`);
      const hit = TABLE.find((r) => r[1] === layout && r[2] === cta);
      const label = hit ? hit[0] : 'custom';
      check(h.includes(`data-preset="${label}"`), `${layout} + ${cta}：预设标签 = ${label}`);
    }
  }
  check(seen.size === 12, `12 种组合的 HTML 两两不同（${seen.size} 种）`);
  // CTA 条在最顶上：它是容器里的第一个部件。（不锚 `^`：React 19 会把 logo 的 `<link rel="preload">` 提到最前。）
  for (const cta of ['centered', 'boxed', 'inline']) {
    const h = render('slim-row', withKnobs(base, { cta }));
    check(new RegExp(`<footer[^>]*><div class="container-lg[^"]*"><div[^>]*data-footer-cta="${cta}"`).test(h), `${cta}：CTA 条是页脚里的第一个部件`);
  }
  // cta 旋钮开着但 cta 内容空 ⟹ 也没有条（空值不渲染）。
  const noCta = clone(base); delete noCta.cta;
  check(count(render('cta-row', noCta), 'data-footer-cta') === 0, 'cta-row 但 cta 槽为空 ⟹ 没有 CTA 条');
  // brand=right（原 reverse）：两个排布的主容器 ≥768 反向、<768 反序叠；columns 的断点是 md（T2.2 是 lg）。
  for (const layout of ['row', 'columns']) {
    const h = render('slim-row', withKnobs(base, { layout, brand: 'right' }));
    const main = (h.match(/<div class="([^"]*)" data-footer-main=""/) || [])[1] || '';
    check(/\bflex-column-reverse\b/.test(main) && /\bflex-md-row-reverse\b/.test(main) && !/flex-lg-row-reverse/.test(main),
      `${layout} + brand=right：主容器 = flex-column-reverse + flex-md-row-reverse（没有 lg）`, main);
  }
}

// ══ ③ 验收 5 / #1469 AC6：form 部件的位置 · teaser / full 各一次 · row 不出 · 空值不出 ═══════════════
console.log('\n③ form 部件');
{
  // 字段 id 集合（不算防机器人那个 `ftr-hp`）：teaser = 首要字段、full = 整张替身表单。
  const WANT = { teaser: ['ftr-phone'], full: ['ftr-name', 'ftr-phone', 'ftr-service'] };
  const VARIANT = { teaser: 'inline', full: 'stacked' };
  const fieldIds = (h) => Array.from(h.matchAll(/<(?:input|select|textarea)[^>]*\bid="(ftr-[a-z]+)"/g)).map((x) => x[1]).filter((x) => x !== 'ftr-hp').sort();
  for (const mode of ['teaser', 'full']) {
    const d = { ...base, form: { mode } };
    const st = render('stacked', d);
    const addr = st.indexOf(DEMO.contact.address);
    const at = st.indexOf(`data-footer-form="${mode}"`);
    check(count(st, 'data-footer-form=') === 1 && addr > 0 && at > addr, `stacked + form ${mode}：恰好 1 个，在联系一行之后`);
    check(st.includes(`data-form-variant="${VARIANT[mode]}"`), `stacked + form ${mode}：画的是 ${VARIANT[mode]} 那种画法`);
    check(JSON.stringify(fieldIds(st)) === JSON.stringify([...WANT[mode]].sort()), `stacked + form ${mode}：字段 = ${WANT[mode].join(' · ')}`, fieldIds(st).join(' · '));
    check(count(st, '<form') === 1 && /<button[^>]*type="submit"/.test(st), `stacked + form ${mode}：一个 <form> + 提交按钮`);
    const col = render('columns', d);
    const brandStart = col.indexOf('data-footer-col="brand"');
    const brandEnd = col.indexOf('data-footer-col="services"');
    const cat = col.indexOf(`data-footer-form="${mode}"`);
    check(count(col, 'data-footer-form=') === 1 && brandStart > 0 && cat > brandStart && cat < brandEnd, `columns + form ${mode}：恰好 1 个，在品牌列里`);
    check(count(render('slim-row', d), '<form') === 0, `row + form ${mode}：不渲染`);
    // 跟 hero 同页时 id 不撞：页脚那份用 ftr- 前缀。
    check(!/id="hro-/.test(col) && /id="ftr-phone"/.test(col), `form ${mode}：id 用 ftr- 前缀（不跟 hero 的 hro- 撞）`);
  }
  for (const s of PRESET_NAMES) check(count(render(s, base), '<form') === 0, `${s}：form 空 ⟹ 没有 <form>`);
  const noMode = { ...base, form: { id: 'x' } };
  check(count(render('stacked', noMode), '<form') === 0, 'form 没有 mode ⟹ 不渲染（mode 是这个部件的开关，工具栏的 none 就是它）');
  const oldStyle = { ...base, form: { style: 'inline', fields: ['phone'], buttonText: 'x' } };
  check(count(render('stacked', oldStyle), '<form') === 0, '#1464 的旧形状（只有 style）⟹ 不渲染');
}

// ══ #1469 AC5：bg 颜色槽 —— 深底反白 · 浅底深字 · brand = 主色 · 渐变按色标平均亮度 ══════════════════════
console.log('\n③b bg 颜色槽');
{
  const rootOf = (h) => (h.match(/<footer[^>]*>/) || [''])[0];
  const dark = render('cta-columns', { ...base, bg: '#0f172a' });
  check(/style="background:#0f172a"/.test(rootOf(dark)) && !/\bbg-body\b/.test(rootOf(dark)) && /\btext-white\b/.test(rootOf(dark)),
    'bg=#0f172a：根上 background:#0f172a、没有 bg-body、字反白', rootOf(dark));
  check(!/text-white-50|text-body-secondary/.test(dark) && dark.includes('ftr-muted-on-dark'), 'bg=#0f172a：小字不用灰（白 .92 那个类），没有 text-white-50');
  check(/rounded-3 bg-white bg-opacity-10[^"]*" data-footer-cta="boxed"/.test(dark), 'bg=#0f172a：boxed 盒子换成浅一档（半透明白），不是 bg-dark');
  const light = render('cta-columns', { ...base, bg: '#ffffff' });
  check(/style="background:#ffffff"/.test(rootOf(light)) && !/\btext-white\b/.test(rootOf(light)) && light.includes('text-body-secondary') && !light.includes('ftr-muted-on-dark'),
    'bg=#ffffff：深字（没有反白类）', rootOf(light));
  const brand = render('slim-row', { ...base, bg: 'brand' });
  check(/style="background:var\(--x-primary\)"/.test(rootOf(brand)) && /\btext-white\b/.test(rootOf(brand)), 'bg=brand：背景是主题主色、字反白', rootOf(brand));
  const g = render('slim-row', { ...base, bg: { stops: ['#7d52f4', '#f7b733'], angle: 135 } });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(rootOf(g)) && /\btext-white\b/.test(rootOf(g)),
    '渐变 紫→金：linear-gradient(135deg,…)、按色标平均亮度 < 0.55 反白', rootOf(g));
  const gl = render('slim-row', { ...base, bg: { stops: ['#ffffff', '#e0f2fe', '#f1f5f9'] } });
  check(/linear-gradient\(135deg,#ffffff,#e0f2fe,#f1f5f9\)/.test(rootOf(gl)) && !/\btext-white\b/.test(rootOf(gl)), '浅渐变 3 色标（没写角度 = 135）：深字', rootOf(gl));
  const junk = render('slim-row', { ...base, bg: { stops: ['#000000'] } });
  check(junk === render('slim-row', base), '不合法的渐变（1 个色标）⟹ 当没填，逐字等于不填');
  const { toneForBg, relativeLuminance, isColorValue } = require(path.join(NEXT, 'scripts', 'lib', 'contrast.js'));
  // 门槛 0.55 的边界：两色标平均亮度恰好落在 0.4 与 0.55 之间 ⟹ 纯色规则会判浅，渐变规则判深（偏向反白）。
  const mid = ['#c0c0c0', '#b8b8b8'];
  const avg = mid.reduce((a, c) => a + relativeLuminance(c), 0) / 2;
  check(avg > 0.4 && avg < 0.55 && toneForBg({ stops: mid }) === 'dark', `渐变门槛是 0.55 不是 0.4（平均亮度 ${avg.toFixed(3)} ⟹ dark）`);
  check(isColorValue({ stops: ['#000000', '#ffffff'], angle: 90 }) && !isColorValue({ stops: ['#000000'] }) && !isColorValue({ stops: ['#000000', '#fff'] }),
    'validateSite 的判据认渐变（2–3 个 #rrggbb），1 个色标 / 短写不认');
}

// ══ ④ #1455 验收 3：列规矩 ═════════════════════════════════════════════════════════════════════════════
console.log('\n④ columns 的列：空列不渲染');
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

// ══ ⑤ #1455 验收 4：联系信息每个排布都在；contact 整个为空 ⟹ 没有空图标、没有空行 ═══════════════════
console.log('\n⑤ 联系信息');
{
  const phone = DEMO.contact.phone;
  for (const s of PRESET_NAMES) check(render(s, base).includes(phone), `${s}：HTML 里有电话 ${phone}`);
  // 联系列不出的时候（contact:false），columns 仍要有电话：挂到品牌列里。
  const noContact = clone(base); noContact.columns.contact = false;
  check(render('columns', noContact).includes(phone), 'columns + contact:false：电话仍在（挂进品牌列）');
  const empty = { ...base, contact: {} };
  const icons = ['telephone', 'geo-alt', 'clock', 'envelope'].map((n) => `data-icon="${n}"`);
  check(icons.every((i) => render('columns', base).includes(i)), 'columns + 全量 contact：四个联系图标都画出来了（尺子会亮）');
  for (const s of PRESET_NAMES) {
    const h = render(s, empty);
    const left = icons.filter((i) => h.includes(i));
    check(left.length === 0, `${s}：contact 为空 ⟹ 没有联系图标`, `还剩 ${left.join(' · ')}`);
    // 空行：一个没有任何子节点的 flex 容器（`<div class="d-flex …"></div>`）。
    const emptyBoxes = (h.match(/<(div|span|ul)[^>]*><\/\1>/g) || []);
    check(emptyBoxes.length === 0, `${s}：contact 为空 ⟹ 没有空的容器`, emptyBoxes.slice(0, 3).join(' '));
  }
  // 反向对照：把「空的不渲染」拿掉（地址恒渲染），空图标那一条必须红。
  const src = fs.readFileSync(SECTION, 'utf-8');
  const broken = src.replace("contact.address ? { key: 'address', icon: 'geo-alt', text: contact.address } : null,",
    "{ key: 'address', icon: 'geo-alt', text: contact.address || '' },");
  if (broken === src) bad('反向对照没改到源码（锚点找不到）—— 这一格什么都没证明');
  else {
    const Cb = loadSection(broken).default;
    const hit = PRESET_NAMES.filter((s) => render(s, empty, Cb).includes('data-icon="geo-alt"'));
    check(hit.length > 0, `反向对照：地址空也渲染 ⟹ 有形态被点名留着空图标（${hit.join(' · ')}）`);
    loadSection();
  }
}

// ══ ⑥ #1464 验收 8 的后半：选择单填 cta-columns ⟹ 解析出的形态画出来是 boxed CTA 条 + 列 ═══════════════
console.log('\n⑥ 选择单 → 形态解析 → 渲染（cta-columns）');
{
  const { shapeForBlock } = require(path.join(NEXT, 'scripts', 'lib', 'block-shape.js'));
  const manifests = Object.fromEntries(require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js')).loadManifests());
  const pick = (name) => shapeForBlock({ type: 'footer-new', data: DEMO }, { 'footer-new': name }, manifests, () => {});
  const h = render(pick('cta-columns'), base);
  check(h.includes('data-footer-cta="boxed"') && h.includes('data-footer-col="brand"') && h.includes('data-footer-col="services"'),
    '选择单 cta-columns ⟹ 页脚 DOM 上是 boxed CTA 条 + 品牌列 + 列');
  const g = render(pick('no-such-footer'), base);
  check(!g.includes('data-footer-cta="boxed"') && !g.includes('data-footer-col="brand"'), '阳性对照：不存在的名字 ⟹ 落回默认，没有 boxed、没有列');
}

console.log(`\n${fail ? '🔴' : '✅'} footer-new-render: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
