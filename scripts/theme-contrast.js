// theme-contrast.js — 不起浏览器，算出「主题表把哪种字放在哪种底色上」，以及那一对在色相滑块
// 的每一个取值上是多少对比度（#1038 r3）。
//
// ══ 为什么要有这个文件 ══════════════════════════════════════════════════════════════════════════
//
// QA3 在 r2 上量到一格破线：violet 这组配色 + 色相滑块拖到 −15° ⟹ `.cta-banner__desc` 掉到
// 4.45:1。而 r2 的 18 格读数全部是**滑块归零**时量的，所以枚举里根本没有那一格。
//
// 机理（PM 在 #1038 r5 留言里算出来的，本文件复算并复用）：色相偏移**保住每个颜色自己的相对
// 亮度**（实测单个 token 亮度最大只动 0.0014），所以纯色底上它几乎不动对比度 —— 而
// `.cta-banner` 的底色是**两个 token 的渐变**，浏览器按 sRGB 字节线性插值，亮度是字节的**非线性**
// 函数 ⟹ 两端亮度都没变，混出来的那个点的亮度会变。
//
// 用真浏览器把「6 组配色 × 3 套主题表 × 31 个色相取值」量一遍要几百次建站，跑不动。而这件事在
// 值这一层是算得出来的：底色从主题表里读得到，混色算得出来，对比度是纯算术。真机负责给现象和
// 校准，这里负责穷举。
//
// ══ 🔴 这里的失败方向必须是「比真机更严」════════════════════════════════════════════════════════
//
// 两处地方这份算术会跟真浏览器不一样，两处都往**保守**那边压：
//
//   ① **字实际画出来的颜色比声明的颜色更靠近底色**（抗锯齿）。真机上 `.cta-banner__desc`
//      声明 rgb(250,245,255)、画出来是 rgb(244,238,244) —— 同一格对比度 4.96 → 4.66，**差 0.30**。
//      所以这里不拿声明值算，拿 `mix(声明值, 底色, PAINT_BLEND)` 算。PAINT_BLEND 的定法见下面。
//   ② **渐变上取哪一段**。检查器量的是文字框内「最差的那个主色」，而这里默认把整条渐变都算进去。
//      整条渐变含没有文字的那一端（violet 那条最远端只有 2.61:1），所以「整条都过」是一个**上界**
//      —— 过了就一定过，不过则收窄到文字框真正压着的那一段（`theme-text-bands.json`，由真浏览器
//      量出来的几何，见那个文件的头）。
//
// ══ 这里判什么、不判什么 ════════════════════════════════════════════════════════════════════════
//
// 判的是**主题表自己声明的那些配对** —— 一个选择器写了 `color`，它的底色来自它自己或包着它的那个
// 块。`.btn-primary` / `.btn-accent` 的颜色住在 `globals.css` 不在主题表里，那两个由
// `theme-presets.test.js` 第 ① 节单独判。
//
// 🔴 **这不是「把声明出来的 token 两两配对」** —— 那样会算出一堆页面上从不相遇的组合，而真正破线
// 的那一对根本不是两个 token（`.cta-banner` 的底是 `linear-gradient(135deg, primary-600,
// accent-500)`，文字压着的是渐变上一个混色）。所以配对是从表里**解出来**的：谁写了 color，它外面
// 最近的那个写了背景的块是谁。

'use strict';

const { TWEAK_BOUNDS } = require('./tweaks.js');

/**
 * 🔴 抗锯齿让画出来的字更靠近底色，对比度因此比声明值算出来的低。这里把字往底色里混这么多再算。
 *
 * 定值依据（真浏览器读数，`theme-css-invariants.mjs` 自己打印的「painted / declared / on」三个值，
 * hero-media-top × 四组配色，反解出「混了多少」）：
 *
 *   .cta-banner__desc      violet 0.0494 · graphite 0.0366 · ocean 0.0267 · forest 0.0196
 *   .cta-banner__headline  四组全部 ≤ 0.0006          （字大、笔画粗，几乎不混）
 *   .hero__title / .hero__sub / .page-header__*        画出来的值与声明值差 1 个色阶以内
 *
 * 取 **0.06**：比实测最大的那个（0.0494，最小的那号字）还大一档。
 * 🔴 **它不是一个物理常数，是个上界** —— 反解出来的值在四组配色之间差 2.5 倍（0.0196…0.0494），
 * 因为检查器报的是文字像素里「占面积够大的那个最差色」，取到哪一档跟颜色量化有关。所以这里不去
 * 拟合它，只保证**往严的方向兜住**：混得比真机多 ⟹ 算出来的对比度比真机低 ⟹ 这里过了真机一定过。
 */
