'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// contrast.js —— 一块底色上的字该深还是该白（#1463，hero-new 的 `bg` 颜色槽）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 字色不给用户配，按背景亮度自动算（Chris 2026-09-27 定稿）：相对亮度 < 0.4 反白，否则深字。
// `brand`（主题主色）不是一个十六进制值 —— 渲染时它是 `var(--x-primary)`，服务端算不出它的亮度；
// 定稿写的是「`brand` 时主按钮翻成白底主色字」，也就是按深底处理（图册 `opt-on-brand` 同时挂 `opt-on-dark`）。
//
// 🔴 **一处实现，两个读者**：`blocks/hero-new/Section.tsx`（渲染）和编辑器的色板预览
//    （`src/components/editor/EditorApp.tsx`）。两边各算一遍的话，分歧那天两边都不会红。
// 🔴 校验（这个值合不合法）也在这里：`block-manifest.js` §validateSite 调 `isColorValue`，
//    编辑器的取色器存盘前调 `normalizeColor` —— 同一条正则。

/** 相对亮度的门槛：低于它就是「深底」，字反白。 */
const DARK_BELOW = 0.4;

/** 主题主色的写法。 */
const BRAND = 'brand';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** 合法的颜色槽取值：`#rrggbb`（大小写都收）或 `brand`。 */
function isColorValue(v) {
  return v === BRAND || (typeof v === 'string' && HEX_RE.test(v));
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

module.exports = { DARK_BELOW, BRAND, isColorValue, normalizeColor, relativeLuminance, toneFor };
