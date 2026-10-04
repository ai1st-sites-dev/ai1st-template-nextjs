#!/usr/bin/env node
/**
 * hero-render.test.js — #1463 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/hero-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（5 个预设两两不同）· AC2 的 DOM 那一半（image=none 没有 <img>、form≠none 没有按钮有 <form>）·
 * AC3 的 DOM 那一半（#1470：image 六档的行类）· AC4（字色 + 非法颜色被拒）· AC5（部件有值才画、band 张数 = 列数）·
 * AC6（#1470：form 槽只剩 {id?}、teaser / full 两档露的字段、提交走 POST /api/leads、不跳页）· AC7（eyebrow 五式）·
 * AC10（AI 建站能选到它：提示词菜单里有它、「一共几种块」数它；block-roles.json 有它；layout 挂 /site.css）。
 * 几何（三端横向滚动、图真的换了位置、列等宽）要浏览器：`tests/e2e/specs/1463-hero-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 7）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { spawnSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
// #1533 —— 各块共有的深底反白（标题 · eyebrow · 主按钮 / 描边 / link）收进了全站一份（site-css.js §DEEP_COMMON，按块点名），
//    块的 block.css 里不再有；这里断言本块在那张登记表里、值没变。
const DEEP = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js')).DEEP_COMMON_CSS;
const SRC = path.join(NEXT, 'src');
const SECTION = path.join(NEXT, 'blocks', 'hero', 'Section.tsx');
// #1471 —— hero 自己那份表单删了，改用四个块共用的那一份。
const FORM = path.join(NEXT, 'src', 'components', 'BlockLeadForm.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的与构建期生成的三样换成替身（跟被测那一维无关）────────
// 替身放在 scripts/ 底下（不放 /tmp）：它们要 require('react')，得从这棵树的 node_modules 解析到（block-slots.test.js 同一做法）。
const STUB_DIR = path.join(NEXT, 'scripts', '.hero-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={siteId:"t-site",leadApi:"https://lead.example",'
    + 'getServices:()=>[{id:"brakes",name:"Brakes"},{id:"tires",name:"Tires"}]};\n'),
};
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
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['hero'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('hero');
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 hero 那一份');
if (!M) die('blocks/ 里没有 hero');

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (shape, data, Comp = C) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', block: { id: 'h', type: 'hero', shape, data: {} },
}));
const withOpts = (o, extra = {}) => ({ ...clone(DEMO), ...extra, options: { ...(DEMO.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
// 建站档（scope create）还会问**整个站**的问题（例如 photography 站必须有 gallery；#1425（T3）起不再有「每个站都要有 contact-info」），跟这个块无关 ——
// 这里只看点名了 hero 的那几条。
const own = (r) => r.problems.filter((p) => p.includes('("hero")'));
const attr = (html, name) => { const m = new RegExp(`<section[^>]*\\s${name}="([^"]*)"`).exec(html); return m ? m[1] : null; };

// ══ AC1：5 个预设，名字逐字，同一份夹具下两两不同 ════════════════════════════════════════════════
console.log('── AC1 五个预设');
{
  const want = ['Split', 'Centered', 'Cover', 'Lead form', 'Text only'];
  const got = (M.presets || []).map((p) => p.name);
  check(JSON.stringify(got) === JSON.stringify(want), `manifest presets 5 条、名字逐字相同（${got.join(' / ')}）`);
  const dirs = M.shapes.map((s) => s.name);
  check((M.presets || []).every((p) => dirs.includes(p.shape)) && dirs.length === 5,
    `每个预设都有自己的形态目录（${dirs.join(' / ')}）`);
  check(fs.readdirSync(path.join(NEXT, 'blocks', 'hero')).filter((f) => f === 'Section.tsx').length === 1
    && M.shapes.every((s) => !fs.existsSync(path.join(NEXT, 'blocks', 'hero', s.name, 'Section.tsx'))),
  '一份 Section.tsx（形态目录里没有第二份 markup）');
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  const uniq = new Set(htmls);
  check(uniq.size === 5, `5 个预设渲染出 ${uniq.size} 份互不相同的 HTML`);
  // 反向对照：演示内容里写死三个旋钮 ⟹ 形态不再起作用，5 份应当塌成 1 份（这正是开发时踩过的坑）。
  const pinned = dirs.map((d) => render(d, withOpts({ textAlign: 'left', image: 'left', form: 'none' })));
  check(new Set(pinned.map((h) => h.replace(/data-shape="[^"]*"|--hro-preset/g, ''))).size === 1,
    '反向对照：options 里写死三个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
}

// ══ AC2 的 DOM 那一半：54 种组合都渲染；image=none 没有主图；form≠none 没有按钮、有 <form> ═══════════
// 🔴 #1470 —— 图列画不画 = image ∈ {left, right, top, bottom} 且有图（这四档是「旁边 / 上下有一张图」）。
const SIDE_IMAGES = ['left', 'right', 'top', 'bottom'];
console.log('\n── AC2 旋钮（DOM）');
{
  const knobs = Object.fromEntries(M.slots.options.knobs.map((k) => [k.name, k.values]));
  check(JSON.stringify(knobs.image) === JSON.stringify(['none', 'left', 'right', 'top', 'bottom', 'background']),
    `image 六档、顺序逐字（${(knobs.image || []).join(' / ')}）`);
  const combos = [];
  for (const textAlign of knobs.textAlign) for (const image of knobs.image) for (const form of knobs.form) combos.push({ textAlign, image, form });
  check(combos.length === 54, `textAlign × image × form = ${combos.length}`);
  const problems = [];
  for (const o of combos) {
    let html;
    try { html = render('split', withOpts(o)); } catch (e) { problems.push(`${JSON.stringify(o)} 抛了 ${e.message}`); continue; }
    const tag = `${o.textAlign}/${o.image}/${o.form}`;
    if (attr(html, 'data-text-align') !== o.textAlign || attr(html, 'data-image') !== o.image || attr(html, 'data-form') !== o.form) {
      problems.push(`${tag}: 根元素上的旋钮读数对不上`);
    }
    if (attr(html, 'data-align') !== null || attr(html, 'data-reverse') !== null) problems.push(`${tag}: 根元素上还挂着退役的 data-align / data-reverse`);
    const mainImgs = count(html, 'hro-img') + count(html, 'data-part="bg"');
    if (o.image === 'none' && mainImgs) problems.push(`${tag}: image=none 却有主图`);
    if (SIDE_IMAGES.includes(o.image) && count(html, 'hro-img') !== 1) problems.push(`${tag}: image=${o.image} 却不是恰好一张 .hro-img`);
    if (o.image === 'background' && count(html, 'data-part="bg"') !== 1) problems.push(`${tag}: image=background 却没有 [data-part="bg"]`);
    // 「DOM 里没有 <img>（band / logos / proof 里的除外）」：去掉这三个部件再数一次。
    const bare = render('split', { ...withOpts(o), band: [], logos: undefined, proof: undefined });
    if (!SIDE_IMAGES.includes(o.image) && /<img\b/.test(bare)) problems.push(`${tag}: 去掉 band/logos/proof 之后 DOM 里还有 <img>`);
    if (o.form !== 'none' && (count(html, 'data-part="ctas"') || !/<form\b/.test(html))) problems.push(`${tag}: 有表单时还有按钮组 / 没有 <form>`);
    if (o.form === 'none' && (!count(html, 'data-part="ctas"') || /<form\b/.test(html))) problems.push(`${tag}: 没表单时按钮组不在 / 却有 <form>`);
  }
  check(problems.length === 0, '54 种组合逐个核：主图 / 按钮 / 表单三件事都对', problems.join(' | '));
  // 反向对照：让 image=none 那一支照样画主图 ⟹ 同一段检查必须点名。锚逐字是 Section.tsx 里「图列画不画」那一行。
  const src = fs.readFileSync(SECTION, 'utf-8');
  const broken = src.replace("const side = (k.image === 'left' || k.image === 'right' || k.image === 'top' || k.image === 'bottom') && !!img;", "const side = !!img;");
  if (broken === src) die('反向对照没改到源码（那一行换了写法？）');
  const C2 = loadSection(broken);
  const leaked = render('split', { ...withOpts({ image: 'none' }), band: [], logos: undefined, proof: undefined }, C2);
  check(/<img\b/.test(leaked), '反向对照：image=none 也画主图的组件 ⟹ 上面那道检查会读到 <img>');
  C = loadSection();
}

// ══ AC3 的 DOM 那一半：image 六档的行类（#1470 —— reverse 退役，它的两套类归到 left / top 名下）════════════
console.log('\n── AC3 image 六档（行类）');
{
  const row = (html) => (/class="(row align-items-center[^"]*)"/.exec(html) || [])[1] || '';
  // 每一档该有 / 不该有的 reverse 类。left = 旧 normal + reverse；top = 旧 center + reverse；right / bottom 行上没有。
  const WANT = {
    left: ['flex-column-reverse', 'flex-lg-row-reverse'],
    top: ['flex-column-reverse'],
    right: [],
    bottom: [],
  };
  const rowProblems = (Comp) => {
    const out = [];
    for (const [image, want] of Object.entries(WANT)) {
      const html = render('split', withOpts({ textAlign: 'left', image }), Comp);
      const cls = row(html).split(/\s+/).filter((c) => /reverse/.test(c)).sort();
      if (JSON.stringify(cls) !== JSON.stringify([...want].sort())) out.push(`${image}: 行上 reverse 类是 [${cls.join(' ')}]，应当是 [${want.join(' ')}]`);
      if (!(html.indexOf('hro-textcol') < html.indexOf('hro-side'))) out.push(`${image}: DOM 里文字列不在图列前面`);
    }
    return out;
  };
  const probs = rowProblems(C);
  check(probs.length === 0, '四档有图列的：left 有 flex-column-reverse + flex-lg-row-reverse、top 只有 flex-column-reverse、right / bottom 没有；DOM 恒为文字在前', probs.join(' | '));
  // 反向对照：把 image=left 的行类换成 image=right 的（去掉 reverse）⟹ 上面那条必须点名 left。
  const src = fs.readFileSync(SECTION, 'utf-8');
  const anchor = "if (image === 'left') return `${base} flex-column-reverse flex-lg-row-reverse`;";
  const swapped = src.replace(anchor, "if (image === 'left') return base;");
  if (swapped === src) die('AC3 反向对照没改到源码（rowClass 里 image=left 那一行换了写法？）');
  const bad3 = rowProblems(loadSection(swapped));
  check(bad3.length === 1 && bad3[0].startsWith('left:'), `反向对照：left 拿 right 的行类 ⟹ 恰好点名 left（${bad3.join(' | ') || '没点名'}）`);
  C = loadSection();
}

// ══ AC4：bg ════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC4 bg');
{
  const { toneFor, relativeLuminance } = require(path.join(NEXT, 'scripts', 'lib', 'contrast.js'));
  const t = (bg) => attr(render('split', withOpts({}, { bg })), 'data-tone');
  check(t('#0f172a') === 'dark' && t('#1e293b') === 'dark', '#0f172a / #1e293b ⟹ 深底（标题反白由 block.css 的 data-tone="dark" 那几条上色）');
  check(t('#ffffff') === 'light' && t('#f1f5f9') === 'light' && t('#e0f2fe') === 'light', '#ffffff / #f1f5f9 / #e0f2fe ⟹ 浅底（深字）');
  check(t('#FFFFFF') === 'light' && t('#0F172A') === 'dark', '大写十六进制一样认');
  check(t('brand') === 'brand', 'brand ⟹ 主色底');
  const brandHtml = render('split', withOpts({}, { bg: 'brand' }));
  check(/<section[^>]*style="background:var\(--x-primary\)"/.test(brandHtml), 'brand ⟹ 背景是 var(--x-primary)（主题主色）');
  check(t('#808080') === (relativeLuminance('#808080') < 0.4 ? 'dark' : 'light') && toneFor('#808080') === 'dark',
    `门槛是相对亮度 0.4：#808080 的亮度 ${relativeLuminance('#808080').toFixed(3)} ⟹ dark`);
  const css = fs.readFileSync(path.join(NEXT, 'blocks', 'hero', 'block.css'), 'utf-8');
  check(/\[data-block="hero"\]\[data-tone="dark"\] \.hro-title,[\s\S]*?color: #fff !important/.test(DEEP), 'site-css §DEEP_COMMON：深底时标题 color #fff !important');
  check(/\[data-block="hero"\]\[data-tone="brand"\] \.btn-primary,[\s\S]*?\{\s*background: #fff !important/.test(DEEP), 'site-css §DEEP_COMMON：主色底时主按钮白底');
  check(/\[data-block="hero"\]\[data-tone="dark"\] \.btn-primary,\n\[data-block="hero"\]\[data-tone="brand"\] \.btn-primary,[\s\S]*?\{\s*background: #fff !important/.test(DEEP),
    'site-css §DEEP_COMMON：深底时主按钮也翻白底（正文「相对亮度 < 0.4 反白…按钮翻成白底」）');
  check(!/data-tone="(dark|brand)"\] \.(hro-title|btn-primary) \{/.test(css), 'block.css：这两条不再自己抄一份');
  const v = (bg) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'hero', data: { headline: 'H', bg } }] }] }));
  check(v('#0f172a').length === 0 && v('#0F172A').length === 0 && v('brand').length === 0, 'validateSite：#0f172a / #0F172A / brand 都放行');
  const bads = ['red', '#fff', '#12345g', 'rgb(0,0,0)', 7];
  const rejected = bads.filter((b) => v(b).some((p) => p.includes('"bg"')));
  check(rejected.length === bads.length, `validateSite：非法值逐个被拒（${bads.map((b) => JSON.stringify(b)).join(' / ')}）`,
    `只拒了 ${rejected.length}/${bads.length}`);
}

// ══ #1477：bg 可以是渐变（hero 接上共用的 toneForBg / bgCss）══════════════════════════════
console.log('\n── #1477 渐变 bg');
{
  const DEEP = { stops: ['#0f172a', '#1e293b'], angle: 135 };
  const LIGHT = { stops: ['#ffffff', '#f1f5f9'] };
  const section = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
  const deep = render('split', withOpts({}, { bg: DEEP }));
  check(/style="background:linear-gradient\(135deg,#0f172a,#1e293b\)"/.test(section(deep)) && attr(deep, 'data-tone') === 'dark',
    'AC1：{stops:[#0f172a,#1e293b],angle:135} ⟹ 根上 linear-gradient(135deg,…)、data-tone=dark（标题 / 正文反白）', section(deep));
  const light = render('split', withOpts({}, { bg: LIGHT }));
  check(/linear-gradient\(135deg,#ffffff,#f1f5f9\)/.test(section(light)) && attr(light, 'data-tone') === 'light',
    'AC1：{stops:[#ffffff,#f1f5f9]}（没写角度 = 135）⟹ 深字（data-tone=light）', section(light));
  // 阳性对照（正文 AC1）：把 toneForBg 那行换回 toneFor，深渐变那一格当场红（toneFor 收到对象回 light）。
  // #1534 —— 深浅从块里搬进了共用外壳（src/components/BlockSection.tsx §blockTone），这一行住在那里，变异也打在那里。
  const SHELL = path.join(SRC, 'components', 'BlockSection.tsx');
  const shellSrc = fs.readFileSync(SHELL, 'utf-8');
  const want = "return cover ? 'dark' : toneForBg(bg);";
  if (!shellSrc.includes(want)) die(`阳性对照要替换的那一句不在 BlockSection.tsx 里：${want}`);
  sourceOverride.set(SHELL, shellSrc.replace(want, "return cover ? 'dark' : toneFor(bg);")
    .replace("import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';",
      "import { bgCss, bsThemeForBg, toneFor, type BgValue } from '../../scripts/lib/contrast.js';"));
  delete require.cache[SHELL];
  const mutant = loadSection();
  check(attr(render('split', withOpts({}, { bg: DEEP }), mutant), 'data-tone') === 'light',
    '阳性对照：换回 toneFor ⟹ 同一个深渐变读成 light（上面那格就是靠这一行才对的）');
  sourceOverride.delete(SHELL);
  delete require.cache[SHELL];
  loadSection();
  // AC2：非法对象不静默 —— isColorValue 全返 false、validateSite 各报一条，报错那句写着渐变写法。
  const { isColorValue } = require(path.join(NEXT, 'scripts', 'lib', 'contrast.js'));
  const v = (bg) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'hero', data: { headline: 'H', bg } }] }] }));
  const badObjs = [{ stops: ['#0f172a'] }, { stops: ['#000000', '#111111', '#222222', '#333333'] }, { stops: ['red', 'blue'] },
    { stops: ['#000000', '#ffffff'], angle: '90' }];
  const flagged = badObjs.filter((b) => !isColorValue(b) && v(b).filter((x) => x.includes('"bg"')).length === 1);
  check(flagged.length === badObjs.length, `AC2：四种非法渐变 isColorValue=false、validateSite 各报一条（${flagged.length}/${badObjs.length}）`);
  const msg = v(badObjs[0]).find((x) => x.includes('"bg"')) || '';
  check(msg.includes('stops') && msg.includes('brand'), 'AC2：报错那句写着渐变写法（含 stops）', msg);
  check(v(DEEP).length === 0 && v(LIGHT).length === 0, '合法渐变 validateSite 放行');
}

// ══ AC5：部件 ══════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC5 部件');
{
  const parts = { proof: 'data-part="proof"', stats: 'data-part="stats"', logos: 'data-part="logos"', band: 'data-part="band"' };
  for (const [slot, cls] of Object.entries(parts)) {
    const full = render('split', withOpts({}));
    const none = render('split', { ...withOpts({}), [slot]: undefined });
    check(count(full, cls) >= 1 && count(none, cls) === 0, `${slot}：有值渲染（${count(full, cls)}）、空值不渲染（${count(none, cls)}）`);
  }
  const cols = (n) => { const h = render('split', { ...withOpts({}), band: DEMO.band.slice(0, n) }); return [count(h, 'data-part="band-col"'), (/data-band-count="(\d+)"/.exec(h) || [])[1]]; };
  const [c1, a1] = cols(1); const [c6, a6] = cols(6);
  check(c1 === 1 && a1 === '1' && c6 === 6 && a6 === '6', `band 给 1 张 ⟹ ${c1} 列；给 6 张 ⟹ ${c6} 列（col-md 均分，列宽几何见 e2e）`);
  const h8 = render('split', { ...withOpts({}), band: [...DEMO.band, ...DEMO.band] });
  check(count(h8, 'data-part="band-col"') === 6, '给 12 张只画 6 张（定稿上限 1–6）');
  check(count(render('split', withOpts({})), 'data-cta=') === 2, `ctas 给 ${DEMO.ctas.length} 个，只画 2 个（定稿 ≤2）`);
  check(count(render('split', withOpts({})), 'data-slot="stats.') === 6, `stats 给 ${DEMO.stats.length} 条，只画 3 条（值 + 说明 = 6 个钩子）`);
}

// ══ AC6：表单 —— 校验器那一半 ═══════════════════════════════════════════════════════════════════
console.log('\n── AC6 表单（validateSite）');
{
  const v = (form, options = {}, shape) => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'hero', ...(shape ? { shape } : {}), data: { headline: 'H', form, options } }] }],
  }));
  // 🔴 #1470 —— 表单是站级资产（#1471），`form` 槽只剩 `{id?}`；露多少只存 `options.form` 一处（block-knobs.js:13）。
  check(v({ id: 'x' }, { form: 'full' }).length === 0, '{id: "x"} + options.form: "full" ⟹ 放行', JSON.stringify(v({ id: 'x' }, { form: 'full' })));
  check(v({ id: 'x' }, { form: 'teaser' }).length === 0, '{id: "x"} + options.form: "teaser" ⟹ 放行');
  const fld = v({ fields: ['name', 'phone'] }, { form: 'full' });
  check(fld.some((p) => p.includes('"form"') && p.includes('"fields"')), 'form 槽里写 fields（#1463 的旧写法）⟹ 报错', JSON.stringify(fld));
  const btn = v({ id: 'x', buttonText: 'Go' }, { form: 'full' });
  check(btn.some((p) => p.includes('"form"') && p.includes('"buttonText"')), 'form 槽里写 buttonText ⟹ 报错', JSON.stringify(btn));
  for (const old of ['inline', 'stacked', 'modal']) {
    const r = v({ id: 'x' }, { form: old });
    check(r.some((p) => p.includes('options.form')), `旋钮取值不在词表（form: "${old}"）⟹ 报错`, JSON.stringify(r));
  }
}

// ══ #1463 r3（QA2 真 AI 改站抓到）：键写歪 ⟹ 当场报，不许「校验放行、页面上什么都没出来」 ═════════════
console.log('\n── r3 键写歪（validateSite）');
{
  const one = (data, shape, scope = 'edit') => own(manifestLib.validateSite({
    pages: [{ slug: 'about', blocks: [{ type: 'hero', ...(shape ? { shape } : {}), data }] }], scope,
  }));
  // QA2 那一块，逐字（AI 第 2 次 write_file 写进去、r2 校验 0 条放行的那份）。
  const qa2 = {
    eyebrow: { text: "Toronto's Trusted Auto Shop", style: 'dash' }, headline: 'About Northside Auto Care', subheadline: 'x',
    options: { align: 'left', image: 'normal', background: 'dark', backgroundColor: '#0f172a' },
    form: { layout: 'stacked', fields: ['name', 'phone', 'service'], button: { label: 'Get a Free Quote', href: '/quote' } },
    stats: [{ value: '15+', label: 'Years Serving Toronto' }],
  };
  const got = one(qa2);
  check(got.some((p) => p.includes('"background"') && p.includes('"bg"')) && got.some((p) => p.includes('"backgroundColor"')),
    'options 里的生词（background / backgroundColor）⟹ 报错，并指向顶层 bg', JSON.stringify(got));
  check(got.some((p) => p.includes('"layout"') && p.includes('"button"') && p.includes('只认 id')),
    'form 里的生词（layout / button / fields）⟹ 报错，并列出认得的键（#1470 起只有 id）', JSON.stringify(got));
  check(got.some((p) => p.includes('options.form 没写')), 'form 有内容、options.form 没写（默认 none）⟹ 报错', JSON.stringify(got));
  check(got.length > 0 && one(qa2, undefined, 'create').length === got.length, `建站档同样拦（${got.length} 条）`);
  const build = manifestLib.validateSite({ pages: [{ slug: 'about', blocks: [{ type: 'hero', data: qa2 }] }], scope: 'build' });
  check(got.length > 0 && own(build).length === 0 && build.warnings.filter((w) => w.includes('("hero")')).length === got.length, '构建档只警告（#999：构建期不设硬闸）');
  // 改对之后放行 —— 同一份内容，键写到该写的地方。
  const fixed = {
    ...qa2, bg: '#0f172a', options: { textAlign: 'left', image: 'left', form: 'full' },
    form: { id: 'quote' },
  };
  check(one(fixed).length === 0, '同一份内容改对（bg 顶层、options.form、form 只写 id）⟹ 0 条', JSON.stringify(one(fixed)));
  check(one({ headline: 'H', options: { form: 'none' }, form: { id: 'quote' } }).length === 0, '明写 options.form: "none" ⟹ 不报（是明说不要）');
  check(one({ headline: 'H', form: { id: 'quote' } }, 'lead-form').length === 0, '形态 lead-form 自带 full ⟹ 不写 options.form 也放行');
  const retired = one({ headline: 'H', options: { align: 'left', reverse: true, image: 'normal' } });
  check(retired.some((p) => p.includes('"align"')) && retired.some((p) => p.includes('"reverse"')) && retired.some((p) => p.includes('options.image') && p.includes('"normal"')),
    '#1470 退役的写法各报一条：options.align / options.reverse / image: "normal"', JSON.stringify(retired));
  check(one({ headline: 'H', background: '#000' }).some((p) => p.includes('data 里没有 "background"')), 'data 顶层的生词 ⟹ 报错');
  check(one({ headline: 'H', stats: [{ value: '1', label: 'a', icon: 'x' }] }).some((p) => p.includes('"stats" 里没有 "icon"')), '列表槽条目里的生词 ⟹ 报错');
  check(one(clone(DEMO), 'lead-form').length === 0, '演示内容那一份（全部件、lead-form 形态）⟹ 0 条', JSON.stringify(one(clone(DEMO), 'lead-form')));
  // 下拉选项由 Section 读站内服务列表传给表单（page-deps 只看 Section.tsx 找 getServices —— QA2 不阻断发现 1）。
  const lf = render('lead-form', clone(DEMO));
  check(/<option value="Brakes"/.test(lf) && /<option value="Tires"/.test(lf), 'lead-form 的「需求」下拉 = 站内服务列表（Section 读、传给表单）');
  const deps = require(path.join(NEXT, 'scripts', 'lib', 'page-deps.js')).blockTypesReadingServices(NEXT);
  check(deps.types.has('hero') && !deps.unmapped.some((f) => f.includes('hero')),
    `page-deps 把 hero 算进「读 services 的块」、没有未归属的文件（unmapped=${JSON.stringify(deps.unmapped)}）`);
  // 📌 #1425（T3）—— 这里原来测「老块（hero）data 里的生词不报 —— 收紧只落在带旋钮的块上」；不带旋钮的老块随旧库删了
  //    （今天块库 17 个块全带旋钮，hero 就是带旋钮的那个），那条反向臂在库里找不到等价物。
}

// ══ AC6：表单 —— 提交那一半（happy-dom 里真渲染、真点提交，fetch 换成记录器）════════════════════
console.log('\n── AC6 表单（提交）');
(async () => {
  let Window;
  try { ({ Window } = require('happy-dom')); } catch (e) { die(`happy-dom 载入不了（它随 @puckeditor/core 一起装）：${e.message}`); }
  const run = async (variant, forms) => {
    const win = new Window({ url: 'https://site.example/quote' });
    const g = globalThis;
    const saved = {};
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
      saved[k] = Object.getOwnPropertyDescriptor(g, k);
      Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
    }
    g.IS_REACT_ACT_ENVIRONMENT = true;
    const calls = [];
    const assigned = [];
    win.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
    g.fetch = win.fetch;
    win.location.assign = (u) => { assigned.push(u); };
    try {
      delete require.cache[FORM];
      const F = require(FORM).default;
      const { createRoot } = require('react-dom/client');
      const { act } = require('react');
      const host = win.document.createElement('div');
      win.document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => { root.render(React.createElement(F, { mode: variant, locale: 'en', ...(forms ? { forms } : {}), services: [{ id: 'brakes', name: 'Brakes' }, { id: 'tires', name: 'Tires' }] })); });
      const setVal = async (sel, val) => {
        const el = host.querySelector(sel);
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, val);
        await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); });
      };
      const ids = [...host.querySelectorAll('input:not(#hro-hp), select, textarea')].map((el) => el.id);
      if (host.querySelector('#hro-name')) await setVal('#hro-name', 'Sam Driver');
      await setVal('#hro-phone', '416-555-0199');
      if (host.querySelector('#hro-service')) await setVal('#hro-service', 'Brakes');
      await act(async () => { host.querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      return { calls, assigned, ids, html: host.innerHTML, url: win.location.href };
    } finally {
      for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
    }
  };
  try {
    const r = await run('full');
    check(JSON.stringify(r.ids) === JSON.stringify(['hro-name', 'hro-phone', 'hro-service']), `full 露 name / phone / service（${r.ids.join(' / ')}）`);
    const body = r.calls[0] ? JSON.parse(r.calls[0].init.body) : {};
    check(r.calls.length === 1 && r.calls[0].url === 'https://lead.example/api/leads' && r.calls[0].init.method === 'POST',
      `提交 = 一次 POST ${r.calls[0] ? r.calls[0].url : '（没发）'}`);
    check(body.siteId === 't-site' && body.name === 'Sam Driver' && body.phone === '416-555-0199'
      && body.message === 'Service: Brakes' && body.source === 'contact-form' && body.hp === '' && !('meta' in body),
    `请求体字段对（${JSON.stringify(body)}）；站没有表单库 ⟹ 不带 meta.formId`);
    check(r.assigned.length === 0 && r.url === 'https://site.example/quote', '没写 redirect ⟹ 不跳页');
    check(/data-part="form-success"[^>]*>Thanks! We(?:'|&#x27;|&#39;)ve got your details and will be in touch\.</.test(r.html) && !/<form\b/.test(r.html),
      '成功后原地出现内置的成功提示（站没有表单库时），表单收起');
    check(!/data-slot="form\./.test(r.html), '表单上不挂 data-slot="form.…"（槽里没有可改的键）');
    const t = await run('teaser');
    const tb = t.calls[0] ? JSON.parse(t.calls[0].init.body) : {};
    check(JSON.stringify(t.ids) === JSON.stringify(['hro-phone']) && t.calls.length === 1 && t.calls[0].url === 'https://lead.example/api/leads'
      && tb.phone === '416-555-0199' && t.assigned.length === 0,
    `teaser 只露 phone（${t.ids.join(' / ')}）+ 按钮，提交同样一次 POST /api/leads、不跳页`);
    // #1471 —— 有站级表单库：teaser 露那张的 primary，提交带 meta.formId；成功提示是那张表单的。
    const forms = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_SITE.forms;
    const q = await run('teaser', forms);
    const qb = q.calls[0] ? JSON.parse(q.calls[0].init.body) : {};
    check(JSON.stringify(q.ids) === JSON.stringify(['hro-phone']) && qb.phone === '416-555-0199' && qb.meta && qb.meta.formId === 'quote',
      `表单库在 + form.id 空 ⟹ 用第一张 quote：teaser 露 phone、请求体 meta = ${JSON.stringify(qb.meta)}`);
    check(q.html.includes(forms[0].successMessage.replace(/'/g, '&#x27;')) || q.html.includes(forms[0].successMessage),
      '成功提示是站级那张表单的 successMessage');
    // #1510 —— 提交还带那张表单此刻的名字和露法（Conversations / Customers 据此显示表单名，Customers 据 teaser 标「回电请求」）。
    check(qb.meta && qb.meta.formName === forms[0].name && qb.meta.formMode === 'teaser',
      `teaser 提交 meta 带 formName = 第一张的 name（${JSON.stringify(forms[0].name)}）、formMode = teaser：${JSON.stringify(qb.meta)}`);
    const qf = await run('full', forms);
    const qfb = qf.calls[0] ? JSON.parse(qf.calls[0].init.body) : {};
    check(qfb.meta && qfb.meta.formId === forms[0].id && qfb.meta.formName === forms[0].name && qfb.meta.formMode === 'full',
      `full 提交 meta.formMode = full：${JSON.stringify(qfb.meta)}`);
  } catch (e) {
    bad(`happy-dom 那一段抛了：${e.stack || e.message}`);
  }

  // ══ AC7：eyebrow 五式 ═════════════════════════════════════════════════════════════════════════
  console.log('\n── AC7 eyebrow');
  {
    const styles = M.slots.eyebrow.choices.style;
    const got = styles.map((s) => {
      const h = render('split', { ...withOpts({}), eyebrow: { text: 'Hi', style: s } });
      return [s, (/data-eyebrow="([^"]*)"/.exec(h) || [])[1] || null, count(h, 'data-part="eyebrow"')];
    });
    check(JSON.stringify(styles) === JSON.stringify(['none', 'pill', 'outline', 'dash', 'plain']), '词表是五式（#1481：none 排第一）');
    check(require('./lib/block-knobs').choiceDefault(M.slots.eyebrow, 'style') === 'pill', '#1481：词表 none 排第一之后，没写 style 时仍是 pill（choiceDefaults 钉住，与 Section 的兜底一致）');
    check((/data-eyebrow="([^"]*)"/.exec(render('split', { ...withOpts({}), eyebrow: { text: 'Hi' } })) || [])[1] === 'pill', '没写 style 的 eyebrow 渲染成 pill（Section 那一侧的兜底）');
    check(got.filter(([s]) => s !== 'none').every(([s, d, n]) => d === s && n === 1), `四种有节点、样式对得上（${JSON.stringify(got)}）`);
    check(got.find(([s]) => s === 'none')[2] === 0, 'none ⟹ 没有 eyebrow 节点');
    const vv = own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'hero', data: { headline: 'H', eyebrow: { text: 'x', style: 'neon' } } }] }] }));
    check(vv.some((p) => p.includes('"neon"')), 'eyebrow.style 词表外（"neon"）⟹ validateSite 报错');
  }

  // ══ AC10：AI 建站能选到 hero（提示词的块菜单里有它，「一共几种块」数它）════════════════════════
  console.log('\n── AC10 AI 建站能选到它');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-prompt-'));
    // 反向对照那一臂：拿一份 blocks/ 的拷贝，把 hero 的 `prompt` 段删掉 ⟹ 菜单里就不该再有它。
    const tree = (name, dropPrompt) => {
      const root = path.join(tmp, name);
      fs.mkdirSync(root);
      fs.cpSync(path.join(NEXT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
      for (const l of ['node_modules', 'src', 'public']) fs.symlinkSync(path.join(NEXT, l), path.join(root, l));
      if (dropPrompt) {
        fs.cpSync(path.join(NEXT, 'blocks'), path.join(root, 'blocks'), { recursive: true });
        const mf = path.join(root, 'blocks', 'hero', 'manifest.json');
        const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); delete j.prompt; fs.writeFileSync(mf, JSON.stringify(j, null, 2));
      } else fs.symlinkSync(path.join(NEXT, 'blocks'), path.join(root, 'blocks'));
      return root;
    };
    const prompt = (root) => {
      const r = spawnSync('node', [path.join(root, 'scripts', 'create-site.js')], {
        input: JSON.stringify({ siteId: 't1463', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', language: 'en', themeRotationIndex: 0 }),
        env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-invalid-for-test' }, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 180000,
      });
      for (const line of (r.stdout || '').split('\n')) {
        try { const e = JSON.parse(line); if (e.event === 'prompt' && e.name === 'Base Site') return e.content; } catch { /* 非事件行 */ }
      }
      return null;
    };
    try {
      const real = prompt(tree('real', false));
      const dropped = prompt(tree('dropped', true));
      if (!real || !dropped) die('没拿到建站提示词（create-site 没吐 prompt 事件）');
      const n = (p) => Number((/There are (\d+) section types\b/.exec(p) || [])[1]);
      const pageBlocks = [...manifestLib.loadManifests().values()].filter((m) => m.region !== true).length;
      const menuLine = real.split('\n').find((l) => l.startsWith('- "hero"'));
      check(!!menuLine, `建站提示词的块菜单里有它：${menuLine || '（没有）'}`);
      check(/\n\s+data: \{ options\?: \{textAlign: "left" \| "center" \| "right", image: "none" \| "left" \| "right" \| "top" \| "bottom" \| "background", form: "none" \| "teaser" \| "full"\}/.test(real),
        '它下面那行 data 从 manifest 生成，旋钮带取值（r3：只写键名时 AI 自己编了 background: "dark"）');
      check(/options\.form is "teaser"/.test(real), '再下一行说清「表单只在 options.form = teaser / full 时出现、bg 在顶层」');
      check(n(real) === pageBlocks, `「There are N section types」说 ${n(real)}，等于页面块份数 ${pageBlocks}（hero 算在里面）`);
      check(!dropped.split('\n').some((l) => l.startsWith('- "hero"')), '反向对照：拿掉 manifest 的 prompt 段 ⟹ 菜单里就没有它（判据分得开）');
      const v = own(manifestLib.validateSite({ pages: [{ slug: 'home', blocks: [{ type: 'hero', data: { headline: 'H' } }] }] }));
      check(v.length === 0, `validateSite（建站档）放行一块 hero —— 没有任何 staging / 开关的闸${v.length ? `：${v.join(' | ')}` : ''}`);
      const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
      check('hero' in recipe.NOT_IN_POOL, '首页配方的抽取池不收它（跟 hero 同一个首屏位置，§NOT_IN_POOL）');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
    check(roles['hero'] === M.roleDefault, `block-roles.json 有它（${roles['hero']}），跟 manifest 的 roleDefault 一致 —— 「更新网站」不会把它当未知类型拦下`);
    const layout = fs.readFileSync(path.join(SRC, 'app', 'layout.tsx'), 'utf-8');
    check(/<link rel="stylesheet" href="\/site\.css" \/>/.test(layout), 'layout.tsx 给每一页挂 /site.css（out/ 里的读数见交接：构建后逐页 grep）');
  }

  // ══ AC8 / AC10：Puck 那一侧的 schema（真编辑器上的点击见 tests/e2e/specs/1463-hero-new-editor.spec.ts）═══
  console.log('\n── AC8 / AC10 编辑器 schema');
  {
    const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
    const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
    const schema = editorSchema({});
    const on = schema.components.find((c) => c.type === 'hero');
    check(!!on, `Puck 组件里有 hero（${schema.components.length} 个组件）`);
    const order = on.fields.map((f) => f.slot);
    const want = ['options', 'bg', 'proof', 'stats', 'logos', 'band', 'eyebrow'];
    check(JSON.stringify(order.slice(0, want.length)) === JSON.stringify(want), `字段顺序：${order.join(' → ')}`);
    const opt = on.fields[0];
    check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === 'Split,Centered,Cover,Lead form,Text only'
      && opt.knobs.map((k) => k.name).join() === 'textAlign,image,form' && opt.booleans.join() === '',
    '第一个字段：预设 5 个 → 旋钮 textAlign / image / form（#1470 起没有布尔修饰）');
    const bg = on.fields[1];
    check(bg.control === 'color' && bg.swatches.join() === '#ffffff,#f1f5f9,#e0f2fe,brand,#1e293b,#0f172a', 'bg 字段是色板（6 色）+ 取色器（control: color）');
    check(on.fields.find((f) => f.slot === 'eyebrow').subs.some((x) => x.sub === 'style' && x.choices.length === 5), 'eyebrow.style 是五选一的下拉');
    // 往返：编辑器打开一块 hero、什么都不改 ⟹ 存回去的 data 逐字相同；改了旋钮 / 底色 ⟹ 只动那几个键。
    const { fieldProps, dataFromProps } = require(path.join(NEXT, 'scripts', 'lib', 'editor-convert.js'));
    const base = clone(DEMO);
    const same = dataFromProps(on, base, fieldProps(on, base));
    check(JSON.stringify(same) === JSON.stringify(base), '往返无损：什么都不改 ⟹ data 逐字相同（旋钮 / 底色 / 图片带 / 表单词表都原样）');
    const props = fieldProps(on, base);
    const edited = dataFromProps(on, base, { ...props, options: { ...props.options, textAlign: 'center', image: 'background' }, bg: '#0f172a' });
    check(edited.options.textAlign === 'center' && edited.options.image === 'background' && !('reverse' in edited.options)
      && edited.bg === '#0f172a' && JSON.stringify(edited.form) === JSON.stringify(base.form),
    `改两个旋钮 + 底色 ⟹ 只动了那几个键（${JSON.stringify(edited.options)} · bg ${edited.bg}）`);
    const cleared = dataFromProps(on, base, { ...props, bg: undefined });
    check(!('bg' in cleared), '色板点 None ⟹ bg 这个键删掉（块回到没有底色的样子）');
    const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
    check(presetNameFor(man, { textAlign: 'left', image: 'background', form: 'none' }) === 'Cover'
      && presetNameFor(man, { textAlign: 'center', image: 'background', form: 'none' }) === 'custom', '点 Cover = 三个旋钮那一组；拧偏一个 ⟹ custom');
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})();
