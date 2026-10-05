#!/usr/bin/env node
/**
 * outline-hover-ink.test.js — 描边主按钮 hover / 按下态的字压底，全部配色都过线（#1590 AC2）。
 *
 *   node scripts/lib/outline-hover-ink.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * Webpixels 编出来的 `.btn-outline-primary` 把 hover / 按下态写死成白字压 `$primary`（primary-500）。ember-12 的 500
 * 白字 blended 4.226，浏览器实测 4.37（#1581）。修法是 `site-css.js` §BTN_OUTLINE_HOVER_INK 一条全站规则，把这两态
 * 接到主按钮静止态那一对（`--btn-primary-bg` / `--btn-primary-ink`）。那一对 `button-ink.js` 按构造就挑过线的一档
 * ⟹ 这一格守的是「hover 真的接在这一对上」，算术本身是 `button-ink.test.js` 的事。
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 * 不写死变量名：真编一份 site.css（`compileSiteCss`），在里面找**生效**的那条 —— 选择器恰好是 `.btn-outline-primary`
 * 的顶层规则里、最后一条声明了该变量的（特异度都是 0-1-0，靠源码次序决胜）。值是 `var(--名, 兜底)` 就按那套配色的
 * `buttonInkVars` 解出来；是字面量就按字面量（编译用的哨兵主色 = 那套配色的 primary-500，也就是改前的样子）。
 * 然后对 `themes` + `retiredThemes` 全部配色算 hover / 按下态两对的 blended 对比度（`button-ink.js` §ratio）。
 *   ① 生效的那条是 var() 引用（规则被删 / 被别的规则盖掉 ⟹ 红）
 *   ② 全部配色两对都 ≥ 4.5
 *   ③ 阳性对照：把 §BTN_OUTLINE_HOVER_INK 从 scss 里拿掉再编一次，同一把尺必须读出 ① 红、② 至少一套不过线 ——
 *      尺子自己咬得住，不是恒绿
 *
 * 📌 量不到的（说在明处）：
 *    · 深底块（`DEEP_COMMON`）上描边按钮的字是 `#fff !important`、深色站那条（§SCHEME_SURFACES）带 `[data-bs-theme=dark]`
 *      —— 选择器不是裸 `.btn-outline-primary`，不在射程（#1590「不做」第 2 条）；
 *    · 块 `block.css` 里的规则不在 site.css 里 —— 票面现取过 10 个块的描边规则块里 hover 变量 0 条，这里不再量。
 */

'use strict';

const ink = require('./button-ink.js');
const siteCss = require('./site-css.js');
const { themes, retiredThemes } = require('../themes.js');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };

const MIN = 4.5;
const SENTINEL = '#123456';            // 编译用的 $primary —— 字面量里出现它 ⟹ 指的是 primary-500
const PAIRS = [
  { state: 'hover', bg: '--x-btn-hover-bg', fg: '--x-btn-hover-color' },
  { state: 'active', bg: '--x-btn-active-bg', fg: '--x-btn-active-color' },
];

/** 编出来的 CSS 里，选择器恰好是 `.btn-outline-primary` 的顶层规则，最后一条声明了 prop 的那个值。 */
function winningValue(css, prop) {
  let val = null;
  const re = /(^|\})\s*([^{}@]+?)\s*\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[2].trim() !== '.btn-outline-primary') continue;
    for (const d of m[3].split(';')) {
      const i = d.indexOf(':');
      if (i > 0 && d.slice(0, i).trim() === prop) val = d.slice(i + 1).trim();
    }
  }
  return val;
}

/** `var(--名, 兜底)` → { name, fallback }；字面量 → { literal } */
function parse(value) {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value);
  return m ? { name: m[1], fallback: m[2] && m[2].trim() } : { literal: value };
}