const PAINT_BLEND = 0.06;

/** WCAG 的 4.5:1。跟 `theme-css-invariants.mjs` 的 `MIN_CONTRAST` 是同一个数、同一个理由。 */
const MIN_CONTRAST = 4.5;

/**
 * 色相滑块能到的每一个位置。
 *
 * 🔴 上下界从 `TWEAK_BOUNDS` 现读，不另抄一份 —— 抄一份的失败方向是「#1006 把区间放宽了，而这里
 * 还在按老区间穷举」，报告照样绿。步长 1 的依据是弹窗自己：`CustomizeModal.tsx:53-59` 的
 * `hueShift` 是 `step: 1`，Shuffle 也 `quantise` 到同一个 step ⟹ 用户能产生的就是这些整数。
 * 📌 API 的接受域比这宽（`validateTweaks` 和 Go 的 `parseTweaks` 只判「是 number 且在区间内」，
 * `curl` 发 `-14.37` 是合法的）。本票 AC 写的是「滑块允许的每一个取值」，非整数那一面属于
 * #1006 / #1037 的既有面。
 */
function hueSteps() {
  const { min, max } = TWEAK_BOUNDS.hueShift;
  const out = [];
  for (let h = Math.ceil(min); h <= Math.floor(max); h += 1) out.push(h);
  return out;
}

// ── 读表 ────────────────────────────────────────────────────────────────────────────────────────

/**
 * 一张 CSS 表 → 扁平的规则列表 `[{ sel, decls }]`，`@media` 里的规则照样在列表里（本文件问的是
 * 「这个选择器可能是什么颜色」，而不同宽度下的颜色都可能出现在屏幕上）。同一个选择器出现多次时
 * 后面的覆盖前面的，跟浏览器一样。
 */
function parseSheet(css) {
  const src = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const walk = (text) => {
    let pos = 0;
    while (pos < text.length) {
      const open = text.indexOf('{', pos);
      if (open === -1) break;
      const prelude = text.slice(pos, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) {
        // 带块的条件规则：里面还是规则。`@font-face` 之类没有选择器的整块跳过。
        if (/^@(media|supports|layer|container)\b/.test(prelude)) walk(body);
      } else {
        const decls = {};
        for (const d of body.split(';')) {
          const k = d.indexOf(':');
          if (k === -1) continue;
          const prop = d.slice(0, k).trim();
          const val = d.slice(k + 1).trim();
          if (prop && !prop.startsWith('@') && !/[{}]/.test(prop)) decls[prop] = val;
        }
        for (const sel of prelude.split(',').map((s) => s.trim())) if (sel) rules.push({ sel, decls });
      }
      pos = j;
    }
  };
  walk(src);
  return rules;
}

/**
 * 一张表 → `{ colourOf: Map, bgOf: Map }`。`bgOf` 的值是 `{ color, image }`（两个都可能没有）。
 * `background` 简写同时可能带颜色和图，这里按它含不含 `gradient(` 分到两边 —— 主题表里
 * `background:` 的写法只有这两种（表自己有 lint 管着，`scripts/theme-css-lint.js`）。
 */
