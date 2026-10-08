#!/usr/bin/env node
/**
 * footer-render.test.js — #1455 验收 1–4 / #1464 验收 1、2、5 里「只看渲染出来的 HTML 就能判」的那几条。
 *
 * 跑法:  node scripts/footer-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么是单测而不是只在图册上量：验收 3 / 4 要的是**数据的变体**（服务列空、`contact: false`、
 * `nav` 空、`contact` 整个为空），图册只有一份演示内容，按构造造不出这些。这里直接拿组件在 node 里
 * 渲染（`ts.transpileModule` + `renderToStaticMarkup`，`block-slots.test.js` 同一种做法）。
 * 几何那几条（reverse 左右上下、三端横向滚动）要浏览器：#1464 起归 `tests/e2e/specs/1464-footer-new-knobs.spec.ts`
 * （单格页 `/__catalog/footer/<预设>`，1440 / 820 / 390，带阳性对照）。
 * 📌 #1464 起一份 markup + 旋钮 layout / cta + 6 个预设（形态目录 = 预设名）；部件 newsletter 换成 `form`
 *    （hero 那个表单部件）。
 * 📌 #1469 起开关 `reverse` → 旋钮 `brand`（left | right），开关 `dark` → 颜色槽 `bg`（纯色 / brand / 渐变），
 *    `form` 从 `style: inline | stacked` 改成 `mode: teaser | full`（表单是站级资产，块只选画法）。
 * 📌 #1648 起页脚没有 CTA 条：旋钮 cta 和三个带 CTA 条的预设一起删，剩 slim-row / stacked / columns 三个预设，
 *    旋钮 layout / brand / form（页尾号召只由页面里的 CTA 块负责）。旧站 data 里残留的 cta 内容不画（第 ② 段）。
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
const SECTION = path.join(NEXT, 'blocks', 'footer', 'Section.tsx');

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
const CONFIG_STUB = path.join(__dirname, '.footer-config-stub.js');
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
  // #1506 —— 夹具的 `contact` / `social` 写成引用（`{source: "brand"}` / `{source: "social"}`）。组件吃的是展开后的
  //    data（单格页、以后真站都先过 `resolveItemSources`），所以这里先展开一次，站点数据用演示生意那一份。
  const demoLib = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  const { resolveItemSources } = require(path.join(NEXT, 'scripts', 'lib', 'item-sources.js'));
  DEMO = resolveItemSources([{ type: 'footer', data: demoLib.DEMO_CONTENT['footer'] }], demoLib.demoSourceContext())[0].data;
  MANIFEST = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'footer', 'manifest.json'), 'utf-8'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 footer 那一份');
const C = mod.default;

const clone = (v) => JSON.parse(JSON.stringify(v));
// #1462 —— 图标是内联 SVG，表由服务端查好传进来；不给表的话一个图标都不画，下面 ④ 那条「没有空图标」就瞎了。
const ICONS = require(path.join(NEXT, 'scripts', 'lib', 'icons.js')).iconTableFor('footer', DEMO);
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, { shape, data, iconTable: ICONS }));
const count = (html, needle) => html.split(needle).length - 1;
const withKnobs = (d, knobs) => ({ ...d, options: { ...(d.options || {}), ...knobs } });
// #1469 PM 19:54 口径：`brand=right` 跟任何预设都对不上 ⟹ 根上 `data-preset="custom"`（这是对的读数）；
// 比「样子」时两边都先去掉它。只在比较这一步去，组件照样输出。
const noPreset = (h) => h.replace(/ data-preset="[^"]*"/, '');

// ══ 定稿表（票正文，Chris 2026-09-27；顺序就是这张表的顺序）══════════════════════════════════════
const TABLE = [
  ['slim-row', 'row'],
  ['stacked', 'stacked'],
  ['columns', 'columns'],
];
const PRESET_NAMES = TABLE.map((r) => r[0]);
const LAYOUTS = ['row', 'stacked', 'columns'];

// 夹具：演示内容（Northside Auto Care）去掉表单部件（它在第 ③ 段单独开关）。
const base = clone(DEMO);
delete base.form;
// #1471 —— 露多少是旋钮 `options.form`（演示内容写着 teaser）；它也一起拿掉，否则它压过每个预设的 `form: none`、3 个都读成 custom。
if (base.options) delete base.options.form;

// ══ ① 验收 1：manifest 3 个预设 · 旋钮值与定稿表一致 · 目录 == 3 个预设名 · 3 个预设两两不同 ═══════════
console.log('① 3 个预设：manifest · 目录 · 两两不同 · bg / brand 各改 HTML');
{
  const presets = Array.isArray(MANIFEST.presets) ? MANIFEST.presets : [];
  check(JSON.stringify(presets.map((p) => p.name)) === JSON.stringify(PRESET_NAMES),
    `manifest presets 3 条、名字与顺序逐字等于定稿表（${presets.map((p) => p.name).join(' · ')}）`);
  const wrong = TABLE.filter(([n, l]) => {
    const p = presets.find((x) => x.name === n);
    return !p || p.shape !== n || p.knobs.layout !== l || p.knobs.brand !== 'left'
      || p.knobs.form !== 'none' || Object.keys(p.knobs).length !== 3;
  });
  check(wrong.length === 0, '每个预设的 shape = 自己的名字、三个旋钮值与定稿表一致（brand 都是 left，form 都是 none —— #1471：形态里没给表单留位置）',
    `对不上：${wrong.map((r) => r[0]).join(' · ')}`);
  const knobs = (MANIFEST.slots.options.knobs || []).map((k) => `${k.name}=${k.values.join('|')}`);
  check(knobs.join(' ; ') === 'layout=row|stacked|columns ; brand=left|right ; form=none|teaser|full',
    `旋钮顺序 = 控件顺序：${knobs.join(' ; ')}`);
  const dirs = fs.readdirSync(path.join(NEXT, 'blocks', 'footer'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify([...PRESET_NAMES].sort()), `blocks/footer/ 的目录集合 == 3 个预设名（${dirs.join(' · ')}）`);
  check(!dirs.includes('centered') && !dirs.includes('minimal'), 'centered / minimal 两个老目录不在');

  const htmls = PRESET_NAMES.map((s) => render(s, base));
  check(new Set(htmls).size === 3, `同一份夹具下 3 个预设的 HTML 两两不同（${new Set(htmls).size} 种）`);
  const labels = PRESET_NAMES.filter((s, i) => !htmls[i].includes(`data-preset="${s}"`) || !htmls[i].includes(`data-shape="${s}"`));
  check(labels.length === 0, '每个预设渲染出来戴的就是自己的名字（data-shape + data-preset）', `没戴上：${labels.join(' · ')}`);
  // bg 深色：3 个预设全变。brand=right：2 个非 stacked 预设全变、stacked 不变（AC3：stacked 居中，brand 不起作用）。
  const STACKED = ['stacked'];
  const bgChanged = (Comp) => PRESET_NAMES.filter((s, i) => render(s, { ...base, bg: '#0f172a' }, Comp) === (Comp ? render(s, base, Comp) : htmls[i]));
  const brandSame = (Comp) => PRESET_NAMES.filter((s, i) => noPreset(render(s, withKnobs(base, { brand: 'right' }), Comp)) === noPreset(Comp ? render(s, base, Comp) : htmls[i]));
  {
    const same = bgChanged();
    check(same.length === 0, 'bg=#0f172a：3 个预设的 HTML 全都变了', `没变的：${same.join(' · ')}`);
    const bs = brandSame();
    check(bs.length === 1 && STACKED.every((s) => bs.includes(s)),
      'brand=right：2 个非 stacked 预设全变、stacked 不变（比较前去掉 data-preset）', `没变的：${bs.join(' · ') || '（无）'}`);
  }
  // 反向对照：把组件读 bg / brand 的那一行换成恒空 / 恒 left，上面两条必须被点名。锚点找不到不许静默跳过。
  const src = fs.readFileSync(SECTION, 'utf-8');
  for (const [what, from, to, want] of [
    ['bg', 'const bg = data.bg;', 'const bg = undefined as FooterNewData[\'bg\'];', 3],
    ['brand', 'const brandSide = knobs.brand;', "const brandSide: BrandSide = 'left';", 2],
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

// ══ ② #1648：页脚没有 CTA 条 —— 根上只挂 layout 那一个旋钮类 · 旧站残留的 cta 内容 / 旋钮不画、不报错 ═══════
console.log('\n② 三种 layout · 残留的 CTA 内容不画（#1648）');
{
  const seen = new Set();
  for (const layout of LAYOUTS) {
    const h = render('slim-row', withKnobs(base, { layout }));
    seen.add(h);
    const cls = ((h.match(/<footer[^>]*class="([^"]*)"/) || [])[1] || '').split(' ').filter(Boolean);
    check(cls.includes(`ftr-layout-${layout}`) && cls.filter((c) => c.startsWith('ftr-')).length === 1,
      `${layout}：根上的 ftr- 类只有 ftr-layout-${layout} 一个`, cls.join(' '));
    const hit = TABLE.find((r) => r[1] === layout);
    check(h.includes(`data-preset="${hit[0]}"`), `${layout}：预设标签 = ${hit[0]}`);
  }
  check(seen.size === 3, `3 种 layout 的 HTML 两两不同（${seen.size} 种）`);
  // #1648 之前存下的站：data 里还有一份 cta 内容、options 里还有 cta 旋钮 ⟹ 都不认，HTML 逐字等于没有它们。
  const leftover = { title: 'Ready to book?', subtitle: 'Leftover band copy', buttons: [{ label: 'Book now', href: '/contact', style: 'solid' }] };
  const legacy = withKnobs({ ...base, cta: leftover }, { cta: 'boxed' });
  for (const s of PRESET_NAMES) {
    const h = render(s, legacy);
    check(!h.includes(leftover.title) && !h.includes(leftover.subtitle) && count(h, 'data-footer-cta') === 0,
      `${s}：残留的 cta 内容不上页面（标题 / 副标题都不在，没有 data-footer-cta 节点）`);
    check(h === render(s, base), `${s}：残留的 cta 内容 + 旋钮 ⟹ HTML 逐字等于没有它们（预设标签也不变）`);
  }
  // 阳性对照：同一串字放进页脚会画的那一格（tagline），上面「不在」那条的找法必须找得到它。
  check(render('stacked', { ...base, tagline: leftover.title }).includes(leftover.title), '阳性对照：同一串字放进 tagline ⟹ 找得到（「不在」那条不是找法瞎了）');
  // brand=right（原 reverse）：两个排布的主容器 ≥768 反向、<768 反序叠；columns 的断点是 md（T2.2 是 lg）。
  for (const layout of ['row', 'columns']) {
    const h = render('slim-row', withKnobs(base, { layout, brand: 'right' }));
    const main = (h.match(/<div class="([^"]*)" data-footer-main=""/) || [])[1] || '';
    check(/\bflex-column-reverse\b/.test(main) && /\bflex-md-row-reverse\b/.test(main) && !/flex-lg-row-reverse/.test(main),
      `${layout} + brand=right：主容器 = flex-column-reverse + flex-md-row-reverse（没有 lg）`, main);
  }
}

// ══ ③ 验收 5 / #1471 做什么 7：form 的位置 · 旋钮 teaser / full 各一次 · row 不出 · 旋钮 none 不出 ═════════
console.log('\n③ form 部件');
{
  // 字段 id 集合（不算防机器人那个 `ftr-hp`）：teaser = 首要字段、full = 整张。这里的 config 替身没有表单库 ⟹ BlockLeadForm 的内置默认。
  const WANT = { teaser: ['ftr-phone'], full: ['ftr-name', 'ftr-phone', 'ftr-service'] };
  const VARIANT = { teaser: 'inline', full: 'stacked' };
  const fieldIds = (h) => Array.from(h.matchAll(/<(?:input|select|textarea)[^>]*\bid="(ftr-[a-z]+)"/g)).map((x) => x[1]).filter((x) => x !== 'ftr-hp').sort();
  for (const mode of ['teaser', 'full']) {
    const d = withKnobs({ ...base, form: {} }, { form: mode });
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
  const none = withKnobs({ ...base, form: { id: 'x' } }, { form: 'none' });
  const noneHtml = render('stacked', none);
  check(count(noneHtml, '<form') === 0 && !noneHtml.includes('data-footer-form'), '旋钮 form=none ⟹ 没有 <form>、也没有 data-footer-form 属性');
  check(count(render('stacked', withKnobs({ ...base, form: { id: 'x' } }, { form: 'teaser' })), '<form') === 1,
    '阳性对照：同一份数据把旋钮切回 teaser ⟹ <form> 出现');
  // #1471 AC2 —— 值只从 options.form 来：槽里残留的 #1469 旧键 `mode: full` 不被读。
  const legacy = render('stacked', withKnobs({ ...base, form: { mode: 'full' } }, { form: 'teaser' }));
  check(JSON.stringify(fieldIds(legacy)) === JSON.stringify(['ftr-phone']) && legacy.includes('data-footer-form="teaser"'),
    'form: { mode: "full" } + options.form: "teaser" ⟹ 渲染的是 teaser（只有 phone）', fieldIds(legacy).join(' · '));
  check(count(render('stacked', { ...base, form: { mode: 'full' } }), '<form') === 0, 'form: { mode: "full" } 但旋钮没写（= 预设的 none）⟹ 不渲染（不做兼容读）');
  const oldStyle = { ...base, form: { style: 'inline', fields: ['phone'], buttonText: 'x' } };
  check(count(render('stacked', oldStyle), '<form') === 0, '#1464 的旧形状（只有 style）⟹ 不渲染');
}

// ══ #1469 AC5：bg 颜色槽 —— 深底反白 · 浅底深字 · brand = 主色 · 渐变按色标平均亮度 ══════════════════════
console.log('\n③b bg 颜色槽');
{
  const rootOf = (h) => (h.match(/<footer[^>]*>/) || [''])[0];
  const dark = render('columns', { ...base, bg: '#0f172a' });
  check(/style="background:#0f172a"/.test(rootOf(dark)) && !/\bbg-body\b/.test(rootOf(dark)) && /\btext-white\b/.test(rootOf(dark)),
    'bg=#0f172a：根上 background:#0f172a、没有 bg-body、字反白', rootOf(dark));
  check(!/text-white-50|text-body-secondary/.test(dark) && dark.includes('ftr-muted-on-dark'), 'bg=#0f172a：小字不用灰（白 .92 那个类），没有 text-white-50');
  const light = render('columns', { ...base, bg: '#ffffff' });
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
  // #1506 —— 夹具的 contact 改成 `{source: "brand"}` 之后只展开出电话 / 邮箱 / 地址（营业时间不是那个源，票正文「不做」），
  //    所以「全量」这一格自己补上 hours —— 量的是组件四样都画得出来，不是夹具有几样。
  const full = { ...base, contact: { ...base.contact, hours: 'Mon–Sat 8am–6pm' } };
  check(icons.every((i) => render('columns', full).includes(i)), 'columns + 全量 contact：四个联系图标都画出来了（尺子会亮）');
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

// ══ ⑥ #1464 验收 8 的后半：选择单填 columns ⟹ 解析出的形态画出来是品牌列 + 列 ═══════════════════════════
//    （#1648 删掉的那三个名字落回默认，那一格在 `theme-presets.test.js` 的选择单那一段。）
console.log('\n⑥ 选择单 → 形态解析 → 渲染（columns）');
{
  const { shapeForBlock } = require(path.join(NEXT, 'scripts', 'lib', 'block-shape.js'));
  const manifests = Object.fromEntries(require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js')).loadManifests());
  const pick = (name) => shapeForBlock({ type: 'footer', data: DEMO }, { 'footer': name }, manifests, () => {});
  const h = render(pick('columns'), base);
  check(h.includes('data-footer-col="brand"') && h.includes('data-footer-col="services"'), '选择单 columns ⟹ 页脚 DOM 上是品牌列 + 列');
  const g = render(pick('no-such-footer'), base);
  check(!g.includes('data-footer-col="brand"'), '阳性对照：不存在的名字 ⟹ 落回默认，没有列');
}

// ══ ⑦ #1530：row 底栏的「城市」读 contact.city，没有就整格不画（不再从地址串取最后一段）═══════════════════
console.log('\n⑦ row 底栏的城市（#1530）');
{
  // 底栏左边那一组：电话 + 城市（城市那一格是唯一一个「geo-alt 图标 + 文字」的 span）。
  const cityCell = (h) => { const m = h.match(/<span class="d-inline-flex align-items-center gap-2"><svg[^>]*data-icon="geo-alt"[\s\S]*?<\/svg>([^<]*)<\/span>/); return m ? m[1] : null; };
  const addr = '2150 Yonge St, Toronto, ON';
  const withCity = { ...base, contact: { phone: '(416) 555-0142', address: addr, city: 'Toronto' } };
  const noCity = { ...base, contact: { phone: '(416) 555-0142', address: addr } };
  for (const s of ['slim-row']) {
    check(cityCell(render(s, withCity)) === 'Toronto', `${s} + contact.city = Toronto ⟹ 底栏画 Toronto`, String(cityCell(render(s, withCity))));
    const h = render(s, noCity);
    check(cityCell(h) === null && count(h, 'data-icon="geo-alt"') === 0, `${s} + 没有 city ⟹ 城市那一格不在（没有 geo-alt 图标）`);
    check(!/>\s*ON\s*</.test(h), `${s} + 没有 city ⟹ HTML 里没有一格只写着 ON`);
    check(h.includes('(416) 555-0142'), `${s} + 没有 city ⟹ 电话照旧在`);
    const emptyBoxes = (h.match(/<(div|span|ul)[^>]*><\/\1>/g) || []);
    check(emptyBoxes.length === 0, `${s} + 没有 city ⟹ 没有空的容器`, emptyBoxes.slice(0, 3).join(' '));
  }
  // 电话、城市都没有 ⟹ 左边那一组整个不在（不留空 flex 容器）。
  const none = render('slim-row', { ...base, contact: { address: addr } });
  check(!(none.match(/<(div|span|ul)[^>]*><\/\1>/g) || []).length && cityCell(none) === null, 'slim-row + 只有地址 ⟹ 左边一组整个不画、没有空容器');
  // 演示生意那一份（单格页 /__catalog/footer/slim-row 用的）展开后带着城市。
  check(DEMO.contact.city === 'Toronto' && cityCell(render('slim-row', base)) === 'Toronto', `演示数据：{source: "brand"} 展开出 city = Toronto，slim-row 底栏画它（${DEMO.contact.city}）`);
  // 反向对照：把读法换回老的「地址最后一段」，没有 city 的那一份必须画出 ON —— 证明上面「不出现 ON」那条有牙。
  const src = fs.readFileSync(SECTION, 'utf-8');
  const broken = src.replace("const city = contact.city || '';", "const city = (contact.address || '').split(',').map((x) => x.trim()).filter(Boolean).pop() || '';");
  if (broken === src) bad('反向对照没改到源码（锚点找不到）—— 这一格什么都没证明');
  else {
    const Cb = loadSection(broken).default;
    check(cityCell(render('slim-row', noCity, Cb)) === 'ON', `反向对照：换回取地址最后一段 ⟹ 底栏画成 ON（${cityCell(render('slim-row', noCity, Cb))}）`);
    loadSection();
  }
}

// ══ ⑧ #1640：四个栏名跟着站的语言走（getLabels），表里没有的语言回英文 ══════════════════════════════
console.log('\n⑧ 栏名跟着 locale 走（#1640）');
{
  // 四栏都要在：夹具补一栏 areas（演示内容没有），其余照旧。
  const full = { ...base, columns: { ...(base.columns || {}), areas: [{ label: 'Downtown', href: '/areas/downtown' }] } };
  const KEYS = ['services', 'areas', 'pages', 'contact'];
  const titlesOf = (h) => Object.fromEntries(KEYS.map((k) => {
    const m = h.match(new RegExp(`data-footer-col="${k}"><div class="[^"]*">([^<]*)</div>`));
    return [k, m ? m[1] : null];
  }));
  const at = (locale, Comp = C) => titlesOf(renderToStaticMarkup(React.createElement(Comp, { shape: 'columns', data: full, iconTable: ICONS, locale })));
  const EN = { services: 'Services', areas: 'Service areas', pages: 'Pages', contact: 'Contact' };
  const ZH = { services: '服务', areas: '服务区域', pages: '页面', contact: '联系方式' };
  const zh = at('zh');
  check(JSON.stringify(zh) === JSON.stringify(ZH), `locale=zh ⟹ 四个栏名是中文（${JSON.stringify(zh)}）`);
  const en = at('en');
  check(JSON.stringify(en) === JSON.stringify(EN), `locale=en ⟹ 与原 COLUMN_TITLES 逐字相同（${JSON.stringify(en)}）`);
  const xx = at('xx');
  check(JSON.stringify(xx) === JSON.stringify(EN), `locale=xx（表里没有）⟹ 回英文（${JSON.stringify(xx)}）`);
  // 反向对照：任一栏改回英文常量，zh 那一格必须红 —— 四栏各改一次。
  const src = fs.readFileSync(SECTION, 'utf-8');
  for (const k of KEYS) {
    const broken = src.replace(`titles.${k}`, JSON.stringify(EN[k]));
    if (broken === src) { bad(`反向对照（${k}）没改到源码（锚点找不到）—— 这一格什么都没证明`); continue; }
    const got = at('zh', loadSection(broken).default);
    check(got[k] === EN[k] && JSON.stringify(got) !== JSON.stringify(ZH), `反向对照：${k} 改回常量 ⟹ zh 那一栏读成 ${got[k]}，上面那格会红`);
  }
  loadSection();
}

console.log(`\n${fail ? '🔴' : '✅'} footer-render: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
