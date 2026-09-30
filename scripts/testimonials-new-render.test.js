#!/usr/bin/env node
/**
 * testimonials-new-render.test.js — #1488 验收里「看渲染出来的 HTML / 调一次校验器就能判」的那几条。
 *
 * 跑法:  node scripts/testimonials-new-render.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：AC1（4 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立）· AC3 的 DOM 一半（6 条引言全在
 * 服务端 HTML 里、没有一条 display:none、Pager 源码里没有定时器）· AC4（grid 没有圆点 / 按钮）· AC6 的 DOM 顺序 ·
 * AC7（槽位空不渲染、首字母圆、星级）· AC8（bg + 不自己算亮度）· AC9（validateSite）· AC10（block-roles · 首页配方池）·
 * AC12 的编辑器 schema 一半 · AC13（旧 testimonials 零改动）· 图标表（星 / 箭头真画成 <svg>）。
 * 几何（16 种组合三端无横向滚动、轮播滚动 / 圆点、一列 48rem、星级对齐一线、计算色）要浏览器：
 * `tests/e2e/specs/1488-testimonials-new-knobs.spec.ts`。
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
const BLOCK = path.join(NEXT, 'blocks', 'testimonials-new');
const SECTION = path.join(BLOCK, 'Section.tsx');
const PAGER = path.join(BLOCK, 'Pager.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

// ── 让 node 能 require 这份 .tsx（同 milestones-render.test.js）──────────────────────────────────────
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
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
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT['testimonials-new'];
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  M = manifestLib.loadManifests().get('testimonials-new');
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
} catch (e) { die(`载入失败: ${e.message}`); }
if (!DEMO) die('demo-content 里没有 testimonials-new');
if (!M) die('blocks/ 里没有 testimonials-new');

const clone = (v) => JSON.parse(JSON.stringify(v));
const TABLE = icons.iconTableFor('testimonials-new', DEMO, { warn: () => {} });
const render = (shape, data, Comp = C, iconTable = TABLE) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable, block: { id: 't', type: 'testimonials-new', shape, data: {} },
}));
const withOpts = (o, extra = {}, base = DEMO) => ({ ...clone(base), ...extra, options: { ...(base.options || {}), ...o } });
const count = (html, needle) => html.split(needle).length - 1;
const own = (r) => r.problems.filter((p) => p.includes('("testimonials-new")'));
const sectionTag = (html) => (/<section[^>]*>/.exec(html) || [''])[0];
const attr = (html, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(sectionTag(html)); return m ? m[1] : null; };
const itemsOf = (html) => html.split('data-part="item"').slice(1);
const CSS = fs.readFileSync(path.join(BLOCK, 'block.css'), 'utf-8');
const SRC_TEXT = fs.readFileSync(SECTION, 'utf-8');
const PAGER_TEXT = fs.readFileSync(PAGER, 'utf-8');
const KNOB_NAMES = ['introPosition', 'introAlign', 'itemsLayout', 'itemsColumns', 'itemStyle', 'quoteSize', 'itemAlign'];
const dataAttr = (n) => `data-${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ══ AC1：4 个预设逐字、旋钮名 / 值逐字、parts、目录集合、两两不同、旋钮独立 ═══════════════════════════
console.log('── AC1 四个预设');
{
  // 列：名字 · 形态目录 · 七列旋钮（正文预设表逐字）
  const WANT = [
    ['Cards', 'cards', 'top', 'center', 'grid', '3', 'card', 'md', 'left'],
    ['Side intro', 'side-intro', 'left', 'left', 'carousel', '2', 'card', 'md', 'left'],
    ['Big quote', 'big-quote', 'top', 'center', 'carousel', '1', 'plain', 'lg', 'center'],
    ['Quote card', 'quote-card', 'top', 'center', 'carousel', '2', 'card', 'lg', 'left'],
  ];
  const got = (M.presets || []).map((p) => [p.name, p.shape, ...KNOB_NAMES.map((c) => p.knobs[c])]);
  check(JSON.stringify(got) === JSON.stringify(WANT), 'presets 4 条与正文表逐字相同（名字 · 形态 · 七列旋钮）', JSON.stringify(got));
  check((M.presets || []).every((p) => Object.keys(p.knobs).join() === KNOB_NAMES.join()), '每个预设的 knobs 键就是这七个、同一顺序');
  const knobs = M.slots.options.knobs.map((k) => [k.name, k.values]);
  check(JSON.stringify(knobs) === JSON.stringify([
    ['introPosition', ['left', 'right', 'top', 'bottom']], ['introAlign', ['left', 'center', 'right']],
    ['itemsLayout', ['grid', 'carousel']], ['itemsColumns', ['1', '2', '3']],
    ['itemStyle', ['plain', 'card']], ['quoteSize', ['md', 'lg']], ['itemAlign', ['left', 'center']],
  ]), `slots.options.knobs 名字依次 ${knobs.map((k) => k[0]).join(' / ')}、values 与定稿表逐字（values[0] = 默认）`);
  check(JSON.stringify(M.parts) === '["summary"]', `parts == ["summary"]（${JSON.stringify(M.parts)}）`);
  const dirs = fs.readdirSync(BLOCK, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  check(JSON.stringify(dirs) === JSON.stringify(WANT.map((w) => w[1]).sort()), `目录集合 == 4 个预设形态（${dirs.join(' / ')}）`);
  check(dirs.every((d) => !fs.existsSync(path.join(BLOCK, d, 'Section.tsx'))), '一份 Section.tsx（形态目录里没有第二份 markup）');
  check(M.skin === 'site-css' && M.roleDefault === 'optional', `skin=${M.skin} · roleDefault=${M.roleDefault}`);
  const htmls = dirs.map((d) => render(d, clone(DEMO)));
  check(new Set(htmls).size === 4, `同一份夹具下 4 个预设渲染出 ${new Set(htmls).size} 份互不相同的 HTML`);
  const pinned = dirs.map((d) => render(d, withOpts(M.presets[0].knobs)).replace(/data-shape="[^"]*"/g, ''));
  check(new Set(pinned).size === 1, '反向对照：options 里写死七个旋钮 ⟹ 4 个预设（去掉 data-shape 之后）塌成同一份 —— 判据分得开');
  const r = render('cards', clone(DEMO));
  const miss = KNOB_NAMES.filter((n) => attr(r, dataAttr(n)) !== M.presets[0].knobs[n]);
  check(miss.length === 0, 'Cards：七个旋钮都写在 <section> 上', miss.join(' · '));
  // 旋钮独立：拧一个，其余六个不变（组件里没有联动纠正）。
  const base = M.presets[1].knobs;
  const moved = [];
  for (const k of M.slots.options.knobs) {
    for (const v of k.values) {
      const h = render('side-intro', withOpts({ [k.name]: v }));
      const others = KNOB_NAMES.filter((n) => n !== k.name);
      if (attr(h, dataAttr(k.name)) !== v || others.some((n) => attr(h, dataAttr(n)) !== base[n])) moved.push(`${k.name}=${v}`);
    }
  }
  check(moved.length === 0, `旋钮独立（Side intro 上逐个拧 ${M.slots.options.knobs.reduce((n, k) => n + k.values.length, 0)} 档）：拧的那个到位、其余六个不变`, moved.join(' · '));
}

// ══ AC3 / AC4（DOM 一半）：轮播全在服务端 HTML 里；grid 没有圆点 / 按钮 ═══════════════════════════════
console.log('\n── AC3 / AC4 轮播与网格');
{
  const car = render('side-intro', clone(DEMO));
  const grid = render('cards', clone(DEMO));
  check(count(car, '<blockquote') === DEMO.items.length && DEMO.items.length === 6, `carousel：服务端 HTML 里 <blockquote> ${count(car, '<blockquote')} 个 == 夹具 6 条`);
  check(count(car, '<figure') === 6 && count(car, '<figcaption') === 6, '每条是 <figure> + <blockquote> + <figcaption>');
  check(!/display:\s*none/.test(car) && !/\shidden[\s>=]/.test(car), '没有任何一条被 display:none / hidden（藏的只是「横着排、一次露几条」）');
  check(count(car, 'data-part="pager"') === 1 && count(car, 'data-dot=') === 6 && count(car, 'aria-label="Previous"') === 1 && count(car, 'aria-label="Next"') === 1,
    `carousel：一个 pager、6 个圆点（每条一个）、前 / 后两个按钮（圆点 ${count(car, 'data-dot=')}）`);
  check(/aria-label="Review 1"/.test(car) && /aria-label="Review 6"/.test(car) && count(car, 'class="tn-dot on"') === 1 && car.indexOf('class="tn-dot on"') < car.indexOf('data-dot="1"'),
    '圆点 aria-label = Review N；初始亮的是第 1 个（且只有一个）');
  check(count(car, '<div class="tn-grid" data-part="track" tabindex="0" aria-label="Customer reviews">') === 1,
    '轨道 tabindex="0" + aria-label（键盘可滚）');
  check(count(grid, 'data-part="pager"') === 0 && count(grid, 'data-dot=') === 0 && count(grid, 'tn-arrow') === 0 && count(grid, '<blockquote') === 6,
    'grid：没有圆点 / 按钮节点，6 条全部摊开');
  check(!/tabindex/.test(grid), 'grid：轨道不可聚焦（不滚，就不占 Tab 顺序）');
  check(!/set(Timeout|Interval)|requestAnimationFrame|autoplay/i.test(PAGER_TEXT.replace(/^\s*\/\/.*$/gm, '')), 'Pager.tsx 里没有定时器（不自动播放）');
  check(/^'use client';/.test(PAGER_TEXT) && !/^'use client'/.test(SRC_TEXT), '只有 Pager.tsx 是客户端组件，Section.tsx 不是');
  check(/scroll-snap-type: x mandatory;/.test(CSS) && /scroll-snap-align: start;/.test(CSS) && /overflow-x: auto;/.test(CSS) && /scrollbar-width: none;/.test(CSS),
    'block.css：原生 overflow-x auto + scroll-snap（每条 snap start）+ 滚动条隐藏 —— 真滚动在 e2e 里量');
}

// ══ AC5（规则一半）：一列照 faq ═════════════════════════════════════════════════════════════════════
console.log('\n── AC5 一列照 faq（规则）');
{
  check(/\[data-items-columns="1"\]\[data-intro-position="top"\] \.tn-itemscol,\s*\[data-block="testimonials-new"\]\[data-items-columns="1"\]\[data-intro-position="bottom"\] \.tn-itemscol \{\s*max-width: 48rem;/.test(CSS),
    'block.css：一列 + 块头在上 / 下 ⟹ 评价列限 48rem（只对 top / bottom 开火，块头在侧时占满右列）');
  check(!/\[data-intro-position="left"\][^{]*\.tn-itemscol \{\s*max-width/.test(CSS), '反向：块头在侧没有 48rem 那条');
}

// ══ AC6：每条的顺序 ═════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC6 每条的顺序');
{
  const its = itemsOf(render('cards', clone(DEMO)));
  const order = its.map((x) => [x.indexOf('<blockquote'), x.indexOf('<figcaption'), x.indexOf('data-part="meta"')]);
  check(order.every(([q, p, s]) => q >= 0 && q < p && (s === -1 || p < s)), `DOM 顺序 = 引言 → 人 → 星级 + 来源（${its.length} 条都是）`);
  check(/\.tn-meta \{\s*margin-top: auto;/.test(CSS), 'block.css：星级那行 margin-top:auto（等高时贴卡底）—— 对齐一线在 e2e 里量');
}

// ══ AC7：槽位空 → 不渲染；首字母圆；星级 ══════════════════════════════════════════════════════════════
console.log('\n── AC7 槽位');
{
  const full = render('cards', clone(DEMO));
  const noSum = clone(DEMO); delete noSum.summary;
  check(count(full, 'data-part="summary"') === 1 && count(render('cards', noSum), 'data-part="summary"') === 0, 'summary：有值渲染、清空不渲染');
  const badSum = clone(DEMO); badSum.summary = { count: '312', source: 'Google' };
  check(count(render('cards', badSum), 'data-part="summary"') === 0, 'summary 没写 rating（没有真实总评分）⟹ 那一行不画');
  const its = itemsOf(full);
  const photos = its.map((x) => count(x, '<img'));
  const inits = its.map((x) => count(x, 'data-part="initials"'));
  check(photos.join('') === '111100' && inits.join('') === '000011', `4 条带头像 ⟹ <img>；2 条没有 ⟹ 首字母圆、没有 <img>（img ${photos.join('')} · 首字母 ${inits.join('')}）`);
  check(/data-part="initials" aria-hidden="true">SP</.test(full) && /aria-hidden="true">AR</.test(full), '首字母 = 名字前两个词的首字母（Sam Patel → SP、Ana Rodrigues → AR）');
  const starsOf = (x) => ({ fill: count(x, 'data-star="fill"'), half: count(x, 'data-star="half"'), empty: count(x, 'data-star="empty"') });
  const s4 = starsOf(its[5]);
  check(s4.fill === 4 && s4.empty === 1 && s4.half === 0, `rating: 4 ⟹ 4 颗实心星（+ 1 颗空心补到 5）（${JSON.stringify(s4)}）`);
  check(its.slice(0, 5).every((x) => starsOf(x).fill === 5), '其余 rating: 5 ⟹ 5 颗实心');
  const noRate = clone(DEMO); delete noRate.items[0].rating;
  const nr = itemsOf(render('cards', noRate))[0];
  check(count(nr, 'data-part="stars"') === 0 && count(nr, 'data-slot="items.0.source"') === 1, '某条没 rating ⟹ 没有星级节点、来源照常');
  const neither = clone(DEMO); delete neither.items[0].rating; delete neither.items[0].source;
  check(count(itemsOf(render('cards', neither))[0], 'data-part="meta"') === 0, '对照：rating 和 source 都没有 ⟹ 整行不画');
  const sumStars = /data-part="summary"[\s\S]*?<\/div>/.exec(full)[0];
  check(count(sumStars, 'data-star="fill"') === 5, `summary 4.9 ⟹ 按 0.5 取整 = 5 颗实心（${count(sumStars, 'data-star="fill"')}）`);
  const half = clone(DEMO); half.summary.rating = '4.4';
  const hs = /data-part="summary"[\s\S]*?<\/div>/.exec(render('cards', half))[0];
  check(count(hs, 'data-star="fill"') === 4 && count(hs, 'data-star="half"') === 1, 'summary 4.4 ⟹ 4 颗实心 + 1 颗半星');
  check(/<span data-slot="summary.count">312<\/span> <span data-slot="summary.source">Google<\/span> reviews/.test(full), 'summary 那行 = 大数字 + 五星 + 「312 Google reviews」');
  const noHead = clone(DEMO); delete noHead.headline; delete noHead.body;
  const nh = render('cards', noHead);
  check(!nh.includes('data-part="intro"') && nh.includes('data-part="items"'), 'headline + body 都清空 ⟹ 块头那一列不渲染、评价照画');
}

// ══ 图标：星 / 箭头真画成 <svg>（BLOCK_ICONS 那一行）════════════════════════════════════════════════
console.log('\n── 图标');
{
  const want = ['star-fill', 'star-half', 'star', 'chevron-left', 'chevron-right'];
  check(JSON.stringify(icons.BLOCK_ICONS['testimonials-new']) === JSON.stringify(want) && want.every((n) => TABLE[n]), `BLOCK_ICONS['testimonials-new'] == ${want.join(' / ')}，表里五个都查得到`);
  const car = render('side-intro', clone(DEMO));
  const svgIn = (html, sel) => { const i = html.indexOf(sel); const j = html.indexOf('</button>', i); return i >= 0 && /<svg[^>]*>[\s\S]*<path/.test(html.slice(i, j)); };
  check(svgIn(car, 'aria-label="Previous"') && svgIn(car, 'aria-label="Next"'), '前 / 后按钮里各有一个非空的内联 <svg>');
  check(itemsOf(car).every((x) => (x.match(/data-star="[a-z]+"[^>]*><svg/g) || []).length === 5), '每条 5 颗星都是内联 <svg>');
  check(count(render('side-intro', clone(DEMO), C, {}), '<svg') === 0, '对照：不给图标表 ⟹ 一个 <svg> 都没有（图标全靠服务端那张表）');
  check(icons.usesIconTable('testimonials-new') && !icons.usesIconTable('testimonials'), 'usesIconTable：testimonials-new 用、旧 testimonials 不用');
}

// ══ AC8：bg ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 bg');
{
  const at = (bg) => render('cards', withOpts({}, { bg }));
  check(attr(at('#0f172a'), 'data-tone') === 'dark' && /style="background:#0f172a"/.test(sectionTag(at('#0f172a'))), '#0f172a ⟹ data-tone="dark"、<section> 底色 #0f172a');
  check(attr(at('#ffffff'), 'data-tone') === 'light', '#ffffff ⟹ light');
  check(attr(at('brand'), 'data-tone') === 'brand', 'brand ⟹ data-tone="brand"');
  const g = at({ stops: ['#7d52f4', '#f7b733'], angle: 135 });
  check(/style="background:linear-gradient\(135deg,#7d52f4,#f7b733\)"/.test(sectionTag(g)) && attr(g, 'data-tone') === 'dark', '渐变 ⟹ linear-gradient(135deg,…) + data-tone="dark"');
  check(attr(at(undefined), 'data-tone') === 'light' && !/\sstyle=/.test(sectionTag(at(undefined))), '没写 bg ⟹ light、<section> 没有 style');
  check(count(SRC_TEXT, 'toneFor(') === 0 && count(SRC_TEXT, 'linear-gradient') === 0,
    `Section.tsx 里 toneFor( ${count(SRC_TEXT, 'toneFor(')} 处、linear-gradient ${count(SRC_TEXT, 'linear-gradient')} 处（都调 contrast.js 的共用函数）`);
  check(/\[data-tone="dark"\] \.tn-quote,[\s\S]*?\{\s*color: #fff !important;/.test(CSS) && /\[data-tone="dark"\] \.tn-arrow,[\s\S]*?\{\s*background: transparent;\s*border-color: rgba\(255, 255, 255, 0\.35\);/.test(CSS),
    'block.css：深底引言 / 名字反白；前后按钮透明底 + 半透明白描边');
  check(!/\.text-muted\s*\{[^}]*rgba\(255, 255, 255/.test(CSS), '身份 / 来源白 .92 走全站那条（site-css.js §ON_DEEP_MUTED），block.css 里没有自己那份');
  check(JSON.stringify(M.slots.bg) === JSON.stringify(manifestLib.loadManifests().get('footer-new').slots.bg), 'bg 槽对象与 footer-new 的 slots.bg 逐字相同');
}

// ══ AC9：validateSite ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 validateSite');
{
  const item = (i, extra = {}) => ({ quote: `Quote ${i}`, name: `Person ${i}`, ...extra });
  const v = (data) => own(manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'testimonials-new', data: { headline: 'H', ...data } }] }], scope: 'edit' }));
  for (const n of [0, 13]) {
    const r = v({ items: Array.from({ length: n }, (_, i) => item(i)) });
    check(r.length >= 1 && r.every((p) => p.includes('items')) && r.some((p) => p.includes(n ? '最多只能有 12 项' : '至少要 1 项')), `items ${n} 条 ⟹ 被拦、报错点名 items`, JSON.stringify(r));
  }
  for (const n of [1, 12]) check(v({ items: Array.from({ length: n }, (_, i) => item(i, { rating: 5 })) }).length === 0, `items ${n} 条 ⟹ 放行`);
  const r6 = v({ items: [item(0, { rating: 6 })] });
  check(r6.length === 1 && r6[0].includes('items[0].rating') && r6[0].includes('1–5'), 'rating: 6 ⟹ 报一条（点名 items[0].rating）', JSON.stringify(r6));
  check(['4.5', 0, 2.5].every((x) => v({ items: [item(0, { rating: x })] }).length === 1), 'rating "4.5" / 0 / 2.5 ⟹ 各报一条（要 1–5 的整数）');
  check([1, 3, 5].every((x) => v({ items: [item(0, { rating: x })] }).length === 0) && v({ items: [item(0)] }).length === 0, 'rating 1 / 3 / 5 / 不写 ⟹ 放行');
  check(JSON.stringify(M.slots.items.ranges) === '{"rating":[1,5]}', `判据从 manifest 读：slots.items.ranges == {"rating":[1,5]}（不是写死在校验器里的块名单）`);
  // 声明本身被校验：写歪了 manifest 当场拒（写成字符串的失败方向是静默的）。
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tn-ranges-'));
  try {
    const load = (ranges) => {
      const dir = path.join(tmp, String(Math.random()).slice(2));
      fs.cpSync(BLOCK, path.join(dir, 'testimonials-new'), { recursive: true });
      const mf = path.join(dir, 'testimonials-new', 'manifest.json');
      const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); j.slots.items.ranges = ranges; fs.writeFileSync(mf, JSON.stringify(j));
      try { manifestLib.loadManifests(dir); return ''; } catch (e) { return e.message; }
    };
    const bogus = load({ rating: ['1', '5'] });
    check(/ranges\.rating/.test(bogus), `ranges 写成字符串 ⟹ manifest 当场被拒（${bogus.slice(0, 90)}）`);
    check(load({ rating: [1, 5] }) === '', '对照：原样 [1, 5] ⟹ 载得进');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  for (const p of M.presets) {
    check(v({ ...clone(DEMO), options: p.knobs }).length === 0, `预设 ${p.name} 那组值（七个旋钮写全）+ 演示内容 ⟹ 放行`);
  }
}

// ══ QA2 r1 打回：评价头像不是内容图 · 总评分不许照抄提示词里的示例数字 ═══════════════════════════════
// 真建站（siteId 1488a003）读到：imageSlotsOf 把 items[].photo 当成内容图槽 ⟹ 每条评价拿到一张 AI 生成的
// 店内场景照当头像；summary 两次都原样写成提示词示例里的 4.9 / 312（连「No reviews yet」的生意也是）。
const avatarChecks = (async () => {
  console.log('\n── 头像不生成（generateImages: false）· 总评分提示词不带示例数字');
  const ims = require(path.join(NEXT, 'scripts', 'lib', 'image-slots.js'));
  const all = manifestLib.loadManifests();
  const slotsOf = (m) => JSON.stringify(manifestLib.imageSlotsOf(m));
  check(slotsOf(all.get('testimonials-new')) === '[]', `imageSlotsOf(testimonials-new) == []（现取 ${slotsOf(all.get('testimonials-new'))}）`);
  // 对照：拿掉那条声明 ⟹ 它又被读成内容图槽（上面那格的绿是声明换来的，不是 shape 恰好读不出来）。
  const noDecl = clone(all.get('testimonials-new')); delete noDecl.slots.items.generateImages;
  check(slotsOf(noDecl) === '[{"name":"items","kind":"list","imageKey":"photo"}]', `对照：拿掉 generateImages ⟹ 读成 items/photo（${slotsOf(noDecl)}）`);
  // 真走一遍建站填图那一步：没带 photo 的评价不求图、不写 photo。
  const run = async (manifests) => {
    let calls = 0;
    const pages = [{ slug: 'home', sections: [{ type: 'testimonials-new', data: { headline: 'H', items: [{ quote: 'q', name: 'Marcus T.' }, { quote: 'q2', name: 'Priya S.' }] } }] }];
    await ims.fillImageSlots({ pages, manifests, industry: 'auto repair', primaryColor: '#3b82f6', themeWord: 'minimal',
      produce: async ({ key }) => { calls += 1; return `/photos/${key}.jpg`; } });
    return { calls, items: pages[0].sections[0].data.items };
  };
  const fillReal = await run(all);
  check(fillReal.calls === 0 && fillReal.items.every((it) => it.photo === undefined), `fillImageSlots：求图 ${fillReal.calls} 次、没有一条被写上 photo`);
  const withoutDecl = new Map(all); withoutDecl.set('testimonials-new', noDecl);
  const fillCtl = await run(withoutDecl);
  check(fillCtl.calls === 2 && fillCtl.items.every((it) => it.photo && it.photo.imageUrl), `对照：拿掉声明 ⟹ 求图 ${fillCtl.calls} 次、每条都被写上 photo（这正是 r1 的缺陷）`);
  // 老板上传的头像照样能写进来：写入闸认的是字段名 imageUrl，跟生不生成无关。
  const urls = require(path.join(NEXT, 'scripts', 'lib', 'image-urls.js'));
  const fields = urls.collectImagePositions({ items: [{ photo: { imageUrl: 'https://uploads.example/x.jpg' } }] });
  check(fields.length === 1 && fields[0] === 'https://uploads.example/x.jpg', `写入闸仍认得 items[].photo.imageUrl（读到 ${JSON.stringify(fields)}）`);
  // 声明本身被校验：只收字面 false、只给带图的槽。
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tn-genimg-'));
  try {
    const load = (edit) => {
      const dir = path.join(tmp, String(Math.random()).slice(2));
      fs.cpSync(BLOCK, path.join(dir, 'testimonials-new'), { recursive: true });
      const mf = path.join(dir, 'testimonials-new', 'manifest.json');
      const j = JSON.parse(fs.readFileSync(mf, 'utf-8')); edit(j); fs.writeFileSync(mf, JSON.stringify(j));
      try { manifestLib.loadManifests(dir); return ''; } catch (e) { return e.message; }
    };
    check(/generateImages/.test(load((j) => { j.slots.items.generateImages = 'false'; })), 'generateImages 写成字符串 "false" ⟹ manifest 当场被拒');
    check(/generateImages/.test(load((j) => { j.slots.headline.generateImages = false; })), 'generateImages 写在不带图的槽（headline）⟹ 当场被拒');
    check(load(() => {}) === '', '对照：原样 ⟹ 载得进');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const summaryLine = (M.prompt.lines || []).find((l) => /^summary\b/.test(l)) || '';
  check(summaryLine !== '' && !/\d\.\d|\b\d{2,}\b/.test(summaryLine), `summary 那行提示词里没有可被照抄的示例数字（${summaryLine.slice(0, 80)}…）`);
  check(/\d\.\d|\b\d{2,}\b/.test('summary {rating, count, source} only when … (e.g. 4.9 from 312 Google reviews)'), '对照：r1 那句（e.g. 4.9 from 312）⟹ 上面那格会红');
})();

// ══ AC10：block-roles · 首页配方 ══════════════════════════════════════════════════════════════════
console.log('\n── AC10 block-roles · 首页配方');
{
  const roles = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sections', 'block-roles.json'), 'utf-8'));
  check(roles['testimonials-new'] === M.roleDefault, `block-roles.json 的 testimonials-new（${roles['testimonials-new']}）== manifest roleDefault（${M.roleDefault}）`);
  const recipe = require(path.join(NEXT, 'scripts', 'lib', 'homepage-recipe.js'));
  const all = manifestLib.loadManifests();
  const pool = recipe.poolFor(all);
  check(pool.includes('testimonials-new') && !pool.includes('testimonials'), `poolFor 含 testimonials-new、不含旧 testimonials（池子 ${pool.length} 种）`);
  check('testimonials' in recipe.NOT_IN_POOL && /testimonials-new/.test(recipe.NOT_IN_POOL.testimonials), `'testimonials' in NOT_IN_POOL（${recipe.NOT_IN_POOL.testimonials}）`);
  // 池子种数 == 本票交付前：一进一出。反向对照：从排除名单拿掉 testimonials ⟹ 两个都进池、种数 +1。
  const saved = recipe.NOT_IN_POOL.testimonials;
  delete recipe.NOT_IN_POOL.testimonials;
  let leaked;
  try { leaked = recipe.poolFor(all); } finally { recipe.NOT_IN_POOL.testimonials = saved; }
  check(leaked.includes('testimonials') && leaked.includes('testimonials-new') && leaked.length === pool.length + 1, `反向对照：拿掉排除那一条 ⟹ 两个都进池、种数 ${leaked.length}（+1）`);
  const without = recipe.poolFor(new Map([...all].filter(([k]) => k !== 'testimonials-new')));
  check(without.length === pool.length - 1 && !without.includes('testimonials'), `对照：块库里没有 testimonials-new ⟹ 池子 ${without.length} 种（少一，旧的也不回来）`);
  check(M.prompt.group === 'homepage' && Number.isInteger(M.prompt.order), `prompt.group == homepage、order ${M.prompt.order}`);
  const lines = M.prompt.lines.join('\n');
  check(/never invent/.test(lines) && /source is the platform/.test(lines) && /summary .*only if one is stated.*leave summary out entirely/.test(lines) && /top-level in data \(not inside options\)/.test(lines),
    'prompt.lines：只放真实评价不编造、source 写平台、summary 只在有真实总评分时写、bg 在 data 顶层');
}

// ══ AC12（编辑器 schema 一半；往返无损由 editor-roundtrip.test.js 对全部页面块量）═══════════════════════
console.log('\n── AC12 编辑器 schema');
{
  const { editorSchema } = require(path.join(NEXT, 'scripts', 'lib', 'editor-schema.js'));
  const { presetNameFor } = require(path.join(NEXT, 'scripts', 'lib', 'block-knobs.js'));
  const on = editorSchema({}).components.find((c) => c.type === 'testimonials-new');
  check(!!on, 'Puck 组件里有 testimonials-new（能从左栏拖进页面）');
  const order = on.fields.map((f) => f.slot);
  check(JSON.stringify(order) === JSON.stringify(['options', 'introEyebrow', 'headline', 'body', 'summary', 'items', 'bg']),
    `字段顺序 = 旋钮 → 眉标 → 块头 → summary → items → bg（${order.join(' → ')}）`);
  const opt = on.fields[0];
  check(opt.control === 'options' && opt.presets.map((p) => p.name).join() === M.presets.map((p) => p.name).join()
    && opt.knobs.map((k) => k.name).join() === KNOB_NAMES.join(), '第一个字段：预设 4 个 → 七个旋钮');
  const it = on.fields.find((f) => f.slot === 'items');
  check(it.control === 'list' && it.subs.map((x) => x.sub).join() === 'quote,name,role,source', `items 是列表字段、每条可改 quote / name / role / source（${it.subs.map((x) => x.sub).join(' / ')}）`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  check(presetNameFor(man, M.presets[2].knobs) === 'Big quote' && presetNameFor(man, { ...M.presets[2].knobs, itemsColumns: '2' }) === 'custom',
    '点 Big quote = 那一组旋钮；拧偏一个（itemsColumns=2）⟹ custom');
}

// ══ AC13：旧 testimonials 零改动 ════════════════════════════════════════════════════════════════
console.log('\n── AC13 旧块零改动');
{
  let diff = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: NEXT, encoding: 'utf8' }).trim();
    // 同 milestones-render.test.js AC14：本块已在 merge-base 上 = #1488 落地了，之后的票合法地改旧块不该在它们的分支上红。
    let landed = true;
    try { execFileSync('git', ['cat-file', '-e', `${base}:templates/nextjs/blocks/testimonials-new/manifest.json`], { cwd: NEXT, stdio: 'ignore' }); } catch { landed = false; }
    if (landed) console.log(`  ⏭  testimonials-new 已在 merge-base ${base.slice(0, 8)} 上（#1488 已落地），这一格只管 #1488 自己的交付 —— 不算通过`);
    else diff = execFileSync('git', ['diff', '--name-only', base, '--', 'blocks/testimonials'], { cwd: NEXT, encoding: 'utf8' }).trim()
      + execFileSync('git', ['diff', '--name-only', '--', 'blocks/testimonials'], { cwd: NEXT, encoding: 'utf8' }).trim();
  } catch (e) { console.log(`  ⚠️  取不到 git 读数（${e.message.split('\n')[0]}），这一格跳过 —— 不算通过`); }
  if (diff !== null) check(diff === '', `blocks/testimonials 相对 merge-base 与工作区都没有改动${diff ? `：${diff}` : ''}`);
}

avatarChecks.then(() => {
  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
}, (e) => { console.error(`🔴 跑不起来: ${e.stack || e.message}`); process.exit(2); });
