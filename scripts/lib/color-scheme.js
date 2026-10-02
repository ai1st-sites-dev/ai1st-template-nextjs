'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// color-scheme.js —— 站级深浅：`theme.json` 的 `colorScheme`（#1472 加、#1523 从 `site_meta.json` 搬过来）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 三个值：`light`（默认）· `dark` · `auto`（跟访客系统的 `prefers-color-scheme`）。落到页面上是
// `<html data-bs-theme="light|dark">`（`src/app/layout.tsx`；`auto` 由首屏前那段内联脚本写），Bootstrap / Webpixels
// 的 `--x-body-*` 那组变量跟着换。块的 `bg` 跟它正交（`contrast.js` §bsThemeForBg）。
//
// 🔴 **一处判据，三个读者**：`sync-config.js`（§readSiteColorScheme、出错就停）、`create-site.js`（把 AI 给的值归一后
//    写进 theme.json）、本文件的单测。没写 = `light`：两个文件里都没有这个键的站一律浅色，跟改前逐字相同。
//
// 🔴 #1523 —— **住在 `theme.json`，`site_meta.json` 只剩回落**。老板在后台 Customize 面板改它，那条路本来就在写
//    theme.json（worker §themeWriteCommand）；site_meta.json 是「站的身份与语言布局」，聊天编辑器明文不给改
//    （`editable-files.js`），不为一个外观开关开例外。#1472 落地后、#1523 落地前建的站，值只在 site_meta 里 ⟹
//    theme.json 里**没有这个键**时才读它。theme.json 里写了就以它为准，哪怕 site_meta 说的不一样（老板改过）。

const COLOR_SCHEMES = ['light', 'dark', 'auto'];
const DEFAULT_COLOR_SCHEME = 'light';

function isColorScheme(v) {
  return typeof v === 'string' && COLOR_SCHEMES.includes(v);
}

/**
 * 文件里读出来的值 → 站的 colorScheme（`file` 只用在报错那句话里）。没写（undefined / null）= `light`；写了但不是那三个值 = 抛，
 * 让构建停下来点名（静默落回 light 的话，老板选的「深色」就悄悄没了，而构建是绿的）。
 */
function colorSchemeFromMeta(v, file = 'site_meta.json') {
  if (v === undefined || v === null) return DEFAULT_COLOR_SCHEME;
  if (!isColorScheme(v)) {
    throw new Error(`${file} invalid: colorScheme ${JSON.stringify(v)} —— 只认 ${COLOR_SCHEMES.join(' / ')}`);
  }
  return v;
}

/**
 * 读一个站目录里的 JSON 文件；不在 = null。坏 JSON 照样抛（构建该停）。
 * 📌 `fs` / `path` 在函数里 require，不放文件顶上：`src/app/layout.tsx` 也 import 本文件（只拿 AUTO_SCHEME_SCRIPT），
 *    让页面那一侧 import 进来的东西保持不带 node 内置模块，跟 #1472 时一样。
 */
function readJsonIfPresent(p) {
  const fs = require('fs');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
}

/**
 * #1523 —— 一个站的深浅：`theme.json` 的 `colorScheme` 优先，那里没有这个键才回落 `site_meta.json`（理由在文件头）。
 * 两个文件都可以不在（扁平老站没有 site_meta，#924 之前的站没有 theme.json）。写错的值抛，报错点名是哪个文件。
 */
function readSiteColorScheme(siteDir) {
  const path = require('path');
  const theme = readJsonIfPresent(path.join(siteDir, 'theme.json'));
  if (theme && theme.colorScheme !== undefined && theme.colorScheme !== null) {
    return colorSchemeFromMeta(theme.colorScheme, 'theme.json');
  }
  const meta = readJsonIfPresent(path.join(siteDir, 'site_meta.json'));
  return colorSchemeFromMeta(meta ? meta.colorScheme : undefined, 'site_meta.json');
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
  COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, isColorScheme, colorSchemeFromMeta, readSiteColorScheme, normalizeColorScheme,
  AUTO_SCHEME_SCRIPT,
};