function indexSheet(rules) {
  const colourOf = new Map();
  const bgOf = new Map();
  for (const { sel, decls } of rules) {
    if (decls.color) colourOf.set(sel, decls.color);
    const cur = bgOf.get(sel) || {};
    let touched = false;
    if (decls['background-color']) { cur.color = decls['background-color']; touched = true; }
    if (decls['background-image']) { cur.image = decls['background-image']; touched = true; }
    if (decls.background) {
      // 简写会**重置**另一半，跟浏览器一样。
      if (/gradient\(/.test(decls.background)) { cur.image = decls.background; cur.color = undefined; }
      else { cur.color = decls.background; cur.image = undefined; }
      touched = true;
    }
    if (touched) bgOf.set(sel, cur);
  }
  return { colourOf, bgOf };
}

/** 一个选择器的底色由谁给：它自己 → 去掉伪类的它自己 → 后代选择器里更靠外的那些 → BEM 的块。 */
function backgroundOwner(sel, bgOf) {
  const paints = (s) => bgOf.has(s) && (bgOf.get(s).color || bgOf.get(s).image);
  if (paints(sel)) return sel;
  const base = sel.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
  if (base !== sel && paints(base)) return base;
  const parts = base.split(/[\s>]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (paints(parts[i])) return parts[i];
    const m = /^(\.[A-Za-z0-9_-]+)__/.exec(parts[i]);   // `.cta-banner__desc` 的底来自 `.cta-banner`
    if (m && paints(m[1])) return m[1];
  }
  return null;
}

/**
 * 一张主题表 + 一份「要量哪些字」的单子 → 页面上真正成对出现的那些颜色。
 *
 * @returns {Array<{selector: string, fg: string, bgSelector: string, bg: {color?: string, image?: string}}>}
 *   只回**表自己声明了 color、而且找得到底色**的那些。找不到底色 = 那个块的底色不归主题表管
 *   （页面自己的白底），配色改不动它，不在本文件射程内。
 */
function textPairs(css, targets) {
  const { colourOf, bgOf } = indexSheet(parseSheet(css));
  const out = [];
  for (const sel of targets) {
    if (!colourOf.has(sel)) continue;
    const owner = backgroundOwner(sel, bgOf);
    if (!owner) continue;
    out.push({ selector: sel, fg: colourOf.get(sel), bgSelector: owner, bg: bgOf.get(owner) });
  }
  return out;
}

// ── 算颜色 ──────────────────────────────────────────────────────────────────────────────────────

const hexToRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const srgbToLinear = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
/** 两个 rgb 的对比度。跟 `theme-css-invariants.mjs` 的 `contrast()` 逐字同式。 */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** 浏览器画渐变是在 sRGB **字节**上线性插值 —— 亮度是字节的非线性函数，本票那格破线就出在这里。 */
const mixBytes = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** `var(--color-primary-600)` / `#rrggbb` / `transparent` → `{rgb, alpha}`；认不出的回 null。 */
function resolveColour(expr, vars) {
  const s = String(expr).trim();
  if (s === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const v = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(s);
  if (v) {
    const hit = vars[v[1]];
    return hit ? { rgb: hexToRgb(hit), alpha: 1 } : null;
  }
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s)) return { rgb: hexToRgb(s), alpha: 1 };
  return null;
}

/** `linear-gradient(135deg, var(--a), var(--b))` → `{ stops: [{colour, pos}] }`；不是渐变回 null。 */
function parseGradient(expr) {
  const m = /^linear-gradient\(([\s\S]*)\)\s*$/.exec(String(expr).trim());
  if (!m) return null;
  // 顶层逗号切分（`var(...)` 里没有逗号，但 `rgb(a, b, c)` 有 —— 按括号深度切才安全）
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of m[1]) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const items = parts.map((p) => p.trim()).filter(Boolean);
  if (/^(to\s|[-\d.]+(deg|rad|turn|grad)$|in\s)/.test(items[0])) items.shift();   // 方向/插值空间那一项
  const stops = [];
  for (const item of items) {
    // 一个色标可以带 0、1 或 2 个位置：`var(--x)` · `var(--x) 35%` · `var(--x) 0 35%`
    // 🔴 光认 `%` 不够：`0` 是合法的位置写法（`linear-gradient(120deg, var(--x) 0 35%, …)` 是
    // hero-media-left 今天的真写法）。漏掉它，那个色标就只剩后一个位置，第一段被吞掉。
    const bits = item.split(/\s+/);
    const colour = bits.shift();
    const poss = bits
      .filter((b) => /^-?[\d.]+%$/.test(b) || /^-?0$/.test(b))
      .map((b) => (b.endsWith('%') ? parseFloat(b) / 100 : 0));
    if (!poss.length) stops.push({ colour, pos: null });
    else for (const pos of poss) stops.push({ colour, pos });
  }
  return stops.length >= 2 ? { stops } : null;
}

