#!/usr/bin/env node
'use strict';
// #1697 —— 配色方案 / 色相滑块之后，site.css 里 `--x-primary` 一族跟着主色走；Customize 预览用 JS 算的同一族值。
//
//   ① 锚点：Sass 真编 + purge 的 site.css（4 个主色）里，`primary-family.js` §RULES 每一条都逐值相同
//   ② 覆盖：两份主色编出来的 site.css 逐条 diff —— 跟着主色走的每一条声明，要么在 §RULES 里（预览盖它），要么在
//      下面 PREVIEW_SKIP 里写着理由；第三种判红（Webpixels 升级多派生一条，这里先红）
//   ③ 网格：6 套配色 × 色相 31 档 + 池里主题 × 31 档，`:root` 明暗两份那几条逐值相同。
//      🔴 网格用的是「精简入口」—— 同一套 Webpixels 源码，只编到生成 `:root` 那几份（functions / variables / maps /
//      root），每个主色约 0.2 秒；完整编一份 site.css 要 2 秒多，248 个就是 9 分钟。精简入口是不是真产物的替身，
//      由 ③ 的第一格当场证：4 个锚点上，精简入口和完整 site.css 的这几条逐值相同。
//   ④ 字能不能看清（AC3）：值全从上面那份 Sass 输出里读（`--x-primary-rgb` / `--x-primary-bg-subtle`），不在这里
//      再派生一遍 —— 3b 的余量只有 0.03 左右，两端各自取整就能把结论翻面（PM 2026-10-11 裁定 1）。
//      3a：`brand` 底（= `--x-primary`）上的白字，6 套配色 × 31 档，过 `theme-contrast.js` 那把尺（字先朝底掺
//          PAINT_BLEND，再比 MIN_CONTRAST）。不圈主题原色（ember-12 原色掺色后 4.23，正文写明了）。
//      3b：eyebrow pill（`text-primary` 字压 `bg-primary-subtle` 底，同一把尺），每个池里主题 × 每套配色 × 31 档，
//          不低于那套主题原色、色相 0 那一档。主题原色那一端从**完整** site.css（①的锚点）读。
//      两条各配一个对照：一个浅蓝主色喂进同一个判断，必须判不过 —— 证明判断不是恒真。

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

let sass; let postcss;
try { sass = require('sass'); postcss = require('postcss'); } catch (e) { die(`sass / postcss 装不上：${e.message}`); }
const siteCss = require('./lib/site-css.js');
const F = require('./primary-family.js');
const { PALETTES } = require('./theme-presets.js');
const { shiftHue } = require('./tweaks.js');
const C = require('./theme-contrast.js');
const POOL = require('./theme-pool.json');

// ── 读 CSS ───────────────────────────────────────────────────────────────────────────────────────
/** CSS → Map(`选择器|属性` → 值)。同一个键出现多次取最后一条（同特异度、后来的赢，跟浏览器一样）。只看顶层规则。 */
function indexCss(css) {
  const idx = new Map();
  postcss.parse(css).walkDecls((d) => {
    if (d.parent.type === 'rule' && d.parent.parent.type === 'root') idx.set(`${d.parent.selector}|${d.prop}`, d.value);
  });
  return idx;
}
const nums = (v) => (String(v).match(/-?\d+(\.\d+)?/g) || []).map(Number);
/** `#rrggbb` → [r, g, b]；别的形状 → 里面的数。Sass 混出来的通道恰好全是整数时印 hex（`#0a285e`），否则印 `rgb(…)`。 */
const valueNums = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v).trim()) ? [1, 3, 5].map((i) => parseInt(String(v).trim().slice(i, i + 2), 16)) : nums(v));
/** 两个值是不是同一个颜色 / 同一组数：逐个数比（Sass 印到小数点后 10 位）。 */
function same(a, b) {
  if (a === undefined || b === undefined) return false;
  const x = valueNums(a); const y = valueNums(b);
  return x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-6);
}
const famKey = (sel, prop) => `${sel}|${prop}`;
function familyMismatches(primary, idx, onlySelectors) {
  const out = [];
  for (const [sel, decls] of F.primaryFamily(primary)) {
    if (onlySelectors && !onlySelectors.includes(sel)) continue;
    for (const [prop, v] of decls) {
      const s = idx.get(famKey(sel, prop));
      if (!same(s, v)) out.push(`${JSON.stringify(sel)} ${prop}: sass=${s} js=${v}`);
    }
  }
  return out;
}
const LIGHT = ':root,\n[data-bs-theme=light]';
const DARK = '[data-bs-theme=dark]';

