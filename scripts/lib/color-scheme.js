'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// color-scheme.js —— 站级深浅：`site_meta.json` 的 `colorScheme`（#1472）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 三个值：`light`（默认）· `dark` · `auto`（跟访客系统的 `prefers-color-scheme`）。落到页面上是
// `<html data-bs-theme="light|dark">`（`src/app/layout.tsx`；`auto` 由首屏前那段内联脚本写），Bootstrap / Webpixels
// 的 `--x-body-*` 那组变量跟着换。块的 `bg` 跟它正交（`contrast.js` §bsThemeForBg）。
//
// 🔴 **一处判据，三个读者**：`sync-config.js`（读 site_meta、出错就停）、`create-site.js`（把 AI 给的值归一后写进
//    site_meta）、本文件的单测。没写 = `light`：老站（没有 site_meta.json 的扁平站、或 site_meta 里没有这个键）一律
//    浅色，跟改前逐字相同。

const COLOR_SCHEMES = ['light', 'dark', 'auto'];
const DEFAULT_COLOR_SCHEME = 'light';

function isColorScheme(v) {
  return typeof v === 'string' && COLOR_SCHEMES.includes(v);
}

/**
 * site_meta 里读出来的值 → 站的 colorScheme。没写（undefined / null）= `light`；写了但不是那三个值 = 抛，
 * 让构建停下来点名（静默落回 light 的话，老板选的「深色」就悄悄没了，而构建是绿的）。
 */
function colorSchemeFromMeta(v) {
  if (v === undefined || v === null) return DEFAULT_COLOR_SCHEME;
  if (!isColorScheme(v)) {
    throw new Error(`site_meta.json invalid: colorScheme ${JSON.stringify(v)} —— 只认 ${COLOR_SCHEMES.join(' / ')}`);
  }
  return v;
}

/** AI 吐回来的值 → 存盘的值：认得的原样（大小写、空白归一），认不得的落回 `light`（建站不为这一项失败）。 */
function normalizeColorScheme(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return isColorScheme(s) ? s : DEFAULT_COLOR_SCHEME;
}

/**
 * `auto` 站首屏前那段内联脚本（`layout.tsx` 放进 <head>）：按系统深浅写 `data-bs-theme`，并跟着系统切换改写。
 * 放在 <head> 里、同步执行 ⟹ body 画第一帧之前属性已经在，不闪白（验收 2）。
 * `matchMedia` 不在（极老的浏览器）⟹ 写 `light`，等于改前。
 */
const AUTO_SCHEME_SCRIPT = '(function(){var d=document.documentElement,'
  + 'm=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;'
  + 'function a(){d.setAttribute("data-bs-theme",m&&m.matches?"dark":"light");}a();'
  + 'if(m){if(m.addEventListener)m.addEventListener("change",a);else if(m.addListener)m.addListener(a);}})();';

module.exports = {
  COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, isColorScheme, colorSchemeFromMeta, normalizeColorScheme, AUTO_SCHEME_SCRIPT,
};
