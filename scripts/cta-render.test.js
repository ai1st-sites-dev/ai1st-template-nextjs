#!/usr/bin/env node
/**
 * cta-render.test.js — #1479 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/cta-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（6 个预设逐字、目录集合、两两不同）· AC3（bg 涂盒子还是整段）· AC4 的 DOM 那一半（照片铺底 /
 * 图在上）· AC5（表单三档、id 前缀、提交走 /api/leads）· AC6（bg 三档字色）· AC7 的 DOM / CSS 那一半 ·
 * AC8（槽位空不渲染）· AC9（validateSite）· AC10（block-roles）· AC11（首页配方池）。
 * 几何（16 种组合三端无横向滚动、块头宽度、图在上）要浏览器：`tests/e2e/specs/1479-cta-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 9）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
// #1533 —— 各块共有的深底反白（标题 · eyebrow · 主按钮 / 描边 / link）收进了全站一份（site-css.js §DEEP_COMMON，按块点名），
//    块的 block.css 里不再有；这里断言本块在那张登记表里、值没变。
const DEEP = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js')).DEEP_COMMON_CSS;
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'cta');
const SECTION = path.join(BLOCK, 'Section.tsx');
const FORM = path.join(SRC, 'components', 'BlockLeadForm.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的与构建期生成的换成替身（同 hero-render.test.js）────────
const STUB_DIR = path.join(NEXT, 'scripts', '.cta-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
// #1665 —— 块从 `site` prop 读站点数据（`config.ts` 是纯函数，加载真的那份）；这就是原来那个替身里的值。
const SITE = { siteId: 't-site', leadApi: 'https://lead.example', defaultLocale: 'en', locales: ['en'], formsByLocale: { en: [] },
  servicesByLocale: { en: [{ id: 'brakes', name: 'Brakes' }, { id: 'tires', name: 'Tires' }] } };
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
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

function loadSection(override) {
  for (const f of [SECTION, FORM]) delete require.cache[f];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}

let C; let DEMO; let manifestLib; let M;
try {
  C = loadSection();
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['cta'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('cta');
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 cta 那一份');
if (!M) die('blocks/ 里没有 cta');

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', site: SITE, block: { id: 'c', type: 'cta', shape, data: {} },
}));
const withOpts = (o, extra = {}) => ({ ...clone(DEMO), ...extra, options: { ...(DEMO.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("cta")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const frameTag = (html) => (/<div[^>]*data-part="frame"[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');

// ══ AC1：6 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同 ══════════════════════════════════════════
console.log('── AC1 六个预设');
{
  const WANT = [
    ['Centered', 'centered', 'centered', 'none', 'center', 'none', 'none'],
    ['Boxed', 'boxed', 'centered', 'boxed', 'center', 'none', 'none'],
    ['Inline', 'inline', 'inline', 'boxed', 'left', 'none', 'none'],
    ['Photo', 'photo', 'centered', 'boxed', 'left', 'left', 'none'],
    ['Lead form', 'lead-form', 'centered', 'boxed', 'center', 'none', 'full'],
    ['Cover', 'cover', 'inline', 'boxed', 'left', 'background', 'none'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, p.knobs.layout, p.knobs.frame, p.knobs.textAlign, p.knobs.image, p.knobs.form]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 6 条与正文表逐字相同（名字 · 形态 · 五个旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === 'layout,frame,textAlign,image,form'), '每个预设的 knobs 键就是这五个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['layout', ['centered', 'inline']], ['frame', ['none', 'boxed']], ['textAlign', ['left', 'center', 'right']],
    ['image', ['none', 'left', 'right', 'background']], ['form', ['none', 'teaser', 'full']],
  ]), `slots.options.knobs 名字依次 layout / frame / textAlign / image / form、values 逐字（${knobs.map((k) => k[0]).join(' / ')}）`);
  check(require('./lib/block-knobs').knobDefault(M.slots.options.knobs.find((k) => k.name === 'textAlign')) === 'center', '#1481：textAlign 排成 left · center · right 之后，没写值时仍是 center（显式 default 钉住，顺序只管展示）');
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 6 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 6, `同一份夹具下 6 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  // 反向对照：夹具里写死五个旋钮 ⟹ 形态不再起作用，6 份（去掉 data-shape）应当塌成 1 份。
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死五个旋钮 ⟹ 6 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
}

// ══ AC15：ctas 的上限 —— manifest 声明的 `max`（admin 工具栏的 0 / 1 / 2 从它派生）== 组件真截的数 ═════════════
console.log('\n── AC15 ctas.max == MAX_CTAS');
{
  const src = fs.readFileSync(SECTION, 'utf-8');
  const hit = src.match(/^const MAX_CTAS = (\d+);/m);
  check(!!hit, 'Section.tsx 里读得到 `const MAX_CTAS = N;`');
  const declared = M.slots.ctas && M.slots.ctas.max;
  check(hit && declared === Number(hit[1]), `manifest.slots.ctas.max（${declared}）=== MAX_CTAS（${hit && hit[1]}）`);
  // 行为那一半：夹具给 6 条按钮，页面上真画出来的也得是 max 条 —— 常量改了而 manifest 没跟，这里跟上面一起红。
  const six = clone(DEMO);
  six.ctas = Array.from({ length: 6 }, (_, i) => ({ label: `B${i}`, href: '#', style: i ? 'outline' : 'solid' }));
  six.options = { ...M.presets[0].knobs, form: 'none' };
  const drawn = (render(M.presets[0].shape, six).match(/data-cta="/g) || []).length;
  check(drawn === declared, `6 条按钮的夹具渲染出 ${drawn} 个 [data-cta]，等于 max ${declared}`);
  // 反向对照（单变量）：组件把常量改成 3、manifest 不动 ⟹ 画出 3 个，行为那条读到不相等。
  const C3 = loadSection(src.replace(/^const MAX_CTAS = \d+;/m, 'const MAX_CTAS = 3;'));
  try {
    const drawn3 = (render(M.presets[0].shape, six, C3).match(/data-cta="/g) || []).length;
    check(drawn3 === 3 && drawn3 !== declared, `反向对照：MAX_CTAS 改成 3 ⟹ 画出 ${drawn3} 个，与 max ${declared} 不等 —— 判据分得开`);
  } finally { loadSection(); }
}

// ══ AC3：bg 涂在哪 ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── AC3 bg 涂盒子 / 整段');
{
  const boxed = render('boxed', withOpts({}, { bg: '#1e293b' }));
  const flat = render('centered', withOpts({}, { bg: '#1e293b' }));
  check(/style="background:#1e293b"/.test(frameTag(boxed)) && !/style=/.test(sectionTag(boxed)), 'frame=boxed ⟹ 底色在盒子上，<section> 没有 style（段背景不变）');
  check(/style="background:#1e293b"/.test(sectionTag(flat)) && !/style=/.test(frameTag(flat)), 'frame=none ⟹ 底色在 <section> 上，盒子没有 style');
  check(/\[data-frame="boxed"\] \.cta-frame \{\s*background: var\(--scheme-surface-muted\);/.test(CSS), 'boxed 没写 bg 时盒子有默认浅底（block.css；#1472 起读 --scheme-surface-muted，light 值仍是 #f1f5f9）');
  check(/rounded-4 p-12 py-lg-16 px-lg-20/.test(frameTag(boxed)), `boxed 的盒子：rounded-4 p-12 py-lg-16 px-lg-20（${frameTag(boxed)}）`);
  // 反向对照：把 frame 判断拿掉（永远涂整段）⟹ 第一条要红。
  const src = fs.readFileSync(SECTION, 'utf-8');
  // #1534 —— 外壳收进了 BlockSection：「底色涂不涂在 <section> 上」是 paint={!boxed}；变异 = 永远涂。
  const broken = src.replace('paint={!boxed}', 'paint={true}');
  if (broken === src) die('AC3 反向对照没改到源码');
  const b2 = render('boxed', withOpts({}, { bg: '#1e293b' }), loadSection(broken));
  check(/style=/.test(sectionTag(b2)), '反向对照：boxed 也涂整段的组件 ⟹ <section> 上读得到 style');
  C = loadSection();
}

// ══ AC4：image ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC4 image');
{
  const cover = render('boxed', withOpts({ image: 'background' }));
  check(count(cover, 'data-part="bg"') === 1 && !/<img\b/.test(cover), 'background ⟹ 一层 [data-part="bg"] 照片、没有 <img>');
  check(/rgba\(2,6,23,\.55\)/.test(cover) && attr(cover, 'data-tone') === 'dark', 'background ⟹ 55% 深色遮罩 + data-tone="dark"（文字反白）');
  check(frameTag(cover) && cover.indexOf('data-part="bg"') > cover.indexOf('data-part="frame"'), 'boxed + background ⟹ 照片铺在盒子里');
  const coverFlat = render('centered', withOpts({ image: 'background' }));
  check(coverFlat.indexOf('data-part="bg"') < coverFlat.indexOf('data-part="frame"'), 'none + background ⟹ 照片铺整段（在盒子外）');
  check(/\[data-block="cta"\]\[data-tone="dark"\] \.btn-outline-primary,[\s\S]*?\{\s*color: #fff !important;\s*border-color: rgba\(255, 255, 255, 0\.6\) !important;/.test(DEEP),
    'site-css §DEEP_COMMON：深底时 outline 按钮反白描边');
  for (const side of ['left', 'right']) {
    const h = render('boxed', withOpts({ image: side }));
    check(count(h, 'data-part="image"') === 1 && h.indexOf('data-part="image"') > h.indexOf('class="cta-main"'),
      `image=${side} ⟹ 一张图、DOM 里在文字之后（#1536：图在哪一边由 mediaLayout 生成的方向规则摆）`);
  }
  // #1536 —— 图的位置不再写在 block.css，由 manifest 的 mediaLayout 生成（scripts/block-build/media-layout.js）。
  const MEDIA = require(path.join(NEXT, 'scripts', 'block-build', 'media-layout.js')).mediaLayoutCss(M, 'cta');
  check(/\[data-image="left"\] \.cta-row \{\s*flex-direction: row-reverse;/.test(MEDIA) && !/\[data-image="right"\] \.cta-row \{\s*flex-direction: row-reverse;/.test(MEDIA),
    'mediaLayout：≥992 image=left 行反向（DOM 里图在后，要摆到左边）、right 不反向');
  const none = render('boxed', withOpts({ image: 'none' }));
  check(!/<img\b/.test(none) && !none.includes('data-part="bg"'), 'image=none ⟹ DOM 里没有图');
}

// ══ AC5：表单 ════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC5 表单（DOM）');
const fieldIds = (h) => Array.from(h.matchAll(/<(?:input|select|textarea)[^>]*\bid="([a-z]+-[a-z]+)"/g)).map((x) => x[1]).filter((x) => !x.endsWith('-hp')).sort();
{
  const teaser = render('boxed', withOpts({ form: 'teaser' }));
  const full = render('boxed', withOpts({ form: 'full' }));
  const none = render('boxed', withOpts({ form: 'none' }));
  check(JSON.stringify(fieldIds(teaser)) === '["cta-phone"]' && !teaser.includes('data-part="ctas"'), `teaser ⟹ 只有 phone（${fieldIds(teaser)}）、ctas 不渲染`);
  check(JSON.stringify(fieldIds(full)) === '["cta-name","cta-phone","cta-service"]' && !full.includes('data-part="ctas"'), `full ⟹ name / phone / service（${fieldIds(full)}）、ctas 不渲染`);
  check(/<button[^>]*type="submit"/.test(teaser) && /<button[^>]*type="submit"/.test(full), '两档都有提交按钮');
  check(!/<form\b/.test(none) && none.includes('data-part="ctas"'), 'none ⟹ 没有 <form>、有按钮组');
  check(!/id="(hro|ftr)-/.test(teaser + full), 'id 前缀是 cta-（不跟 hero 的 hro- / footer 的 ftr- 撞）');
  check(render('lead-form', clone(DEMO)).includes('id="cta-service"'), 'Lead form 预设自带 full');
}

// ══ AC6：bg 三档字色 ═════════════════════════════════════════════════════════════════════════════
console.log('\n── AC6 bg 字色');
{
  const t = (bg, shape = 'boxed') => attr(render(shape, withOpts({}, { bg })), 'data-tone');
  check(t('#1e293b') === 'dark' && t('#0f172a') === 'dark', '#1e293b / #0f172a ⟹ dark');
  check(t('#ffffff') === 'light' && t('#f1f5f9') === 'light' && t('#e0f2fe') === 'light', '#ffffff / #f1f5f9 / #e0f2fe ⟹ light（深字）');
  check(t('brand') === 'brand' && /style="background:var\(--x-primary\)"/.test(frameTag(render('boxed', withOpts({}, { bg: 'brand' })))), 'brand ⟹ data-tone="brand"、盒子底是 var(--x-primary)');
  check(t(undefined) === 'light', '没写 bg ⟹ light');
  check(/\[data-block="cta"\]\[data-tone="dark"\] \.cta-title,\n\[data-block="cta"\]\[data-tone="brand"\] \.cta-title,[\s\S]*?\{\s*color: #fff !important;/.test(DEEP), 'site-css §DEEP_COMMON：dark / brand 时标题反白');
  // #1477 —— 深底 / brand 上的正文（text-muted）反白那条挪到了全站一份（scripts/lib/site-css.js §ON_DEEP_MUTED，白 .92），
  //    块自己的 block.css 里不再有（.72 那档正是 Chris 说看不清的灰）。
  const { ON_DEEP_MUTED } = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  check(/\[data-tone="dark"\] \.text-muted,\s*\n\[data-tone="brand"\] \.text-muted,[\s\S]*?\{\s*color: rgba\(255, 255, 255, \.92\) !important;/.test(ON_DEEP_MUTED)
    && !/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS), 'dark / brand 时正文（text-muted）反白：全站那条（白 .92），block.css 里没有自己那份');
  check(/\[data-block="cta"\]\[data-tone="brand"\] \.btn-primary,[\s\S]*?\{\s*background: #fff !important;\s*border-color: #fff !important;\s*color: var\(--x-primary\) !important;/.test(DEEP),
    'site-css §DEEP_COMMON：brand 时主按钮翻成白底主色字');
  const v = (bg) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'cta', data: { headline: 'H', bg } }] }], scope: 'edit' }));
  check(v('#1e293b').length === 0 && v('brand').length === 0, 'validateSite：#1e293b / brand 放行');
  check(['red', '#fff', 'rgb(0,0,0)'].every((b) => v(b).some((p) => p.includes('"bg"'))), 'validateSite：red / #fff / rgb() 被拒');
}

// ══ AC7：textAlign ══════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 textAlign');
{
  const h = render('centered', withOpts({ textAlign: 'center', layout: 'centered' }));
  check(attr(h, 'data-layout') === 'centered' && attr(h, 'data-text-align') === 'center', '根上挂着 data-layout / data-text-align');
  // #1486（T6.1）：宽度规则换成 left / right = 100%、center 在 ≥992 最宽 80%、居中（<992 没有这条 = 100%）。
  check(/@media \(min-width: 992px\) \{\s*\[data-block="cta"\]\[data-layout="centered"\]\[data-text-align="center"\] \.cta-main \{\s*width: 100%;\s*max-width: 80%;\s*margin-inline: auto;/.test(CSS)
    && !/\.cta-main \{[^}]*max-width: (?!80%|none)/.test(CSS),
  'block.css：centered + center 时文字块在 ≥992 最宽 80%、居中；别的组合不限宽');
  check(/\[data-layout="centered"\]\[data-text-align="center"\] \.cta-ctas,/.test(CSS), 'block.css：centered + center 时按钮居中');
  check(!/\[data-layout="inline"\][^{]*\{[^}]*max-width/.test(CSS), 'block.css：inline 下文字块不限宽（像素读数见 e2e）');
}

// ══ AC8：槽位空 → 不渲染 ═════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 槽位空不渲染');
{
  const full = render('photo', clone(DEMO));
  const cases = [
    ['eyebrow', 'data-part="eyebrow"'], ['body', 'data-slot="body"'], ['image', 'data-part="image"'], ['ctas', 'data-part="ctas"'],
  ];
  for (const [slot, needle] of cases) {
    const empty = render('photo', { ...clone(DEMO), [slot]: undefined });
    check(count(full, needle) >= 1 && count(empty, needle) === 0, `${slot}：有值渲染（${count(full, needle)}）、清空不渲染（${count(empty, needle)}）`);
  }
  check(count(full, 'data-cta=') === 2, `ctas 给 ${DEMO.ctas.length} 条只画 2 条（定稿 0–2）`);
  const noImgUrl = render('photo', { ...clone(DEMO), image: { alt: 'x' } });
  check(!noImgUrl.includes('data-part="image"'), 'image 只有 alt、没有 imageUrl ⟹ 不渲染');
  const blankEyebrow = render('photo', { ...clone(DEMO), eyebrow: { text: 'x', style: 'none' } });
  check(!blankEyebrow.includes('data-part="eyebrow"'), 'eyebrow.style=none ⟹ 不渲染');
  const styles = M.slots.eyebrow.choices.style.filter((s) => s !== 'none')
    .map((s) => (/data-eyebrow="([^"]*)"/.exec(render('photo', { ...clone(DEMO), eyebrow: { text: 'x', style: s } })) || [])[1]);
  check(styles.join() === 'pill,outline,dash,plain', `eyebrow 四式都画得出来（${styles.join(' / ')}）`);
  check(M.slots.eyebrow.choices.style[0] === 'none' && require('./lib/block-knobs').choiceDefault(M.slots.eyebrow, 'style') === 'pill',
    '#1481：词表 none 排第一之后，没写 style 时仍是 pill（choiceDefaults 钉住）');
  check((/data-eyebrow="([^"]*)"/.exec(render('photo', { ...clone(DEMO), eyebrow: { text: 'x' } })) || [])[1] === 'pill', '没写 style 的 eyebrow 渲染成 pill（Section 那一侧的兜底，与 choiceDefaults 一致）');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const v = (data, shape) => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'cta', ...(shape ? { shape } : {}), data: { headline: 'H', ...data } }] }], scope: 'edit',
  }));
  const rejects = [
    ['options.imagePos', { options: { imagePos: 'left' } }, '"imagePos"'],
    ['options.formMode', { options: { formMode: 'full' } }, '"formMode"'],
    ['options.form: "inline"', { options: { form: 'inline' } }, 'options.form'],
    ['form: {fields: [...]}', { form: { fields: ['name'] }, options: { form: 'full' } }, '"fields"'],
    ['bg: {stops: [\'#ffffff\']}', { bg: { stops: ['#ffffff'] } }, '"bg"'],
    ['bg: {stops: [\'#fff\', \'#000\']}', { bg: { stops: ['#fff', '#000'] } }, '"bg"'],
    ['写了 form 没写 options.form（Boxed 形态）', { form: { id: 'x' } }, 'options.form 没写', 'boxed'],
  ];
  for (const [name, data, needle, shape] of rejects) {
    const r = v(data, shape);
    check(r.length === 1 && r[0].includes(needle), `${name} ⟹ 报一条`, JSON.stringify(r));
  }
  for (const p of M.presets) {
    const r = v({ options: p.knobs, ...(p.knobs.image !== 'none' ? { image: { imageUrl: 'https://x.example/a.jpg', alt: 'a' } } : {}) }, p.shape);
    check(r.length === 0, `预设 ${p.name} 那组值放行`, JSON.stringify(r));
  }
  check(v({ form: { id: 'x' }, options: { form: 'full' } }).length === 0, 'form: {id: "x"} + options.form: "full" ⟹ 放行');
  // 演示内容是「全填版」（图 + 表单都有），给单格页切旋钮用；配上把两者都打开的旋钮就该 0 条。
  const demo = v({ ...clone(DEMO), options: { image: 'left', form: 'full' } });
  check(demo.length === 0, '演示内容那一份（options 打开 image / form）⟹ 0 条', JSON.stringify(demo));
}

// ══ AC10 / AC11：block-roles · 首页配方池 ══════════════════════════════════════════════════════════
console.log('\n── AC10 / AC11 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['cta'] === M.roleDefault, `block-roles.json 的 cta（${roles['cta']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  check('cta' in recipe.NOT_IN_POOL, "'cta' in NOT_IN_POOL");
  const all = manifestLib.loadManifests();
  const without = new Map([...all].filter(([k]) => k !== 'cta'));
  const pool = recipe.poolFor(all);
  // 合入前 = 块库里没有 cta、排除名单里也没有它（名单点名不在库里的块会当场抛错）。
  const saved0 = recipe.NOT_IN_POOL['cta'];
  delete recipe.NOT_IN_POOL['cta'];
  let before;
  try { before = recipe.poolFor(without); } finally { recipe.NOT_IN_POOL['cta'] = saved0; }
  check(JSON.stringify(pool) === JSON.stringify(before), `poolFor 与没有 cta 时是同一个集合（${pool.length} 种）`);
  check(M.prompt && M.prompt.group === 'homepage', 'prompt.group == homepage（否则进了排除名单反而抛错）');
  // 反向对照：从排除名单拿掉 cta ⟹ 它进池子、池子多一种。
  // 🔴 #1483（Chris 2026-09-30 解开新块票的串行）—— 不写死种数：每落一个新块池子就变（#1475 / #1485 / #1482 各动过一次
  //    这里的 13 / 14 / 15），写死 `=== N` 会让并行的姊妹票为同一个数互相打红。判据是「含它」+「比排除时多 1」。
  const saved = recipe.NOT_IN_POOL['cta'];
  delete recipe.NOT_IN_POOL['cta'];
  try {
    const leaked = recipe.poolFor(all);
    check(leaked.includes('cta') && leaked.length === pool.length + 1, `反向对照：不排除它 ⟹ 进池子（${leaked.length} = ${pool.length} + 1 种）—— 判据分得开`);
  } finally { recipe.NOT_IN_POOL['cta'] = saved; }
}

// ══ AC12：Puck 那一侧的 schema（往返无损由 editor-roundtrip.test.js 对全部页面块量）════════════════════
console.log('\n── AC12 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'cta');
  check(!!on, 'Puck 组件里有 cta（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  // image 槽不带 editLabel ⟹ 不出侧栏字段（同 hero）：图在画布上换。#1471 起 form 槽（`{id?}`）出一格「选哪张站级表单」
  // 的下拉（露多少仍由 form 旋钮管），位置照 manifest 槽位的书写顺序。
  check(JSON.stringify(order) === JSON.stringify(['options', 'eyebrow', 'headline', 'body', 'ctas', 'form', 'bg']),
    `字段顺序 = 旋钮 → eyebrow → 内容 → form → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === 'layout,frame,textAlign,image,form', '第一个字段：预设 6 个 → 旋钮 layout / frame / textAlign / image / form');
  const bg = on.fields.find((f) => f.slot === 'bg');
  check(bg.control === 'color' && bg.swatches.join() === '#ffffff,#f1f5f9,#e0f2fe,brand,#1e293b,#0f172a', 'bg 字段是色板（manifest 的 6 色 swatches）');
  check(on.fields.find((f) => f.slot === 'eyebrow').subs.some((x) => x.sub === 'style' && x.choices.length === 5), 'eyebrow.style 是五选一');
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[1].knobs) === 'Boxed' && presetNameFor(man, { ...M.presets[1].knobs, image: 'right' }) === 'custom',
    '点 Boxed = 那一组旋钮；拧偏一个（image=right）⟹ custom');
}

// 📌 #1425（T3）—— 这里原来测 AC13「blocks/cta-banner 相对 merge-base 零改动」；cta-banner 随旧库删了。

// ══ AC5：提交那一半（happy-dom 里真渲染整块、真点提交，fetch 换成记录器）══════════════════════════
console.log('\n── AC5 表单（提交）');
(async () => {
  let Window;
  try { ({ Window } = require('happy-dom')); } catch (e) { die(`happy-dom 载入不了：${e.message}`); }
  const win = new Window({ url: 'https://site.example/' });
  const g = globalThis;
  const saved = {};
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
    saved[k] = Object.getOwnPropertyDescriptor(g, k);
    Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  win.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  g.fetch = win.fetch;
  try {
    const Comp = loadSection();
    const { createRoot } = require('react-dom/client');
    const { act } = require('react');
    const host = win.document.createElement('div');
    win.document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(React.createElement(Comp, { data: withOpts({ form: 'teaser' }), locale: 'en', site: SITE, block: { id: 'c', type: 'cta', shape: 'boxed', data: {} } })); });
    const el = host.querySelector('#cta-phone');
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, '416-555-0199');
    await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); });
    await act(async () => { host.querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const body = calls[0] ? JSON.parse(calls[0].init.body) : {};
    check(calls.length === 1 && calls[0].url === 'https://lead.example/api/leads' && calls[0].init.method === 'POST',
      `teaser 提交 = 一次 POST ${calls[0] ? calls[0].url : '（没发）'}`);
    check(body.phone === '416-555-0199' && body.siteId === 't-site', `请求体带 phone / siteId（${JSON.stringify(body)}）`);
  } catch (e) {
    bad(`happy-dom 那一段抛了：${e.stack || e.message}`);
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})();