// ── 编 ───────────────────────────────────────────────────────────────────────────────────────────
const fullCss = (p) => siteCss.buildSiteCss({ brand: { colors: { primary: { 500: p } } }, rootDir: NEXT }).then((r) => r.css);

const REDUCED_IMPORTS = [
  'bootstrap/scss/functions', '@webpixels/css/variables', '@webpixels/css/variables-dark',
  'bootstrap/scss/variables', 'bootstrap/scss/variables-dark', '@webpixels/css/maps', '@webpixels/css/mixins',
  'bootstrap/scss/maps', 'bootstrap/scss/mixins', 'bootstrap/scss/root', '@webpixels/css/root',
];
/** 精简入口：site-css.js §siteScss 里 `@import` 之前那段原样（同一批变量覆盖），`@import` 换成只编到 `:root` 那几份。 */
function reducedCss(p) {
  const full = siteCss.siteScss(p);
  const at = full.indexOf('@import "@webpixels/css/all";');
  if (at < 0) die('site-css.js §siteScss 里找不到 `@import "@webpixels/css/all";` 了 —— 精简入口要跟着改');
  const src = full.slice(0, at) + REDUCED_IMPORTS.map((i) => `@import "${i}";`).join('\n');
  return sass.compileString(src, {
    loadPaths: [path.join(NEXT, 'node_modules')], sourceMap: false, quietDeps: true,
    silenceDeprecations: ['import'], logger: sass.Logger.silent,
  }).css;
}

const at = (hex, h) => (h ? shiftHue(hex, h) : hex);
const HUES = C.hueSteps();
const PAL = Object.entries(PALETTES).map(([name, v]) => [name, v.colors.primary['500']]);
const THEMES = Object.entries(POOL).map(([id, v]) => [id, v.colors.primary['500']]);

// ── 判 ───────────────────────────────────────────────────────────────────────────────────────────
const bytes = (v) => nums(v).slice(0, 3).map((x) => Math.round(x));
const WHITE = [255, 255, 255];
const painted = (fg, bg) => C.contrast(C.mixBytes(fg, bg, C.PAINT_BLEND), bg);
/** `brand` 底上的白字（`contrast.js:105` 画成 `var(--x-primary)`；字 = `site-css.js` §DEEP_COMMON 的 `color: #fff`）。 */
const brandWhite = (idx) => painted(WHITE, bytes(idx.get(famKey(LIGHT, '--x-primary-rgb'))));
/** eyebrow pill：字 `text-primary` = rgba(var(--x-primary-rgb), 1)，底 `bg-primary-subtle` = var(--x-primary-bg-subtle)。 */
const pill = (idx) => painted(bytes(idx.get(famKey(LIGHT, '--x-primary-rgb'))), bytes(idx.get(famKey(LIGHT, '--x-primary-bg-subtle'))));

