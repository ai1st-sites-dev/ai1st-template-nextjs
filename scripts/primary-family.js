// primary-family.js — 一个主色在 `public/site.css` 里派生出来的那一族值（#1697）。
//
// 🔴 改这份文件——哪怕只改注释——交付前要真跑一次 `cd dashboard && npm run build`：`dashboard/vite.config.ts`
//    的 ai1st-tweaks-engine 插件把本文件整份文本送进浏览器，并用两条正则扫 CommonJS 的引入语句（理由见
//    `tweaks.js` 文件头）。本文件一条引入都没有，注释里也别写出那个语句的字面形状。
//
// ── 为什么有它 ───────────────────────────────────────────────────────────────────────────────────
// 站里有两条颜色链（#1580）：老链 `--color-primary-*` 在 theme.css / custom.css；新链 `--x-primary` 一族由 Sass 从
// `$primary` 派生、编进 site.css（`scripts/lib/site-css.js`）。配色方案和色相滑块只写老链，所以 #1697 之前新链永远是
// 主题原色。修法分两半：
//   · Apply：`derive-site.js` 先算出这个站实际该用的主色（§effectivePrimary500），再拿它当 `$primary` 编 site.css ——
//     派生全交给 Sass，这里一个值都不参与。
//   · Customize 悬停试色：浏览器里跑不了 Sass，CustomizeModal 把 §primaryFamilyCss 追加在注入的 custom.css 文本后面。
//     这里的公式是 Bootstrap 5.3 / Webpixels 3 派生这几个值的那几条（跟白 / 黑按固定比例混色），**一致性不靠抄对，
//     靠测试**：`scripts/primary-family.test.js` 拿 Sass 真编出来的 site.css 逐个值对账（6 套配色 × 31 档色相 ×
//     池里主题），并且把两份主色编出来的 site.css 逐条 diff —— 凡是跟着主色走的声明，要么在下面 §RULES 里，要么在那份
//     测试的「预览不盖」名单里写着理由，第三种它判红。Webpixels 升级多派生出一条，那份测试先红。
//
// 🔴 选择器照抄 site.css 里那几条规则的写法：`:root,[data-bs-theme=light]` 也命中块根上挂了 `data-bs-theme="light"`
//    的嵌套块（`contrast.js` §bsThemeForBg）—— 只写 `:root` 的话，那些块会从 site.css 里重新拿到旧主色。

'use strict';

/** `#rgb` / `#rrggbb` → `#rrggbb`（小写）；别的形状回 null（跟 site-css.js §primaryOf 认的一样，不认带 alpha 的）。 */
function normHex(h) {
  const s = String(h == null ? '' : h).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * 这个站实际该用的主色：`cssText`（这次算出来的 custom.css）里最后一条 `--color-primary-500` —— 配色方案和色相滑块
 * 都写它，而 custom.css 排在 theme.css 之后（`layout.tsx` 的 `<link>` 次序），最后一条就是浏览器最后用的那个；
 * 没有这一条 ⟹ `baseHex`（brand.json 的 primary-500）。
 * 🔴 没有就回 `baseHex` 原样（不归一化）：「没有配色、色相为 0」那条路必须跟 #1697 之前喂给 Sass 的字节一模一样（AC2）。
 */
function effectivePrimary500(baseHex, cssText) {
  let last = null;
  for (const m of String(cssText || '').matchAll(/--color-primary-500\s*:\s*(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)\s*(?:;|})/g)) last = m[1];
  return last === null ? baseHex : last;
}

// ── 派生 ─────────────────────────────────────────────────────────────────────────────────────────
// Sass 的 mix($a, $b, $w) = $a·w + $b·(1−w)，逐通道、不取整（site.css 里印的就是 `rgb(218.8, …)` 这种小数）。
// tint-color = 跟白混，shade-color = 跟黑混。`*-rgb` 那几个是 Sass 的 to-rgb：逐通道四舍五入成整数。
const mix = (c, k, w) => c.map((v) => k * w + v * (1 - w));
const tint = (c, w) => mix(c, 255, w);
const shade = (c, w) => mix(c, 0, w);
// Sass 的取整带一个极小的容差（fuzzy round）：x.5 往上。浮点里 62.5 可能算成 62.49999999，所以先补一个远小于
// 小数点后第十位的量再取整。
const round = (v) => Math.round(v + 1e-9);
const num = (v) => String(Math.round(v * 1e10) / 1e10);
const rgbFn = (c) => `rgb(${c.map(num).join(', ')})`;
const triplet = (c) => c.map(round).join(', ');
const rgbaFn = (c, a) => `rgba(${c.map(round).join(', ')}, ${a})`;

