#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// palette.js — 一套候选的调色板：色相 → 十档色阶，以及算对比度的那几个函数（#1051 r4）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 为什么这些东西住在自己一个文件里。它们本来全在 `generate.js`，而 `sheet-recipes.js` 出的那份表
//    要**按这套候选真实的颜色**挑字色（r4 修的那件事：候选自己把电话/邮箱画成 1.6–1.9:1）。
//    `generate.js` 已经 require 了 `sheet-recipes.js`，反过来再 require 就成环 —— 而「两处各算一遍
//    同一件事」正是这个流水线出过事的地方（`heroLayoutFor` 那条注释写的就是它：分成两处算过一次
//    就会分叉，分叉的样子是「layout.json 说 text-only、CSS 画的却是两栏」，没有任何东西会为此报错）。
//    所以调色板只有**一个**定义，两边都从这里取。
//
//   const { paletteFor } = require('./palette.js');
//   paletteFor(0)        // { primary: {50..900}, accent: {50..600} }

// 色相 → 十档色阶。HSL 转 hex，饱和度和亮度曲线照抄注册表里既有主题的手感
// （50 很浅、500 是主色、900 很深），这样生成出来的调色板与人手写的那 30 套是同一类东西。
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const SHADES = { 50: 0.96, 100: 0.9, 200: 0.82, 300: 0.7, 400: 0.6, 500: 0.5, 600: 0.42, 700: 0.34, 800: 0.26, 900: 0.16 };

function relLuminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/** WCAG 的对比度：(亮 + 0.05) / (暗 + 0.05)，1..21。 */
function contrast(a, b) {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── 色阶要让【产品自己的按钮】读得出来 ──────────────────────────────────────────────────────────
//
// 🔴 一套主题不只是主题表说了算：`globals.css` 的 `.btn-primary` 是**白字压 `--color-primary-500`**、
//    `.btn-accent` 是 `gray-900` 的字压 `--color-accent-400`。这两个配色不是主题表画的，是产品画的
//    ——所以调色板只要选得不对，按钮上的字就读不出来，而主题表本身一行都没错。
//    实测（#1051 r3，`gen-07-2` 的 primary-500 是 `#59c639` 那种亮绿）：`/services.html` 上
//    `.btn-primary` 的白字对底色 **2.16:1**，运行时那道检查（#1050，下限 2.5:1）当场把整套候选拦下。
// 🔴 判据取 **4.5:1**（WCAG 正文门槛），不是 2.5:1 那个下限：2.5 是「还看得出是字」的地板，
//    而按钮上的字是要读的。留出余量之后，那道 2.5 的检查不会再因为调色板而红。
const WHITE = '#ffffff';
const GRAY900 = '#111827';   // globals.css 里 .btn-accent 的字色
const BTN_CONTRAST = 4.5;

/**
 * 这个色相/饱和度下，能让 `ink` 的字压上去仍有 `min` 对比度的最亮（或最暗）那个 L。
 * 二分 40 次，够到 1e-12 —— 亮度对 L 是单调的，所以二分是对的。
 * @param {'darker'|'lighter'} dir 往哪边找：白字要底色更暗，深色字要底色更亮。
 */
function lightnessBound(hue, sat, ink, min, dir) {
  let lo = 0; let hi = 1;
  for (let k = 0; k < 40; k += 1) {
    const mid = (lo + hi) / 2;
    const ok = contrast(ink, hslToHex(hue, sat, mid)) >= min;
    // darker：越暗越 ok，找【最大】的可行 L；lighter：越亮越 ok，找【最小】的可行 L
    if (dir === 'darker') { if (ok) lo = mid; else hi = mid; } else if (ok) hi = mid; else lo = mid;
  }
  return dir === 'darker' ? lo : hi;
}

/**
 * 把整条亮度曲线重新映射，让某一档落在 `target` 上，而两端（0 和 1）不动。
 * 分段线性：0→0 · anchor→target · 1→1。这样 `50` 仍然很浅、`900` 仍然很深，只有中间被拉过去
 * —— 直接整条乘一个系数会把 `50`（0.96）也拉暗，那就不是一条色阶了。
 */
function remap(l, anchor, target) {
  if (l <= anchor) return (l / anchor) * target;
  return target + ((l - anchor) / (1 - anchor)) * (1 - target);
}

function rampFor(hue, sat, keys) {
  // primary 走白字那条（`.btn-primary`），accent 走 gray-900 那条（`.btn-accent`）——
  // 靠 keys 的长度分辨：accent 只到 600（下面 paletteFor 的调用处），primary 是全十档。
  const isAccent = keys.length < 10;
  // 两边的锚点都是 500 档，但要求的方向相反：
  //   primary-500  白字压上去（`.btn-primary`）        ⟹ 它必须够【暗】
  //   accent-500   gray-900 压上去（`.btn-accent:hover`，静止态是 400，更亮）⟹ 它必须够【亮】
  // 取 accent 的 500 而不是 400，是因为暗的那一档过了，亮的那一档自然过。
  const anchor = SHADES[500];
  const bound = isAccent
    ? lightnessBound(hue, sat, GRAY900, BTN_CONTRAST, 'lighter')
    : lightnessBound(hue, sat, WHITE, BTN_CONTRAST, 'darker');
  // 只在不够时才动：够了就一个字节都不改，同一个 seed 出的表在这条改动前后对得上。
  const target = isAccent ? Math.max(anchor, bound) : Math.min(anchor, bound);
  const out = {};
  for (const k of keys) out[k] = hslToHex(hue, sat, remap(SHADES[k], anchor, target));
  return out;
}

const PRIMARY_KEYS = Object.keys(SHADES);
const ACCENT_KEYS = ['50', '100', '200', '300', '400', '500', '600'];

/**
 * 第 i 套候选的调色板。🔴 `generate.js`（写进 tokens）与 `sheet-recipes.js`（照它挑字色）
 * 都从这里取，只有这一个定义。
 */
function paletteFor(i, seed = 7) {
  // 🔴 色相走**黄金角**（137.5°），不是固定步长。原来是 `i * 113`：113 × 3 = 339 ≡ −21 (mod 360)
  // ⟹ 第 i 套与第 i+3 套的主色只差 21°，肉眼几乎同色。配上各档当时都是 `% 3`，第 i 套与第 i+3 套的
  // 字体、settings、版式**三项全等**，于是第三道相似度闸给出 0.970 并把两套都拦下。
  // 实测（#1051，`origin/main 84cbbea4`）：一批 6 套 **6/6 全被拦**，最高 0.973。
  // 黄金角的性质是任意连续若干项都尽量散开，不会在小周期上撞回来。
  const hue = (seed * 47 + i * 137.5) % 360;
  const accentHue = (hue + 150 + i * 53) % 360;
  return {
    primary: rampFor(hue, [0.42, 0.55, 0.68, 0.5][i % 4], PRIMARY_KEYS),
    accent: rampFor(accentHue, [0.6, 0.72, 0.52][i % 3], ACCENT_KEYS),
  };
}

module.exports = {
  paletteFor, rampFor, contrast, relLuminance, hslToHex, remap, lightnessBound,
  SHADES, PRIMARY_KEYS, ACCENT_KEYS, WHITE, GRAY900, BTN_CONTRAST,
};
