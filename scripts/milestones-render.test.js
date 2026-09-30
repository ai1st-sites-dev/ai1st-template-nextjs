#!/usr/bin/env node
/**
 * milestones-render.test.js — #1482 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/milestones-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立）· AC4 / AC6 的 DOM 与规则一半
 * （blockImage 四档的节点、background 给 dark、card / divided 的规则）· AC7（槽位空不渲染、没有第三行）·
 * AC8（bg 四档 + 不自己算亮度 / 拼渐变）· AC9（validateSite）· AC10 的组件一半（图标表 → <svg>，查不到的名字那一条不画）·
 * AC11（block-roles · 首页配方池）· AC13 的编辑器 schema · AC14（social-proof / hero-new 零改动）。
 * 几何（16 种组合三端无横向滚动、列数、图 / 块头上下左右、计算色、真站产物里的 <svg>）要浏览器：
 * `tests/e2e/specs/1482-milestones-knobs.spec.ts`。
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
const BLOCK = path.join(NEXT, 'blocks', 'milestones');
const SECTION = path.join(BLOCK, 'Section.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx；Next 自己的换成替身（同 cta-new-render.test.js）──────────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.milestones-stubs');
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

let C; let DEMO; let manifestLib; let M; let icons;
try {
  C = loadSection();
  const demo = require(path.join(NEXT, 'scripts', 'lib', 'demo-content'));
  DEMO = demo.DEMO_CONTENT.milestones;
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('milestones');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 milestones');
if (!M) die('blocks/ 里没有 milestones');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('milestones', DEMO, { warn: () => {} });
const render = (shape, data, Comp = C, iconTable = TABLE) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable, block: { id: 'm', type: 'milestones', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("milestones")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const statsOf = (html) => html.split('data-part="stat"').slice(1);
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const KNOB_NAMES = ['blockImage', 'introPosition', 'introAlign', 'introImage', 'statsColumns', 'statSize', 'statStyle', 'statAlign'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：5 个预设逐字、旋钮名 / 值逐字、目录集合、两两不同、旋钮独立 ═══════════════════════════════
console.log('── AC1 五个预设');
{
  // 列：名字 · 形态目录 · blockImage · introPosition · introAlign · introImage · statsColumns · statSize · statStyle · statAlign（正文预设表逐字）
  const WANT = [
    ['Row', 'divided-row', 'none', 'top', 'center', 'none', 'auto', 'md', 'divided', 'center'],
    ['Side intro', 'side-intro', 'none', 'left', 'left', 'none', '2', 'md', 'plain', 'left'],
    ['Photo', 'photo', 'none', 'top', 'left', 'left', 'auto', 'md', 'plain', 'left'],
    ['Photo side', 'photo-side', 'right', 'top', 'center', 'none', '2', 'md', 'card', 'center'],
    ['Big number', 'big-number', 'none', 'bottom', 'center', 'none', '1', 'xl', 'plain', 'center'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 5 条与正文表逐字相同（名字 · 形态 · 八列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这八个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['blockImage', ['none', 'left', 'right', 'background']], ['introPosition', ['left', 'right', 'top', 'bottom']],
    ['introAlign', ['left', 'center', 'right']], ['introImage', ['none', 'left', 'right']],
    ['statsColumns', ['auto', '1', '2', '3', '4']], ['statSize', ['md', 'xl']],
    ['statStyle', ['plain', 'card', 'divided']], ['statAlign', ['left', 'center']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（values[0] = 默认）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 5 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 5, `同一份夹具下 5 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  // 反向对照：夹具里写死八个旋钮 ⟹ 形态不再起作用，5 份（去掉 data-shape）应当塌成 1 份。
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死八个旋钮 ⟹ 5 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('divided-row', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Row：八个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余七个不变（组件里没有联动纠正）。在 Photo side 上拧（它的 blockImage=right，改 statsColumns=4 不会被改回 3）。
  const base = M.presets[3].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('photo-side', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Photo side 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余七个不变`, moved.join(' · '));
  // 已并掉的旧开关不在 manifest 里（statsLayout / oneStat 并进 statsColumns，caption 删掉）。
  check(!KNOB_NAMES.includes('statsLayout') && !KNOB_NAMES.includes('oneStat') && !/caption/.test(M.slots.stats.shape),
    `没有 statsLayout / oneStat 旋钮、stats 形状里没有 caption（${M.slots.stats.shape}）`);
}

// ══ AC4 / AC6（DOM 与规则一半）════════════════════════════════════════════════════════════════════
console.log('\n── AC4 blockImage 四档');
{
  const n = (h, needle) => count(h, needle);
  const none = render('divided-row', withOpts({ blockImage: 'none' }));
  const left = render('divided-row', withOpts({ blockImage: 'left' }));
  const right = render('divided-row', withOpts({ blockImage: 'right' }));
  const bgi = render('divided-row', withOpts({ blockImage: 'background' }));
  check(n(none, 'data-part="block-image"') === 0 && !none.includes('mi-cover'), 'blockImage=none（槽有值）⟹ 没有块级图');
  check(n(left, 'class="mi-bimg"') === 1 && n(right, 'class="mi-bimg"') === 1 && !left.includes('mi-cover'), 'left / right ⟹ 一张挨着整块的图（.mi-bimg），不铺底');
  check(n(bgi, 'class="mi-cover"') === 1 && !bgi.includes('mi-bimg') && attr(bgi, 'data-tone') === 'dark', 'background ⟹ 一张铺底图（.mi-cover）+ data-tone="dark"（字色反白那一组）');
  check(bgi.indexOf('mi-cover') < bgi.indexOf('mi-container'), 'background 的图在容器前面（段底，block.css 给 z-index 0、容器 z-index 1）');
  const noImg = clone(DEMO); delete noImg.blockImage;
  const bgNoImg = render('divided-row', withOpts({ blockImage: 'background' }, {}, noImg));
  check(!bgNoImg.includes('mi-cover') && attr(bgNoImg, 'data-tone') === 'light', '对照：background 但没有图 ⟹ 不画遮罩、字色回到按 bg 算（light）');
  check(/\.mi-cover::after \{[^}]*background: rgba\(2, 6, 23, 0\.6\);/.test(CSS), 'block.css：铺底图 60% 深色遮罩 rgba(2,6,23,.6)');
  check(/\[data-block-image="right"\] \.mi-outer \{\s*flex-direction: column-reverse;/.test(CSS)
    && /\[data-block-image="right"\] \.mi-bimg \{\s*margin-top: 2\.5rem;/.test(CSS)
    && /\[data-block-image="left"\] \.mi-bimg \{\s*margin-bottom: 2\.5rem;/.test(CSS),
    'block.css：小屏 right 图在下（column-reverse + 上边距 2.5rem）、left 图在上（下边距 2.5rem）—— 真位置在 e2e 里量');
  check(/\[data-block-image="background"\]\[data-tone="dark"\]\[data-stat-style="card"\] \.mi-inner \{\s*background: rgba\(255, 255, 255, 0\.08\);\s*border-color: rgba\(255, 255, 255, 0\.18\);/.test(CSS),
    'block.css：background + card ⟹ 卡片 .08 底 + .18 描边（不是白卡）');
}

console.log('\n── AC6 statStyle 规则');
{
  check(/\[data-stat-style="card"\] \.mi-inner \{\s*background: #fff;\s*border: 1px solid[^;]*;\s*border-radius: 1rem;\s*padding: 2rem;/.test(CSS), 'card：白底 + 1px 描边 + 1rem 圆角 + 2rem 内边距');
  check(/\[data-stat-style="divided"\] \.mi-stat \{\s*border-left: 1px solid/.test(CSS) && /\[data-stat-style="divided"\] \.mi-stat:first-child,/.test(CSS), 'divided：相邻之间 1px 竖线、首条没有');
  check(/\[data-tone="dark"\]\[data-stat-style="card"\] \.mi-inner,[\s\S]*?\{\s*background: rgba\(255, 255, 255, 0\.06\);/.test(CSS), '深 bg + card ⟹ .06 半透明底');
  check(!/\[data-stat-style="plain"\]/.test(CSS) && !/\.mi-stat \{[^}]*background/.test(CSS) && !/\[data-tone="dark"\][^{]*\.mi-inner \{[^}]*background/.test(CSS.replace(/\[data-stat-style="card"\] \.mi-inner/g, '')),
    'plain：没有任何规则给 stat 上底色（深 bg 也不给，Chris 2026-09-28）');
}

// ══ AC7：槽位空 → 不渲染 ═════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 槽位空不渲染');
{
  const on = { blockImage: 'left', introImage: 'left' };
  const full = render('divided-row', withOpts(on));
  const cases = [
    ['blockImage', 'data-part="block-image"', (d) => { delete d.blockImage; }],
    ['introEyebrow', 'data-part="eyebrow"', (d) => { delete d.introEyebrow; }],
    ['introCtas', 'data-part="ctas"', (d) => { delete d.introCtas; }],
    ['introImage', 'data-part="intro-image"', (d) => { delete d.introImage; }],
    ['stats[].icon', 'data-part="icon"', (d) => { d.stats.forEach((s) => delete s.icon); }],
  ];
  for (const [slot, needle, drop] of cases) {
    const d = withOpts(on);
    drop(d);
    const empty = render('divided-row', d);
    check(count(full, needle) >= 1 && count(empty, needle) === 0, `${slot}：有值渲染（${count(full, needle)}）、清空不渲染（${count(empty, needle)}）`);
  }
  const one = withOpts(on);
  delete one.stats[2].icon;
  const perStat = statsOf(render('divided-row', one)).map((x) => (x.includes('data-part="icon"') ? 1 : 0));
  check(perStat.join('') === '110111', `只清第 3 条的 icon ⟹ 只那一条没有（${perStat.join('')}）`);
  const noHead = withOpts(on); delete noHead.headline; delete noHead.body;
  const nh = render('divided-row', noHead);
  check(!nh.includes('data-part="intro"') && !nh.includes('mi-introcol') && nh.includes('data-part="stats"'), 'headline + body 都清空 ⟹ 块头那一列不渲染、stats 照画');
  const onlyBody = withOpts(on); delete onlyBody.headline;
  check(render('divided-row', onlyBody).includes('data-part="intro"') && !render('divided-row', onlyBody).includes('data-slot="headline"'), '对照：只清 headline ⟹ 块头还在、没有空的 <h2>');
  check(count(full, 'data-cta=') === 2, `introCtas 给 ${DEMO.introCtas.length} 条只画 2 条（max 2）`);
  // 每条 stat 只有 value · label（+ icon），没有第三行。
  const parts = statsOf(full).map((x) => (x.match(/data-(?:slot|part)="([^"]+)"/g) || []).map((m) => m.replace(/data-(?:slot|part)="stats\.\d+\.|data-(?:slot|part)="|"/g, '')).join(','));
  check(parts.every((p) => p === 'icon,value,label'), `每条 stat 的节点 = icon · value · label，没有 caption（${[...new Set(parts)].join(' | ')}）`);
  const withCaption = withOpts(on); withCaption.stats[0].caption = 'Licensed & insured';
  check(!render('divided-row', withCaption).includes('Licensed &amp; insured'), '数据里硬塞一个 caption ⟹ 也不画（组件没有那一行）');
  const offKnob = render('divided-row', withOpts({ blockImage: 'none', introImage: 'none' }));
  check(!/<img\b/.test(offKnob), '两个图槽都有值、同名旋钮 none ⟹ DOM 里一张 <img> 都没有');
  const noUrl = render('divided-row', withOpts(on, { introImage: { alt: 'x' } }));
  check(!noUrl.includes('data-part="intro-image"'), 'introImage 只有 alt、没有 imageUrl ⟹ 不渲染');
  const noneStyle = render('divided-row', withOpts(on, { introEyebrow: { text: 'x', style: 'none' } }));
  check(!noneStyle.includes('data-part="eyebrow"'), 'introEyebrow.style=none ⟹ 不渲染');
  const styles = M.slots.introEyebrow.choices.style.filter((s) => s !== 'none')
    .map((s) => (/data-eyebrow="([^"]*)"/.exec(render('divided-row', { ...clone(DEMO), introEyebrow: { text: 'x', style: s } })) || [])[1]);
  check(styles.join() === 'pill,outline,dash,plain', `introEyebrow 四式都画得出来（${styles.join(' / ')}）`);
  check(JSON.stringify(M.slots.introEyebrow.choices.style) === '["none","pill","outline","dash","plain"]', 'introEyebrow.style 词表 none 在最前（#1481 规矩 1，与 features-new 一致）');
  check(M.slots.introCtas.max === 2, `introCtas.max = ${M.slots.introCtas.max}（数量维 0 / 1 / 2 从它派生）`);
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  const at = (bg) => render('divided-row', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light（深字）');
  check(attr(at('brand'), 'data-tone') === 'brand' && /style="background:var\(--x-primary\)"/.test(sectionTag(at('brand'))), 'brand ⟹ data-tone="brand"、底色 var(--x-primary)');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark',
    `渐变 {stops:[#7d52f4,#f7b733],angle:135} ⟹ linear-gradient(135deg,…) + data-tone="dark"（${sectionTag(g).match(/\sstyle="[^"]*"/)}）`);
  check(attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), '没写 bg ⟹ light、<section> 没有 style');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处（都调 contrast.js 的共用函数）`);
  check(/\[data-tone="dark"\] \.text-muted,\s*\n\[data-block="milestones"\]\[data-tone="brand"\] \.text-muted \{\s*color: rgba\(255, 255, 255, 0\.92\) !important;/.test(CSS),
    'block.css：dark / brand 时正文白 .92（不是灰）');
  check(/\[data-tone="dark"\] \.mi-value,[\s\S]*?\[data-tone="brand"\] \.mi-label,[\s\S]*?\{\s*color: #fff !important;/.test(CSS), 'block.css：dark / brand 时标题 / 数字 / label 反白');
  const v = (bg) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'milestones', data: { headline: 'H', stats: [{ value: '1', label: 'x' }], bg } }] }], scope: 'edit' }));
  check(v('#0f172a').length === 0 && v('brand').length === 0 && v({ stops: ['#7d52f4', '#f7b733'], angle: 135 }).length === 0, 'validateSite：#0f172a / brand / 两色标渐变放行');
  check(['red', '#fff', { stops: ['#ffffff'] }].every((b) => v(b).some((p) => p.includes('"bg"'))), 'validateSite：red / #fff / 一个色标的渐变被拒');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer-new').slots.bg), 'bg 槽对象与 footer-new 的 slots.bg 逐字相同');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const stat = (i) => ({ value: `${i}`, label: `Figure ${i}` });
  const v = (data, shape) => own(manifestLib.validateSite({
    pages: [{ slug: 'p', blocks: [{ type: 'milestones', ...(shape ? { shape } : {}), data: { headline: 'H', ...data } }] }], scope: 'edit',
  }));
  for (const n of [0, 7]) {
    const r = v({ stats: Array.from({ length: n }, (_, i) => stat(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('stats')) && r.some((p) => p.includes(n ? '最多只能有 6 项' : '至少要 1 项')),
      `stats ${n} 条 ⟹ 被拦、报错点名 stats`, JSON.stringify(r));
  }
  for (const n of [1, 6]) {
    const r = v({ stats: Array.from({ length: n }, (_, i) => stat(i)) });
    check(r.length === 0, `stats ${n} 条 ⟹ 放行`, JSON.stringify(r));
  }
  const img = { imageUrl: 'https://x.example/a.jpg', alt: 'a' };
  const r1 = v({ stats: [stat(1)], blockImage: img }, 'divided-row');
  check(r1.length === 1 && r1[0].includes('options.blockImage 没写'), '写了 blockImage 槽却没写 options.blockImage（Row 形态）⟹ 报一条（同名检查对本块生效）', JSON.stringify(r1));
  check(v({ stats: [stat(1)], blockImage: img, options: { blockImage: 'right' } }, 'divided-row').length === 0, '对照：写了 options.blockImage ⟹ 放行');
  check(v({ stats: [stat(1)], blockImage: img }, 'photo-side').length === 0, '对照：Photo side 预设自带 blockImage=right ⟹ 放行');
  for (const old of ['statsLayout', 'oneStat']) {
    const r = v({ stats: [stat(1)], options: { [old]: old === 'oneStat' ? true : 'row' } });
    check(r.length === 1 && r[0].includes(`"${old}"`), `已并掉的旧键 options.${old} ⟹ 报一条`, JSON.stringify(r));
  }
  const r3 = v({ stats: [stat(1)], options: { statsColumns: 4 } });
  check(r3.length === 1 && r3[0].includes('options.statsColumns'), 'options.statsColumns 写成数字 4 ⟹ 报一条（取值是字符串）', JSON.stringify(r3));
  for (const p of M.presets) {
    const r = v({ ...clone(DEMO), options: p.knobs }, p.shape);
    check(r.length === 0, `预设 ${p.name} 那组值（八个旋钮写全）+ 演示内容 ⟹ 放行`, JSON.stringify(r));
  }
}

// ══ AC10（组件一半）：图标表 → <svg> ══════════════════════════════════════════════════════════════
console.log('\n── AC10 图标');
{
  const h = render('divided-row', clone(DEMO));
  const per = statsOf(h).map((x) => count(x, '<svg'));
  check(per.length === DEMO.stats.length && per.every((x) => x === 1), `每条 stat 画出一个图标（<svg> 每条 ${per.join(' / ')}）`);
  const names = statsOf(h).map((x) => (/data-icon="([^"]+)"/.exec(x) || [])[1]);
  check(JSON.stringify(names) === JSON.stringify(DEMO.stats.map((s) => s.icon)), `图标名逐条对得上（${names.join(' · ')}）`);
  const d = clone(DEMO);
  d.stats[1].icon = 'no-such-icon-xyz';
  const warns = [];
  const table = icons.iconTableFor('milestones', d, { warn: (m) => warns.push(m) });
  const per2 = statsOf(render('divided-row', d, C, table)).map((x) => (x.includes('data-part="icon"') ? 1 : 0));
  check(per2.join('') === '101111' && warns.some((w) => w.includes('no-such-icon-xyz')),
    `第 2 条写一个不存在的名字 ⟹ 只那一条没有图标（连底色方块也没有）、其它不受影响（${per2.join('')}）、服务端打一行日志`);
  check(count(render('divided-row', clone(DEMO), C, {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  check(icons.usesIconTable('milestones') && !icons.usesIconTable('social-proof'), 'usesIconTable：milestones 用、social-proof（老那一套）不用');
  const tables = icons.iconTablesFor([{ type: 'social-proof', data: { icon: 'star' } }, { type: 'milestones', data: DEMO }], { warn: () => {} });
  check(tables[0] === undefined && tables[1] && DEMO.stats.every((s) => tables[1][s.icon]), 'iconTablesFor：老块那一格 undefined、milestones 那一格含每条 stat 的图标');
}

// ══ AC11：block-roles · 首页配方 ══════════════════════════════════════════════════════════════════
console.log('\n── AC11 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles.milestones === M.roleDefault, `block-roles.json 的 milestones（${roles.milestones}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  check(pool.includes('milestones'), `poolFor 含 milestones（池子 ${pool.length} 种）`);
  check(!('milestones' in recipe.NOT_IN_POOL), 'NOT_IN_POOL 里没有 milestones（它是首页正文块）');
  const without = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'milestones')));
  check(!without.includes('milestones') && without.length === pool.length - 1, `对照：块库里没有它 ⟹ 池子 ${without.length} 种（少一）`);
  const order = (t) => all.get(t).prompt.order;
  check(M.prompt.group === 'homepage' && order('features-new') < M.prompt.order && M.prompt.order < order('testimonials'),
    `prompt.group == homepage、order ${M.prompt.order} 在 features-new（${order('features-new')}）之后、testimonials（${order('testimonials')}）之前`);
  const lines = M.prompt.lines.join('\n');
  check(/1–6/.test(lines) && /Bootstrap Icons/.test(lines) && /top-level in data \(not inside options\)/.test(lines) && /(invent|real number)/.test(lines),
    'prompt.lines：stats 1–6 条、从站内事实取、编不出真数就别放、icon 是 Bootstrap Icons 名、bg 在 data 顶层');
}

// ══ AC13（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC13 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'milestones');
  check(!!on, 'Puck 组件里有 milestones（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'introCtas', 'stats', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → 按钮 → stats → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), '第一个字段：预设 5 个 → 八个旋钮（控件顺序 块 → intro → stats）');
  const st = on.fields.find((f) => f.slot === 'stats');
  check(st.control === 'list' && st.subs.map((x) => x.sub).join() === 'value,label', `stats 是列表字段、每条可改 value / label（${st.control} · ${st.subs.map((x) => x.sub).join(' / ')}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[3].knobs) === 'Photo side' && presetNameFor(man, { ...M.presets[3].knobs, statsColumns: '4' }) === 'custom',
    '点 Photo side = 那一组旋钮；拧偏一个（statsColumns=4）⟹ custom');
}

// ══ AC14：social-proof / hero-new 零改动 ═════════════════════════════════════════════════════════
console.log('\n── AC14 旧块零改动');
{
  let diff = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    diff = execFileSync('git', ['diff', '--name-only', base, '--', 'blocks/social-proof', 'blocks/hero-new'], { cwd: NEXT, encoding: 'utf8' }).trim();
  } catch (e) { console.log(`  ⚠️  取不到 git 读数（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  if (diff !== null) check(diff === '', `social-proof / hero-new 相对 merge-base 没有改动${diff ? `：${diff}` : ''}`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
