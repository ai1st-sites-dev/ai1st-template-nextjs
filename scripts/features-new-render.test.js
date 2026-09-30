#!/usr/bin/env node
/**
 * features-new-render.test.js — #1475 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/features-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（8 个预设逐字 —— #1490 加了 Steps、旋钮名 / 值逐字、目录集合、两两不同）· AC6 的 DOM 一半（background 不画 icon）·
 * AC7（槽位空不渲染、连线）· AC8（bg 四档 + 不自己算亮度 / 拼渐变）· AC9（validateSite）· AC10 的组件一半
 * （图标表 → <svg>，查不到的名字那一项不画）· AC11（block-roles · 首页配方池）· AC13 的编辑器 schema ·
 * AC14（旧三块、hero-new manifest 零改动）。
 * 几何（20 种组合三端无横向滚动、标题不折行、64ch、块头位置、list 宽度 / 对齐、图在上、连线横竖、真站产物里的 <svg>）
 * 要浏览器：`tests/e2e/specs/1475-features-new-knobs.spec.ts`。
 *
 * 🔴 每一段都带反向对照（同一进程、单变量），证明判据真会红。
 * 夹具定死：演示内容包里的 Northside Auto Care（`scripts/lib/demo-content`，正文做什么 9）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCK = path.join(NEXT, 'blocks', 'features-new');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 cta-new-render.test.js）──────────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.features-new-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
const tmpDirs = [];
process.on('exit', () => {
  for (const d of [STUB_DIR, ...tmpDirs]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } }
});
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
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  return require(SECTION).default;
}

let C; let DEMO; let STEPS; let manifestLib; let M; let icons;
try {
  C = loadSection();
  const demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  DEMO = demo.DEMO_CONTENT['features-new'];
  STEPS = demo.FEATURES_NEW_STEPS;
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('features-new');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO || !STEPS) die('demo-content 里没有 features-new 那两份（DEMO_CONTENT / FEATURES_NEW_STEPS）');
if (!M) die('blocks/ 里没有 features-new');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('features-new', DEMO, { warn: () => {} });
const render = (shape, data, Comp = C, iconTable = TABLE) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable, block: { id: 'f', type: 'features-new', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("features-new")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'introImage', 'itemsLayout', 'itemsColumns', 'itemsImage', 'itemStyle', 'itemAlign', 'itemIcon', 'itemImage', 'itemConnector'];

// ══ AC1：8 个预设逐字（#1475 七个 + #1490 Steps）、旋钮名 / 值逐字、目录集合、两两不同 ═══════════════════
console.log('── AC1 八个预设');
{
  // 列：名字 · 形态目录 · introPosition · introAlign · introImage · itemsLayout · itemsColumns · itemsImage · itemStyle · itemIcon · itemImage
  // （#1475 正文预设表逐字；未列的 itemAlign / itemConnector 取默认 left / none —— 只有 #1490 的 Steps 是 itemConnector line）
  const WANT = [
    ['Grid', 'grid', 'top', 'left', 'none', 'grid', '3', 'none', 'plain', 'top', 'none'],
    ['Cards', 'cards', 'top', 'center', 'none', 'grid', '3', 'none', 'card', 'top', 'none'],
    ['Side intro', 'side-intro', 'left', 'left', 'none', 'grid', '2', 'none', 'card', 'top', 'none'],
    ['Intro photo', 'intro-photo', 'top', 'left', 'right', 'grid', '3', 'none', 'card', 'top', 'none'],
    ['Photo list', 'photo-list', 'top', 'center', 'none', 'list', '3', 'left', 'plain', 'left', 'none'],
    ['Photo cards', 'photo-cards', 'top', 'center', 'none', 'grid', '3', 'none', 'card', 'none', 'top'],
    ['Cover cards', 'cover-cards', 'top', 'center', 'none', 'grid', '3', 'none', 'card', 'none', 'background'],
    ['Steps', 'steps', 'top', 'left', 'none', 'grid', '3', 'none', 'plain', 'none', 'none'],
  ];
  const cols = ['introPosition', 'introAlign', 'introImage', 'itemsLayout', 'itemsColumns', 'itemsImage', 'itemStyle', 'itemIcon', 'itemImage'];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...cols.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), `presets ${WANT.length} 条与正文表逐字相同（名字 · 形态 · 九列旋钮）`, JSON.stringify(got));
  check((M.presets || []).every((p) => p.knobs.itemAlign === 'left' && p.knobs.itemConnector === (p.name === 'Steps' ? 'line' : 'none')),
    '表里没列的 itemAlign 全是 left；itemConnector 只有 Steps 是 line、其余七条是默认 none（#1490）');
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这十一个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['introImage', ['none', 'left', 'right', 'top', 'bottom']], ['itemsLayout', ['grid', 'list']], ['itemsColumns', ['2', '3', '4']],
    ['itemsImage', ['none', 'left', 'right']], ['itemStyle', ['plain', 'card']], ['itemAlign', ['left', 'center', 'right']],
    ['itemIcon', ['top', 'left', 'right', 'none']], ['itemImage', ['none', 'left', 'right', 'top', 'bottom', 'background']],
    ['itemConnector', ['none', 'line']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（values[0] = 默认）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == ${WANT.length} 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'essential', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === WANT.length, `同一份夹具下 ${WANT.length} 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  // 反向对照：夹具里写死十一个旋钮 ⟹ 形态不再起作用，8 份（去掉 data-shape）应当塌成 1 份。
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死十一个旋钮 ⟹ 8 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  // 旋钮全挂在根上（block.css 按它们排）。
  const g = render('grid', clone(DEMO));
  const want = { 'data-intro-position': 'top', 'data-intro-align': 'left', 'data-intro-image': 'none', 'data-items-layout': 'grid', 'data-items-columns': '3',
    'data-items-image': 'none', 'data-item-style': 'plain', 'data-item-align': 'left', 'data-item-icon': 'top', 'data-item-image': 'none', 'data-item-connector': 'none' };
  const miss = Object.entries(want).filter(([a, v]) => attr(g, a) !== v).map(([a]) => a);
  check(miss.length === 0, 'Grid：十一个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余十个不变（组件里没有联动纠正）。
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('side-intro', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name).map((n) => attr(h, `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`));
      const base = KNOB_NAMES.filter((n) => n !== k.name).map((n) => M.presets[2].knobs[n]);
      if (JSON.stringify(others) !== JSON.stringify(base) || attr(h, `data-${k.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) !== v) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Side intro 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余十个不变`, moved.join(' · '));
}

// ══ AC6（DOM 一半）：itemImage=background ════════════════════════════════════════════════════════
console.log('\n── AC6 itemImage=background');
{
  const h = render('cover-cards', clone(DEMO));
  check(count(h, 'data-part="icon"') === 0 && count(h, 'data-part="item-image"') === DEMO.items.length, `background ⟹ 每项一张图（${count(h, 'data-part="item-image"')}）、icon 0 个（${count(h, 'data-part="icon"')}）`);
  check(/\[data-item-image="background"\] \.fx-content \{[^}]*justify-content: flex-end;/.test(CSS), 'block.css：background 时 .fx-content 文字靠下（justify-content: flex-end）');
  check(/\[data-item-image="background"\] \.fx-img::after \{[^}]*linear-gradient\(to top, rgba\(2, 6, 23, 0\.85\)/.test(CSS), 'block.css：background 底部深色渐变');
  const top = render('photo-cards', withOpts({ itemIcon: 'top' }));
  check(count(top, 'data-part="icon"') === DEMO.items.length, `对照：itemImage=top + itemIcon=top ⟹ icon 照画（${count(top, 'data-part="icon"')}）`);
}

// ══ AC7：槽位空 → 不渲染；连线 ═════════════════════════════════════════════════════════════════════
console.log('\n── AC7 槽位空不渲染');
{
  // 全开：块头图 + items 旁图 + 每项图，保证每个部件在「有值」那一侧真的画了。
  const on = { introImage: 'top', itemsImage: 'left', itemImage: 'top', itemIcon: 'top' };
  const full = render('grid', withOpts(on, {}, STEPS));
  const cases = [
    ['introEyebrow', 'data-part="eyebrow"', (d) => { delete d.introEyebrow; }],
    ['introCtas', 'data-part="ctas"', (d) => { delete d.introCtas; }],
    ['introImage', 'data-part="intro-image"', (d) => { delete d.introImage; }],
    ['itemsImage', 'data-part="items-image"', (d) => { delete d.itemsImage; }],
    ['items[].number', 'data-part="number"', (d) => { d.items.forEach((it) => delete it.number); }],
    ['items[].icon', 'data-part="icon"', (d) => { d.items.forEach((it) => delete it.icon); }],
    ['items[].image', 'data-part="item-image"', (d) => { d.items.forEach((it) => delete it.image); }],
    ['items[].link', 'data-part="link"', (d) => { d.items.forEach((it) => delete it.link); }],
  ];
  for (const [slot, needle, drop] of cases) {
    const d = withOpts(on, {}, STEPS);
    drop(d);
    const empty = render('grid', d);
    check(count(full, needle) >= 1 && count(empty, needle) === 0, `${slot}：有值渲染（${count(full, needle)}）、清空不渲染（${count(empty, needle)}）`);
  }
  // 单项清空只影响那一项。
  const one = withOpts(on, {}, STEPS);
  delete one.items[2].icon;
  const perItem = itemsOf(render('grid', one)).map((x) => (x.includes('data-part="icon"') ? 1 : 0));
  check(perItem.join('') === '110111', `只清第 3 项的 icon ⟹ 只那一项没有（${perItem.join('')}）`);
  check(count(full, 'data-cta=') === 2 + STEPS.items.length, `introCtas 给 ${STEPS.introCtas.length} 条只画 2 条（max 2）+ 每项一个 link`);
  const noUrl = render('grid', withOpts(on, { introImage: { alt: 'x' } }, STEPS));
  check(!noUrl.includes('data-part="intro-image"'), 'introImage 只有 alt、没有 imageUrl ⟹ 不渲染');
  const offKnob = render('grid', withOpts({ ...on, introImage: 'none', itemsImage: 'none', itemImage: 'none' }, {}, STEPS));
  check(!/data-part="(intro-image|items-image|item-image)"/.test(offKnob) && !/<img\b/.test(offKnob), '三个图槽都有值、同名旋钮 none ⟹ DOM 里一张 <img> 都没有');
  const noneStyle = render('grid', withOpts(on, { introEyebrow: { text: 'x', style: 'none' } }, STEPS));
  check(!noneStyle.includes('data-part="eyebrow"'), 'introEyebrow.style=none ⟹ 不渲染');
  const styles = M.slots.introEyebrow.choices.style.filter((s) => s !== 'none')
    .map((s) => (/data-eyebrow="([^"]*)"/.exec(render('grid', { ...clone(DEMO), introEyebrow: { text: 'x', style: s } })) || [])[1]);
  check(styles.join() === 'pill,outline,dash,plain', `introEyebrow 四式都画得出来（${styles.join(' / ')}）`);
  check(JSON.stringify(M.slots.introEyebrow.choices.style) === '["none","pill","outline","dash","plain"]', 'introEyebrow.style 词表 none 在最前（#1481 规矩 1）');
}

console.log('\n── AC7 连线');
{
  const n = STEPS.items.length;
  for (const layout of ['grid', 'list']) {
    const h = render('grid', withOpts({ itemsLayout: layout, itemConnector: 'line' }, {}, STEPS));
    const per = itemsOf(h).map((x) => count(x, 'data-part="connector"'));
    check(count(h, 'data-part="connector"') === n - 1 && per[n - 1] === 0, `${layout} + number + line ⟹ 相邻项之间 ${n - 1} 段连线（每项 ${per.join('')}，最后一项没有）`);
  }
  const noNum = withOpts({ itemConnector: 'line' }, {}, STEPS);
  noNum.items.forEach((it) => delete it.number);
  check(count(render('grid', noNum), 'data-part="connector"') === 0, 'number 全空 + line ⟹ 一段连线都不画');
  check(count(render('grid', withOpts({ itemConnector: 'none' }, {}, STEPS)), 'data-part="connector"') === 0, 'number 有值 + none ⟹ 不画');
  check(/\[data-items-layout="grid"\] \.fx-connector \{[^}]*height: 2px;/.test(CSS) && /\[data-items-layout="list"\] \.fx-connector \{[^}]*width: 2px;/.test(CSS),
    'block.css：grid 连线横（高 2px）、list 竖（宽 2px）—— 真方向在 e2e 里量');
  // 反向对照：去掉「有编号才画」那个条件 ⟹ 没编号也画连线（上面第三格会红）。
  const cond = "k.itemConnector === 'line' && items.some((it) => str(it.number))";
  if (!SRC_TEXT.includes(cond)) die('AC7 反向对照找不到那个条件');
  const Broken = loadSection(SRC_TEXT.replace(cond, "k.itemConnector === 'line'"));
  check(count(render('grid', noNum, Broken), 'data-part="connector"') === n - 1, '反向对照：不看编号的组件 ⟹ 没编号也读到连线 —— 判据分得开');
  C = loadSection();
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  const at = (bg) => render('cards', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light（深字）');
  check(attr(at('brand'), 'data-tone') === 'brand' && /style="background:var\(--x-primary\)"/.test(sectionTag(at('brand'))), 'brand ⟹ data-tone="brand"、底色 var(--x-primary)');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark',
    `渐变 {stops:[#7d52f4,#f7b733],angle:135} ⟹ linear-gradient(135deg,…) + data-tone="dark"（${sectionTag(g).match(/style="[^"]*"/)}）`);
  check(attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), '没写 bg ⟹ light、<section> 没有 style');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处（都调 contrast.js 的共用函数）`);
  // #1477 —— 深底 / brand 上的正文白 .92 全站只有一条（scripts/lib/site-css.js §ON_DEEP_MUTED，它认根上的 data-tone），
  //    块自己的 block.css 里不再抄一份（同 cta-new-render.test.js）。
  const { ON_DEEP_MUTED } = require(path.join(NEXT, 'scripts', 'lib', 'site-css.js'));
  check(/\[data-tone="dark"\] \.text-muted,\s*\n\[data-tone="brand"\] \.text-muted,[\s\S]*?\{\s*color: rgba\(255, 255, 255, \.92\) !important;/.test(ON_DEEP_MUTED)
    && !/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS), 'dark / brand 时正文白 .92（不是灰）：全站那条，block.css 里没有自己那份');
  check(/\[data-tone="dark"\]\[data-item-style="card"\] \.fx-inner,[\s\S]*?\{\s*background: rgba\(255, 255, 255, 0\.06\);\s*border-color: rgba\(255, 255, 255, 0\.15\);/.test(CSS),
    'block.css：dark / brand 时 card 描边换半透明白');
  const v = (bg) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'features-new', data: { headline: 'H', items: [{ title: 't', text: 'x' }], bg } }] }], scope: 'edit' }));
  check(v('#0f172a').length === 0 && v('brand').length === 0 && v({ stops: ['#7d52f4', '#f7b733'], angle: 135 }).length === 0, 'validateSite：#0f172a / brand / 两色标渐变放行');
  check(['red', '#fff', { stops: ['#ffffff'] }].every((b) => v(b).some((p) => p.includes('"bg"'))), 'validateSite：red / #fff / 一个色标的渐变被拒');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer-new').slots.bg), 'bg 槽对象与 footer-new 的 slots.bg 逐字相同');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const item = (i) => ({ title: `Service ${i}`, text: 'Done right.' });
  const v = (data, shape) => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'features-new', ...(shape ? { shape } : {}), data: { headline: 'H', ...data } }] }], scope: 'edit',
  }));
  for (const n of [0, 9]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('"items"') || p.includes('items')) && r.some((p) => p.includes(n ? '最多只能有 8 项' : '至少要 1 项')),
      `items ${n} 项 ⟹ 被拦、报错点名 items`, JSON.stringify(r));
  }
  for (const n of [1, 8]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length === 0, `items ${n} 项 ⟹ 放行`, JSON.stringify(r));
  }
  const img = { imageUrl: 'https://x.example/a.jpg', alt: 'a' };
  const r1 = v({ items: [item(1)], introImage: img }, 'grid');
  check(r1.length === 1 && r1[0].includes('options.introImage 没写'), '写了 introImage 槽却没写 options.introImage（Grid 形态）⟹ 报一条（同名检查对本块生效）', JSON.stringify(r1));
  check(v({ items: [item(1)], introImage: img, options: { introImage: 'right' } }, 'grid').length === 0, '对照：写了 options.introImage ⟹ 放行');
  check(v({ items: [item(1)], introImage: img }, 'intro-photo').length === 0, '对照：Intro photo 预设自带 introImage=right ⟹ 放行');
  const r2 = v({ items: [item(1)], options: { itemsColumns: 3 } });
  check(r2.length === 1 && r2[0].includes('options.itemsColumns'), 'options.itemsColumns 写成数字 3 ⟹ 报一条（取值是字符串 "2" / "3" / "4"）', JSON.stringify(r2));
  const r3 = v({ items: [item(1)], options: { columns: '3' } });
  check(r3.length === 1 && r3[0].includes('"columns"'), '不认的旋钮键 options.columns ⟹ 报一条', JSON.stringify(r3));
  for (const p of M.presets) {
    const r = v({ ...clone(DEMO), options: p.knobs }, p.shape);
    check(r.length === 0, `预设 ${p.name} 那组值 + 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
  // 演示内容是「全填版」（三张图都有），给单格页拧旋钮用；配上把两张整组图打开的旋钮就该 0 条。
  const steps = v({ ...clone(STEPS), options: { ...STEPS.options, introImage: 'top', itemsImage: 'left' } });
  check(steps.length === 0, '带编号那一版（FEATURES_NEW_STEPS，options 打开 introImage / itemsImage）⟹ 放行', JSON.stringify(steps));

  // 旧的旋钮级上限没改坏 —— 正文点名 hero-new 的 `form: inline` + 2 个 field。
  // 📌 今天 hero-new 已经没有 inline 这一档、`form` 槽也没有 fields（#1470 收成 `{id?}`），全仓 manifest 一处旋钮级
  //    `maxItems` 都没有 ⟹ 照原样写那组输入，拦它的是「旋钮取值」「形状外的键」两条，不是旋钮级上限。两件事分开量：
  const hv = (data) => manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'hero-new', data: { headline: 'H', ...data } }] }], scope: 'edit' })
    .problems.filter((p) => p.includes('("hero-new")'));
  const h1 = hv({ options: { form: 'inline' }, form: { fields: ['name', 'phone'] } });
  check(h1.length >= 1, `① 正文那组输入（hero-new form: inline + 2 个 field）仍被拦（${h1.length} 条：${h1.map((p) => p.split(': ').slice(1).join(': ').slice(0, 40)).join(' | ')}）`);
  // ② 旋钮级上限那段代码本身：块库复制一份，给 hero-new 的 form 旋钮挂回一条 maxItems，量它仍然拦、而且只在那一档拦。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-1475-'));
  tmpDirs.push(dir);
  fs.cpSync(path.join(NEXT, 'blocks'), dir, { recursive: true });
  const mp = path.join(dir, 'hero-new', 'manifest.json');
  const hm = JSON.parse(fs.readFileSync(mp, 'utf-8'));
  hm.slots.form.shape = '{id?, fields?}';
  hm.slots.options.knobs.find((k) => k.name === 'form').maxItems = { teaser: { 'form.fields': 1 } };
  fs.writeFileSync(mp, JSON.stringify(hm));
  const kv = (formKnob, n) => manifestLib.validateSite({
    dir, scope: 'edit', pages: [{ slug: 'p', blocks: [{ type: 'hero-new', data: { headline: 'H', options: { form: formKnob }, form: { fields: Array.from({ length: n }, (_, i) => `f${i}`) } } }] }],
  }).problems.filter((p) => p.includes('只能有'));
  check(kv('teaser', 2).length === 1 && kv('teaser', 2)[0].includes('form 是 "teaser" 时 form.fields 只能有 1 项'), `② 旋钮级上限：form=teaser + 2 个 field ⟹ 报「只能有 1 项」（${kv('teaser', 2)}）`);
  check(kv('teaser', 1).length === 0 && kv('full', 2).length === 0, '② 对照：teaser + 1 个、full + 2 个 ⟹ 不报（上限只挂在那一档）');
  // manifest 声明本身：写成字符串 / 挂在非列表槽上 ⟹ loadManifests 当场拒。
  const badDecl = (mutate) => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-1475-'));
    tmpDirs.push(d2);
    fs.cpSync(path.join(NEXT, 'blocks'), d2, { recursive: true });
    const p2 = path.join(d2, 'features-new', 'manifest.json');
    const m2 = JSON.parse(fs.readFileSync(p2, 'utf-8'));
    mutate(m2);
    fs.writeFileSync(p2, JSON.stringify(m2));
    try { manifestLib.loadManifests(d2); return null; } catch (e) { return e.message; }
  };
  const e1 = badDecl((m2) => { m2.slots.items.maxItems = '8'; });
  const e2 = badDecl((m2) => { m2.slots.headline.minItems = 1; });
  const e3 = badDecl((m2) => { m2.slots.items.minItems = 9; });
  check(e1 && e1.includes('maxItems') && e2 && e2.includes('只给 kind: list') && e3 && e3.includes('大于'),
    `manifest 声明写歪当场拒：maxItems 写成 "8" / 挂在 text 槽 / 下限大于上限（${[e1, e2, e3].map((e) => (e || 'null').split(': ').pop().slice(0, 24)).join(' | ')}）`);
  check(badDecl(() => {}) === null, '对照：原样那一份 loadManifests 不抛');
}

// ══ AC10（组件一半）：图标表 → <svg> ══════════════════════════════════════════════════════════════
console.log('\n── AC10 图标');
{
  const h = render('grid', clone(DEMO));
  const per = itemsOf(h).map((x) => count(x, '<svg'));
  // 每项：图标 1 个 + link 的箭头 1 个。
  check(per.length === DEMO.items.length && per.every((x) => x === 2), `每项都画出图标 + 箭头（<svg> 每项 ${per.join(' / ')}）`);
  const names = itemsOf(h).map((x) => (/data-part="icon"[^]*?data-icon="([^"]+)"/.exec(x) || [])[1]);
  check(JSON.stringify(names) === JSON.stringify(DEMO.items.map((it) => it.icon)), `图标名逐项对得上（${names.join(' · ')}）`);
  const d = clone(DEMO);
  d.items[1].icon = 'no-such-icon-xyz';
  const warns = [];
  const table = icons.iconTableFor('features-new', d, { warn: (m) => warns.push(m) });
  const h2 = render('grid', d, C, table);
  const per2 = itemsOf(h2).map((x) => (x.includes('data-part="icon"') ? 1 : 0));
  check(per2.join('') === '101111' && warns.some((w) => w.includes('no-such-icon-xyz')),
    `第 2 项写一个不存在的名字 ⟹ 只那一项没有图标（连底色方块也没有）、其它不受影响（${per2.join('')}）、服务端打一行日志`);
  check(count(render('grid', clone(DEMO), C, {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  check(icons.usesIconTable('features-new') && !icons.usesIconTable('features-grid') && !icons.usesIconTable('services-list'),
    'usesIconTable：features-new 用、老块（ServiceIcon 那一套）不用');
  const tables = icons.iconTablesFor([{ type: 'features-grid', data: { icon: 'wrench' } }, { type: 'features-new', data: DEMO }], { warn: () => {} });
  check(tables[0] === undefined && tables[1] && Object.keys(tables[1]).length === new Set([...DEMO.items.map((it) => it.icon), 'arrow-right', 'telephone']).size,
    `iconTablesFor：老块那一格 undefined、features-new 那一格 ${tables[1] ? Object.keys(tables[1]).length : 0} 个名字`);
  // 真站与单格页两条路都传了（SectionRenderer 的调用点）。
  const callers = ['src/components/pages/HomePage.tsx', 'src/components/pages/SubPage.tsx', 'src/app/%5F_catalog/[block]/[shape]/page.dev.tsx']
    .map((f) => [f, /<SectionRenderer [^>]*iconTables=\{iconTablesFor\(/.test(fs.readFileSync(path.join(NEXT, f), 'utf-8'))]);
  check(callers.every(([, hit]) => hit), `三个服务端调用点都传 iconTables（${callers.map(([f, hit]) => `${path.basename(f)}:${hit ? '有' : '没有'}`).join(' · ')}）`);
}

// ══ AC11：block-roles · 首页配方 ══════════════════════════════════════════════════════════════════
console.log('\n── AC11 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['features-new'] === M.roleDefault, `block-roles.json 的 features-new（${roles['features-new']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  // 🔴 #1483（Chris 2026-09-30 解开新块票的串行）—— 不写死种数：每落一个新块池子就变，写死 `=== N` 会让并行的姊妹票
  //    为同一个数互相打红。判据是「含它」+ 下面那格「比块库里没有它时多 1」。
  check(pool.includes('features-new'), `poolFor 含 features-new，池子 ${pool.length} 种`);
  // #1485 —— 新块进池、旧块同时出池：features-grid 由 features-new 接替，同一页只放一个。
  check(!pool.includes('features-grid') && 'features-grid' in recipe.NOT_IN_POOL, 'features-grid 出池（在 NOT_IN_POOL 里）');
  check(!('features-new' in recipe.NOT_IN_POOL), 'NOT_IN_POOL 里没有 features-new（它是首页正文块）');
  const without = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'features-new')));
  check(!without.includes('features-new') && without.length === pool.length - 1, `对照：块库里没有它 ⟹ 池子 ${without.length} 种（比 ${pool.length} 少一）`);
  check(M.prompt && M.prompt.group === 'homepage' && M.prompt.order === 5, `prompt.group == homepage、order ${M.prompt && M.prompt.order}（紧挨 features-grid 的 4）`);
}

// ══ AC13（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC13 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'features-new');
  check(!!on, 'Puck 组件里有 features-new（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'introCtas', 'items', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → 按钮 → items → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), `第一个字段：预设 ${M.presets.length} 个 → 十一个旋钮（控件顺序 intro → items → item）`);
  const items = on.fields.find((f) => f.slot === 'items');
  check(items.control === 'list' && items.subs.map((x) => x.sub).join() === 'title,text', `items 是列表字段、每项可改 title / text（${items.control} · ${items.subs.map((x) => x.sub).join(' / ')}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[1].knobs) === 'Cards' && presetNameFor(man, { ...M.presets[1].knobs, itemsColumns: '4' }) === 'custom',
    '点 Cards = 那一组旋钮；拧偏一个（itemsColumns=4）⟹ custom');
}

// ══ 建站配图写回之后真有 <img>（#1475 r2，QA2 r1 第 1 条）═══════════════════════════════════════════
// 数据形状照 QA2 那次真 AI 建站吐出来的（项里没有 image）；写回走建站那条路同一份 collectImageSlots +
// setSlotImageUrl（fillImageSlots 就是这两步加 produce，那一侧由 image-slots.test.js ⑦ 真跑）。
console.log('\n── 建站配图写回 → 渲染');
{
  const ims = require(path.join(NEXT, 'scripts', 'lib', 'image-slots.js'));
  const ai = () => ({ ...clone(DEMO), items: clone(DEMO.items).map(({ image, ...rest }) => rest) });
  const fill = (data) => {
    const pages = [{ slug: 'home', sections: [{ type: 'features-new', shape: 'photo-cards', data }] }];
    const slots = ims.collectImageSlots(pages, new Map([['features-new', M]]));
    slots.forEach((sl) => ims.setSlotImageUrl(pages, sl, `/photos/${ims.slotKey(sl)}.jpg`));
    return { data: pages[0].sections[0].data, slots };
  };
  const { data, slots } = fill(ai());
  const n = data.items.length;
  for (const shape of ['photo-cards', 'cover-cards']) {
    const html = render(shape, data);
    const imgs = itemsOf(html).filter((h) => /<img[^>]*src="\/photos\/home-s0-features-new-items-i\d+\.jpg"/.test(h)).length;
    check(slots.length === n && imgs === n, `${shape}：${n} 项写回后每项都有自己那张 <img>（读到 ${imgs}/${n}）`);
  }
  // 反向对照：照 r1 那样写成平铺 items[i].imageUrl ⟹ 同一份渲染 0 张 —— 判据分得开。
  const flat = ai();
  flat.items.forEach((it, i) => { it.imageUrl = `/photos/flat-${i}.jpg`; });
  check(count(render('photo-cards', flat), '/photos/flat-') === 0, '反向对照：平铺的 items[i].imageUrl 渲染出 0 张 —— r1 的那个缺陷这里看得见');
}

// ══ AC14：旧三块、hero-new manifest 零改动 ═════════════════════════════════════════════════════════
console.log('\n── AC14 旧块零改动');
{
  let diff = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    // #1477 —— 这是 #1475 交付自己的「别碰」判据。features-new 已经在 merge-base 上 = #1475 落地了，之后的票
    //    合法地改这几份（#1477 改 hero-new 的 bg 槽、#1485 让 features-grid 出池）不该在它们自己的分支上红。
    let landed = true;
    try { execFileSync('git', ['cat-file', '-e', `${base}:templates/nextjs/blocks/features-new/manifest.json`], { cwd: NEXT, stdio: 'ignore' }); } catch { landed = false; }
    if (landed) console.log(`  ⏭  features-new 已在 merge-base ${base.slice(0, 8)} 上（#1475 已落地），这一格只管 #1475 自己的交付 —— 不算通过`);
    else diff = execFileSync('git', ['diff', '--name-only', base, '--', 'blocks/features-grid', 'blocks/card-group', 'blocks/services-list', 'blocks/hero-new/manifest.json'], { cwd: NEXT, encoding: 'utf8' }).trim();
  } catch (e) { console.log(`  ⚠️  取不到 git 读数（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  if (diff !== null) check(diff === '', `features-grid / card-group / services-list / hero-new manifest 相对 merge-base 没有改动${diff ? `：${diff}` : ''}`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
