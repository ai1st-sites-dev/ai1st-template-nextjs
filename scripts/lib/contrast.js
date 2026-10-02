'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// contrast.js —— 一块底色上的字该深还是该白（#1463，hero-new 的 `bg` 颜色槽）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 字色不给用户配，按背景亮度自动算（Chris 2026-09-27 定稿）：相对亮度 < 0.4 反白，否则深字。
// `brand`（主题主色）不是一个十六进制值 —— 渲染时它是 `var(--x-primary)`，服务端算不出它的亮度；
// 定稿写的是「`brand` 时主按钮翻成白底主色字」，也就是按深底处理（图册 `opt-on-brand` 同时挂 `opt-on-dark`）。
//
// 🔴 **一处实现，多个读者**：各块的 `Section.tsx`（渲染）和色板（`src/components/BgPicker.tsx`，编辑器 / 单格页 /
//    admin 共用）。各算一遍的话，分歧那天哪边都不会红。
// 🔴 校验（这个值合不合法）也在这里：`block-manifest.js` §validateSite 调 `isColorValue`，
//    编辑器的取色器存盘前调 `normalizeColor` —— 同一条正则。
//
// #1469 —— **颜色槽也可以是渐变**（Chris 2026-09-28：Webpixels 的渐变底是 CSS 变量拼的 `linear-gradient`，不是图）：
//    值 = `#rrggbb` | `brand` | `{ stops: [2–3 个 #rrggbb], angle }`，渲染成 `linear-gradient(angle, stops)`。
//    字色按**色标平均亮度**判，门槛 0.55（比纯色的 0.4 高 = 偏向反白：紫→金那种渐变两头一深一浅，按 0.4 会判成浅底）。
//    渐变认得的只有 `*Bg` 这一组（`normalizeBg` / `toneForBg` / `bgCss` / `bgFromParam`）；`normalizeColor` / `toneFor`
//    原样不动（纯色那一半）。#1477 起四个带 `bg` 槽的块、单格页两条工具条、编辑器、admin 读的全是 `*Bg` 这一组。
//    `isColorValue`（validateSite 的判据）认渐变：`SLOT_KINDS` 的 `color` 就是这一种，校验不按块分。

/** 相对亮度的门槛：低于它就是「深底」，字反白。 */
const DARK_BELOW = 0.4;

/** 主题主色的写法。 */
const BRAND = 'brand';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** 渐变底：色标平均亮度低于它就是「深底」（#1469）。 */
const GRADIENT_DARK_BELOW = 0.55;

/** 渐变没写角度时用它（图册的三档预设渐变都是 135deg）。 */
const GRADIENT_ANGLE = 135;

/** 编辑器色板上的三档预设渐变（图册 `build.py` 的 `g:` 那三格，原样）。 */
const GRADIENT_SWATCHES = [
  { stops: ['#7d52f4', '#f7b733'], angle: GRADIENT_ANGLE },
  { stops: ['#0ea5e9', '#6366f1'], angle: GRADIENT_ANGLE },
  { stops: ['#0f172a', '#334155'], angle: GRADIENT_ANGLE },
];

/** 归一渐变：2–3 个 `#rrggbb` 色标（小写）+ 角度（0–360 的有限数，没写 = 135）；不合法回 null。 */
function normalizeGradient(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.stops)) return null;
  if (v.stops.length < 2 || v.stops.length > 3) return null;
  const stops = v.stops.map((c) => (typeof c === 'string' && HEX_RE.test(c.trim()) ? c.trim().toLowerCase() : null));
  if (stops.includes(null)) return null;
  const angle = v.angle === undefined ? GRADIENT_ANGLE : v.angle;
  if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < 0 || angle > 360) return null;
  return { stops, angle };
}

/** 合法的颜色槽取值：`#rrggbb`（大小写都收）、`brand`，或渐变 `{ stops, angle }`（#1469）。 */
function isColorValue(v) {
  return v === BRAND || (typeof v === 'string' && HEX_RE.test(v)) || normalizeGradient(v) !== null;
}