/** 没写位置的色标按 CSS 的规矩均匀铺开（首尾钉在 0 和 1，中间没写的在两个写了的之间等分）。 */
function fillPositions(stops) {
  const out = stops.map((s) => ({ ...s }));
  if (out[0].pos === null) out[0].pos = 0;
  if (out[out.length - 1].pos === null) out[out.length - 1].pos = 1;
  let i = 0;
  while (i < out.length) {
    if (out[i].pos !== null) { i += 1; continue; }
    let j = i;
    while (out[j].pos === null) j += 1;
    const from = out[i - 1].pos;
    const to = out[j].pos;
    for (let k = i; k < j; k += 1) out[k].pos = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  // 位置必须不降（CSS 也是这么钳的），否则会算出反向的段
  for (let k = 1; k < out.length; k += 1) if (out[k].pos < out[k - 1].pos) out[k].pos = out[k - 1].pos;
  return out;
}

/** 一个 alpha < 1 的颜色压在 `under` 上，画出来是什么（sRGB 字节上的直接合成，跟浏览器一样）。 */
const over = (top, under) => top.rgb.map((v, i) => Math.round(v * top.alpha + under[i] * (1 - top.alpha)));

/**
 * 一个块的底色，页面上**可能出现的每一个值**。
 *
 * @param {{color?: string, image?: string}} bg  从表里解出来的那两半
 * @param {object} vars      `--color-primary-600` → `#7e22ce`
 * @param {{tmin: number, tmax: number}} [band]  只看渐变上的这一段（文字框真正压着的那一段）。
 *        不给就是整条 `[0, 1]` —— 那是个上界，见文件头 ②。
 * @param {number} [samples] 这一段取多少个点。默认 257 ≈ 8 位色深，再密算不出新颜色。
 * @returns {Array<{rgb: number[], t: number|null}>}  `t` 是渐变上的位置，纯色时是 null。
 */
function backgroundColours(bg, vars, band, samples = 257) {
  const under = bg.color ? resolveColour(bg.color, vars) : null;
  const underRgb = under && under.alpha === 1 ? under.rgb : null;
  if (!bg.image) {
    if (!under) return [];
    return [{ rgb: under.alpha === 1 ? under.rgb : over(under, [255, 255, 255]), t: null }];
  }
  const grad = parseGradient(bg.image);
  if (!grad) return underRgb ? [{ rgb: underRgb, t: null }] : [];
  const stops = fillPositions(grad.stops).map((s) => ({ ...s, c: resolveColour(s.colour, vars) }));
  if (stops.some((s) => !s.c)) return underRgb ? [{ rgb: underRgb, t: null }] : [];
  const lo = band ? band.tmin : 0;
  const hi = band ? band.tmax : 1;
  const out = [];
  for (let i = 0; i < samples; i += 1) {
    const t = lo + ((hi - lo) * i) / (samples - 1);
    // 落在哪一段
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].pos) k += 1;
    const a = stops[k];
    const b = stops[k + 1];
    const span = b.pos - a.pos;
    const u = span <= 0 ? (t < b.pos ? 0 : 1) : Math.min(1, Math.max(0, (t - a.pos) / span));
    const rgb = mixBytes(a.c.rgb, b.c.rgb, u);
    const alpha = a.c.alpha + (b.c.alpha - a.c.alpha) * u;
    out.push({ rgb: alpha === 1 ? rgb : over({ rgb, alpha }, underRgb || [255, 255, 255]), t });
  }
  return out;
}

/**
 * 一对（字，底）在一个色相取值上，最差的那个读数。
 *
 * @returns {{ratio: number, bgRgb: number[], t: number|null}|null}  解不出颜色时回 null
 */
function worstAt(pair, vars, band) {
  const fg = resolveColour(pair.fg, vars);
  if (!fg) return null;
  const bgs = backgroundColours(pair.bg, vars, band);
  if (!bgs.length) return null;
  let worst = null;
  for (const { rgb, t } of bgs) {
    // 🔴 拿「画出来的字」算，不拿声明值 —— 见文件头 ①
    const painted = mixBytes(fg.rgb, rgb, PAINT_BLEND);
    const ratio = contrast(painted, rgb);
    if (!worst || ratio < worst.ratio) worst = { ratio, bgRgb: rgb, t };
  }
  return worst;
}

/**
 * 一对（字，底）在**色相滑块的整个区间**上最差的那个读数。
 *
 * @param {(hue:number) => object} varsAt  给一个色相取值，回那一档下的 `--color-*` 表
 * @param {number[]} [hues]  只看这几档。默认是滑块能到的全部位置。
 *        🔴 它存在的唯一理由是**阳性对照要能单独问「滑块归零那一档呢」** —— 一组对照配色如果在归零
 *        那档就已经红了，它证明的是「坏配色会被判红」，而不是「色相那一维有用」（QA1 在 #1038 r3 上
 *        把这一维整个删掉，那种对照照样报红、整套照样全绿）。生产判据一律走默认值。
 */
function worstOverHue(pair, varsAt, band, hues = hueSteps()) {
  let worst = null;
  for (const hue of hues) {
    const at = worstAt(pair, varsAt(hue), band);
    if (!at) continue;
    if (!worst || at.ratio < worst.ratio) worst = { ...at, hue };
  }
  return worst;
}

module.exports = {
  PAINT_BLEND,
  MIN_CONTRAST,
  hueSteps,
  parseSheet,
  indexSheet,
  backgroundOwner,
  textPairs,
  resolveColour,
  parseGradient,
  fillPositions,
  backgroundColours,
  contrast,
  mixBytes,
  hexToRgb,
  // #1100 —— `button-ink.js` 要问「这个字色是深的还是浅的」（hover 的底往哪个方向走），而
  // 「跟 `#000000` 相等」答不了这一问（`gray-900` 是 #111827）。亮度在这里已经算过一遍，
  // 第二份实现只会跟这份分叉。
  luminance,
  worstAt,
  worstOverHue,
};