(async () => {
  console.log('① 锚点：完整编 + purge 的 site.css 里，§RULES 每一条都逐值相同');
  const ANCHORS = [
    ['azure-29 原色', POOL['azure-29'] && POOL['azure-29'].colors.primary['500']],
    ['ember-12 原色', POOL['ember-12'] && POOL['ember-12'].colors.primary['500']],
    ['burgundy', PALETTES.burgundy.colors.primary['500']],
    ['violet 色相 −15', at(PALETTES.violet.colors.primary['500'], -15)],
  ];
  if (ANCHORS.some(([, p]) => !p)) die(`锚点主色取不到：${JSON.stringify(ANCHORS)}（theme-pool.json 换过主题了？）`);
  const full = new Map();
  for (const [name, p] of ANCHORS) {
    const idx = indexCss(await fullCss(p));
    full.set(name, idx);
    const miss = familyMismatches(p, idx);
    check(miss.length === 0, `${name}（${p}）：${F.RULES.length} 条全对`, miss.slice(0, 4).join(' · '));
  }

  console.log('\n② 覆盖：跟着主色走的每一条声明，要么预览盖它，要么在 PREVIEW_SKIP 里写着理由');
  // 只在 site.css 里出现、预览不用盖的那些：同一个选择器后面还有一条规则（`site-css.js` §BTN_PRIMARY_INK /
  // §BTN_OUTLINE_HOVER_INK，同特异度、排在后面）把它换成了 `var(--btn-primary-*)`，而预览改的 `--color-primary-*`
  // 经那座桥已经跟上了。那两条规则自己的兜底值（`var(--btn-primary-bg, #主色)` 逗号后面那半）也算在这里：
  // `theme.css` 每个站都写 `--btn-primary-*`（derive-site.js §#1084），兜底不会被用到。
  const BRIDGED = '§BTN_PRIMARY_INK / §BTN_OUTLINE_HOVER_INK 用 var(--btn-primary-*) 盖掉了，预览经老链那座桥跟上';
  const PREVIEW_SKIP = Object.fromEntries([
    ...['bg', 'border-color', 'hover-bg', 'hover-border-color', 'active-bg', 'active-border-color', 'disabled-bg', 'disabled-border-color']
      .map((k) => [`.btn-primary|--x-btn-${k}`, BRIDGED]),
    ...['hover-bg', 'hover-border-color', 'active-bg', 'active-border-color']
      .map((k) => [`.btn-outline-primary|--x-btn-${k}`, BRIDGED]),
  ]);
  const fam = new Set(F.RULES.map(([sel, prop]) => famKey(sel, prop)));
  const list = (css) => { const out = []; postcss.parse(css).walkDecls((d) => out.push([d.parent.selector || d.parent.params, d.prop, d.value])); return out; };
  const a = list(await fullCss(ANCHORS[0][1])); const b = list(await fullCss(ANCHORS[2][1]));
  if (a.length !== b.length) die(`两份 site.css 声明条数不同（${a.length} / ${b.length}）—— 逐条 diff 的前提不在了`);
  const moving = new Set(); const uncovered = new Set();
  a.forEach((x, i) => {
    if (x[2] === b[i][2]) return;
    const k = famKey(x[0], x[1]); moving.add(k);
    if (!fam.has(k) && !PREVIEW_SKIP[k]) uncovered.add(`${k} = ${x[2]}`);
  });
  check(moving.size > 0, `两份主色的 site.css 里跟着主色走的声明 ${moving.size} 种（不是 0 ⟹ diff 真在比）`);
  check(uncovered.size === 0, '没有一条落在两张名单之外', [...uncovered].join(' · '));
  const stale = Object.keys(PREVIEW_SKIP).filter((k) => !moving.has(k));
  check(stale.length === 0, 'PREVIEW_SKIP 里每一条今天真的跟着主色走（没有过期的）', stale.join(' · '));
  const famStale = [...fam].filter((k) => !moving.has(k));
  check(famStale.length === 0, '§RULES 里每一条今天真的跟着主色走（没有多写的）', famStale.join(' · '));

  console.log('\n③ 网格：精简入口逐值 = 完整 site.css（锚点上），再扫 6 套配色 × 31 档 + 池里主题 × 31 档');
  {
    const miss = [];
    for (const [name, p] of ANCHORS) {
      const r = indexCss(reducedCss(p)); const f = full.get(name);
      for (const [sel, prop] of F.RULES) {
        if (sel !== LIGHT && sel !== DARK) continue;
        if (!same(r.get(famKey(sel, prop)), f.get(famKey(sel, prop)))) miss.push(`${name} ${prop}`);
      }
    }
    check(miss.length === 0, `精简入口在 ${ANCHORS.length} 个锚点上跟完整 site.css 的 :root 明暗两份逐值相同`, miss.join(' · '));
  }
  const grid = new Map(); // 主色 → 精简入口的 idx
  const t0 = Date.now();
  const gridMiss = [];
  for (const [name, hex] of [...PAL, ...THEMES]) {
    for (const h of HUES) {
      const p = at(hex, h);
      if (grid.has(p)) continue;
      const idx = indexCss(reducedCss(p));
      grid.set(p, idx);
      const m = familyMismatches(p, idx, [LIGHT, DARK]);
      if (m.length) gridMiss.push(`${name}@${h}（${p}）${m[0]}`);
    }
  }
  check(gridMiss.length === 0,
    `${grid.size} 个主色（${PAL.length} 套配色 + ${THEMES.length} 套池里主题，各 × ${HUES.length} 档色相）的 :root 明暗两份逐值相同（${Date.now() - t0} ms）`,
    gridMiss.slice(0, 4).join(' · '));

  console.log('\n④ AC3 字能不能看清（值全从 Sass 输出读）');
  // 对照：一个浅蓝主色，两条判断都必须判不过
  const CONTROL = '#60a5fa';
  const ctl = indexCss(reducedCss(CONTROL));
  {
    let worst = null;
    for (const [name, hex] of PAL) for (const h of HUES) {
      const r = brandWhite(grid.get(at(hex, h)));
      if (!worst || r < worst.r) worst = { r, name, h };
    }
    check(worst.r >= C.MIN_CONTRAST, `3a brand 底白字：${PAL.length} 套配色 × ${HUES.length} 档最低 ${worst.r.toFixed(3)}（${worst.name} @${worst.h}）≥ ${C.MIN_CONTRAST}`);
    const c = brandWhite(ctl);
    check(c < C.MIN_CONTRAST, `3a 对照：主色换成 ${CONTROL} ⟹ ${c.toFixed(3)} < ${C.MIN_CONTRAST}，同一个判断判不过`);
  }
  {
    let worst = null;
    for (const [name, hex] of PAL) for (const h of HUES) {
      const r = pill(grid.get(at(hex, h)));
      if (!worst || r < worst.r) worst = { r, name, h };
    }
    for (const [id, hex] of THEMES) {
      const name = `${id} 原色`;
      const base = full.has(name) ? pill(full.get(name)) : pill(indexCss(await fullCss(hex)));
      check(worst.r >= base, `3b pill：配色 × 色相最低 ${worst.r.toFixed(3)}（${worst.name} @${worst.h}）≥ ${id} 原色色相 0 那一档 ${base.toFixed(3)}`);
      const c = pill(ctl);
      check(c < base, `3b 对照（${id}）：主色换成 ${CONTROL} ⟹ ${c.toFixed(3)} < ${base.toFixed(3)}，同一个判断判不过`);
    }
  }

  console.log('\n⑤ effectivePrimary500：取 custom.css 里最后一条 primary-500，没有就原样回 brand 的值');
  check(F.effectivePrimary500('#4A6FB5', '') === '#4A6FB5', '没有 → brand 的值原样（不归一化，AC2 要喂给 Sass 的字节不变）');
  check(F.effectivePrimary500('#4a6fb5', ':root { --color-primary-500: #8c1d3f; --color-primary-600: #701632; }') === '#8c1d3f', '有 → 用它');
  check(F.effectivePrimary500('#4a6fb5', ':root{--color-primary-500:#111111}\n:root{--color-primary-500:#222222}') === '#222222', '两条 → 后面那条（层叠里后来的赢）');
  check(F.effectivePrimary500('#4a6fb5', ':root { --color-primary-5000: #8c1d3f; --color-primary-500: var(--x); }') === '#4a6fb5', '不是 500 那一档 / 不是 hex 字面值 → 不认');
  check(F.primaryFamilyCss('rgb(1,2,3)') === '' && F.primaryFamilyCss(undefined) === '', '认不出的主色 → 空串（预览不画半套）');

  console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => die(e && e.stack || String(e)));