/**
 * 跟着主色走、预览要盖的那几条：`[选择器, 属性, (主色 rgb, 主色 hex) => 值]`。顺序 = site.css 里的出现顺序。
 * 每一条的来历（Bootstrap 5.3 `_variables.scss` / `_variables-dark.scss` / `_buttons.scss`，Webpixels 3 `_root.scss` / extras）：
 *   亮色 text-emphasis = shade 60% · bg-subtle = tint 80% · border-subtle = tint 60% · link-hover = shade 15%（Webpixels `_variables.scss` 直接写 `shade-color($link-color, 15%)`，不是 Bootstrap 默认的 20% —— 对账第一次跑就抓到的）
 *   暗色 text-emphasis = tint 40% · bg-subtle = shade 80% · border-subtle = shade 40% · link = 暗色 text-emphasis、link-hover 再 tint 20%
 *   按钮 focus 阴影 = to-rgb(mix(白, 主色, 15%))；描边按钮的 focus 阴影 = 主色本身
 */
const LIGHT = ':root,\n[data-bs-theme=light]';
const DARK = '[data-bs-theme=dark]';
const RULES = [
  [LIGHT, '--x-primary', (c, hex) => hex],
  [LIGHT, '--x-primary-rgb', (c) => triplet(c)],
  [LIGHT, '--x-primary-text-emphasis', (c) => rgbFn(shade(c, 0.6))],
  [LIGHT, '--x-primary-bg-subtle', (c) => rgbFn(tint(c, 0.8))],
  [LIGHT, '--x-primary-border-subtle', (c) => rgbFn(tint(c, 0.6))],
  [LIGHT, '--x-link-color', (c, hex) => hex],
  [LIGHT, '--x-link-color-rgb', (c) => triplet(c)],
  [LIGHT, '--x-link-hover-color', (c) => rgbFn(shade(c, 0.15))],
  [LIGHT, '--x-link-hover-color-rgb', (c) => triplet(shade(c, 0.15))],
  [DARK, '--x-primary-text-emphasis', (c) => rgbFn(tint(c, 0.4))],
  [DARK, '--x-primary-bg-subtle', (c) => rgbFn(shade(c, 0.8))],
  [DARK, '--x-primary-border-subtle', (c) => rgbFn(shade(c, 0.4))],
  [DARK, '--x-link-color', (c) => rgbFn(tint(c, 0.4))],
  [DARK, '--x-link-hover-color', (c) => rgbFn(tint(tint(c, 0.4), 0.2))],
  [DARK, '--x-link-color-rgb', (c) => triplet(tint(c, 0.4))],
  [DARK, '--x-link-hover-color-rgb', (c) => triplet(tint(tint(c, 0.4), 0.2))],
  ['.btn-primary', '--x-btn-focus-shadow-rgb', (c) => triplet(tint(c, 0.15))],
  ['.btn-outline-primary', '--x-btn-color', (c, hex) => hex],
  ['.btn-outline-primary', '--x-btn-border-color', (c, hex) => hex],
  ['.btn-outline-primary', '--x-btn-focus-shadow-rgb', (c) => triplet(c)],
  ['.btn-outline-primary', '--x-btn-disabled-color', (c, hex) => hex],
  ['.btn-outline-primary', '--x-btn-disabled-border-color', (c, hex) => hex],
  ['.btn-link', '--x-btn-focus-shadow-rgb', (c) => triplet(tint(c, 0.15))],
  ['.article a,\n.prose a', 'color', (c, hex) => hex],
  ['.article a,\n.prose a', 'text-decoration-color', (c) => rgbaFn(c, 0.3)],
  ['.article a:hover,\n.prose a:hover', 'color', (c) => rgbFn(shade(c, 0.15))],
];

/** 主色 → `[[选择器, [[属性, 值], …]], …]`（同一个选择器的几条并成一组，组的顺序 = 第一次出现的顺序）。认不出的主色回 []。 */
function primaryFamily(primary) {
  const hex = normHex(primary);
  if (!hex) return [];
  const c = rgbOf(hex);
  const groups = new Map();
  for (const [sel, prop, fn] of RULES) {
    if (!groups.has(sel)) groups.set(sel, []);
    groups.get(sel).push([prop, fn(c, hex)]);
  }
  return [...groups.entries()];
}

/** 主色 → 一段 CSS 文本（预览追加在注入的 custom.css 后面）。认不出的主色回空串。 */
function primaryFamilyCss(primary) {
  return primaryFamily(primary)
    .map(([sel, decls]) => `${sel} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}\n`)
    .join('');
}

module.exports = { normHex, effectivePrimary500, primaryFamily, primaryFamilyCss, RULES };