/** 归一成存盘的形状：十六进制一律小写；不合法回 null。 */
function normalizeColor(v) {
  if (v === BRAND) return BRAND;
  if (typeof v !== 'string' || !HEX_RE.test(v.trim())) return null;
  return v.trim().toLowerCase();
}

/** WCAG 相对亮度（0 = 黑，1 = 白）。只收 `#rrggbb`，别的回 null。 */
function relativeLuminance(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return null;
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * 这块底色上用哪套字色：
 *   'light' —— 浅底，深字（也是没填 / 填错时的默认：不改变块本来的样子）
 *   'dark'  —— 深底，字反白
 *   'brand' —— 主题主色底：字反白，主按钮翻成白底主色字
 */
function toneFor(bg) {
  if (bg === BRAND) return 'brand';
  const l = relativeLuminance(typeof bg === 'string' ? bg.trim() : bg);
  if (l === null) return 'light';
  return l < DARK_BELOW ? 'dark' : 'light';
}

/** 颜色槽的值（纯色或渐变）归一成存盘的形状；不合法回 null。 */
function normalizeBg(v) {
  return typeof v === 'object' && v !== null ? normalizeGradient(v) : normalizeColor(v);
}

/** 纯色或渐变都认的字色判据：渐变按色标平均亮度 < 0.55 反白，别的交给 §toneFor。 */
function toneForBg(bg) {
  const g = typeof bg === 'object' && bg !== null ? normalizeGradient(bg) : null;
  if (!g) return toneFor(bg);
  const avg = g.stops.reduce((a, c) => a + relativeLuminance(c), 0) / g.stops.length;
  return avg < GRADIENT_DARK_BELOW ? 'dark' : 'light';
}

/** 这块底色写成 CSS `background` 的值：`brand` → 主题主色变量、渐变 → `linear-gradient(…)`；没填 / 不合法回 null。 */
function bgCss(bg) {
  const v = normalizeBg(bg);
  if (!v) return null;
  if (v === BRAND) return 'var(--x-primary)';
  if (typeof v === 'string') return v;
  return `linear-gradient(${v.angle}deg,${v.stops.join(',')})`;
}

/**
 * #1472 —— 块根上的 `data-bs-theme`：站级深浅（`<html data-bs-theme>`）跟块的 `bg` 正交。
 *   填了 `bg`（纯色 / brand / 渐变，合法的）或者图铺底（`cover`）⟹ `'light'`：块按自己的底色画，把里面的 Webpixels 变量拉回
 *     light —— 跟改前（站只有浅色）逐字相同。深底 / brand 那几档也拉回：它们的 `data-tone` 规则是照着 light 变量写的
 *     （例 contact-new 深底上「表单卡保持白底、字回深色」，卡底读 `--x-body-bg`），放进深色变量里就白底变黑底、深字压黑。
 *   没填 ⟹ `undefined`（不挂）：块跟站走，深浅由浏览器按 `<html>` 上那一个属性换。
 * 🔴 17 个用 `toneForBg` 的块都调它，不各写一份（正文做什么 4）。
 */
function bsThemeForBg(bg, cover = false) {
  return cover || normalizeBg(bg) !== null ? 'light' : undefined;
}

/**
 * 地址栏 `?bg=` 的写法 → 颜色槽的值：`%230f172a` / `brand` 原样，渐变写成 JSON（`?bg={"stops":[…],"angle":135}`）。
 * 单格页两条路（旋钮页面块 / 外壳块）都走它，不各写一份解析。
 */
function bgFromParam(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t.startsWith('{')) return normalizeColor(t);
  try { return normalizeGradient(JSON.parse(t)); } catch { return null; }
}

module.exports = {
  DARK_BELOW, BRAND, isColorValue, normalizeColor, relativeLuminance, toneFor,
  GRADIENT_DARK_BELOW, GRADIENT_ANGLE, GRADIENT_SWATCHES, normalizeGradient, normalizeBg, toneForBg, bgCss, bgFromParam, bsThemeForBg,
};