/** 这套配色下，这个值最终画成什么颜色。 */
function resolve(value, palette, vars) {
  const p = parse(value);
  const lit = (v) => (v.toLowerCase() === SENTINEL ? palette['500'] : v);
  if (p.literal) return lit(p.literal);
  let v = vars[p.name];
  if (v === undefined) return p.fallback ? lit(p.fallback) : null;
  for (let i = 0; i < 5 && /^var\(/.test(v); i += 1) {      // --btn-primary-bg: var(--color-primary-600)
    const q = parse(v);
    v = vars[q.name] !== undefined ? vars[q.name] : q.fallback;
  }
  return v;
}

function themeVars(palette) {
  const vars = {};
  for (const [k, v] of Object.entries(palette)) vars[`--color-primary-${k}`] = v;
  for (const line of ink.buttonInkVars(palette)) {
    const m = /^(--[\w-]+):\s*(.+);$/.exec(line);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const palettes = [];
for (const [id, t] of Object.entries(themes)) if (t.colors && t.colors.primary) palettes.push({ id, set: 'themes', p: t.colors.primary });
for (const [id, t] of Object.entries(retiredThemes)) if (t.colors && t.colors.primary) palettes.push({ id, set: 'retiredThemes', p: t.colors.primary });

/** 一份 CSS 量一遍：回 { refs, under, worst, n } */
function measure(css) {
  const decl = {};
  for (const pr of PAIRS) for (const k of ['bg', 'fg']) decl[pr[k]] = winningValue(css, pr[k]);
  const refs = Object.entries(decl).filter(([, v]) => v && !parse(v).literal).map(([k]) => k);
  const under = [];
  const worst = {};
  for (const { id, set, p } of palettes) {
    const vars = themeVars(p);
    for (const pr of PAIRS) {
      const bg = resolve(decl[pr.bg], p, vars);
      const fg = resolve(decl[pr.fg], p, vars);
      const r = ink.ratio(fg, bg);
      const key = `${set} ${pr.state}`;
      if (!worst[key] || r < worst[key].r) worst[key] = { r, id, fg, bg };
      if (!(r >= MIN)) under.push(`${set}/${id} ${pr.state} ${fg} 压 ${bg} = ${r.toFixed(3)}`);
    }
  }
  return { decl, refs, under, worst };
}

function compileWithout(rule) {
  // eslint-disable-next-line global-require
  const sass = require('sass');
  const path = require('path');
  const scss = siteCss.siteScss(SENTINEL);
  if (!scss.includes(rule)) return null;
  return sass.compileString(scss.replace(rule, ''), {
    loadPaths: [path.resolve(__dirname, '..', '..', 'node_modules')],
    sourceMap: false, quietDeps: true, silenceDeprecations: ['import'], logger: sass.Logger.silent,   // 同 compileSiteCss
  }).css;
}

let css; let ctrlCss;
try {
  css = siteCss.compileSiteCss(SENTINEL);
  ctrlCss = compileWithout(siteCss.BTN_OUTLINE_HOVER_INK || '\u0000');
} catch (e) {
  console.log(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}
if (palettes.length === 0) { console.log('🔴 跑不起来：themes / retiredThemes 里一套配色都没读到'); process.exit(2); }

const live = measure(css);
const nT = palettes.filter((x) => x.set === 'themes').length;
const nR = palettes.length - nT;

console.log('① 生效的那条 `.btn-outline-primary`：hover / 按下态的底和字都是 var() 引用（接在算好的那一对上）');
for (const [k, v] of Object.entries(live.decl)) console.log(`     ${k}: ${v}`);
if (live.refs.length === 4) ok('4 个变量都是 var() 引用');
else bad(`只有 ${live.refs.length}/4 个是 var() 引用 —— §BTN_OUTLINE_HOVER_INK 被删了，或被后面一条同选择器的规则盖掉了`);

console.log(`② themes ${nT} 套 + retiredThemes ${nR} 套 × hover / 按下态：字压底 blended ≥ ${MIN}`);
for (const [k, w] of Object.entries(live.worst)) console.log(`     最差 ${k}: ${w.id} ${w.fg} 压 ${w.bg} = ${w.r.toFixed(3)}`);
if (live.under.length) bad(`${live.under.length} 格不过线：${live.under.slice(0, 8).join(' · ')}`);
else ok(`${palettes.length} 套 × 2 态，全部 ≥ ${MIN}`);

console.log('③ 阳性对照：拿掉 §BTN_OUTLINE_HOVER_INK 再编一次，同一把尺必须读红');
if (!ctrlCss) bad('site-css.js 没导出 BTN_OUTLINE_HOVER_INK，或 siteScss 里找不到它的原文 —— 对照造不出来');
else {
  const c = measure(ctrlCss);
  const t = c.under.filter((u) => u.startsWith('themes/'));
  console.log(`     拿掉后：var() 引用 ${c.refs.length}/4 · 不过线 ${c.under.length} 格（themes ${t.length}）${t.length ? ` —— ${t.join(' · ')}` : ''}`);
  if (c.refs.length === 4) bad('拿掉那条规则后 ① 仍然读绿 —— ① 量的不是那条规则');
  else if (c.under.length === 0) bad('拿掉那条规则后 ② 一格不过线都读不出来 —— ② 咬不住改前的样子');
  else ok('拿掉后 ① ② 都红（尺子咬得住）');
}

console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
