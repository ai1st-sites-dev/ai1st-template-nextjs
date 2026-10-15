'use strict';

// header-buttons.js —— 顶栏按钮（#1787）：`<语言>/navigation.json` 的 `header.buttons: [{label, href}]`，0–3 颗。
//
// 规则只写这一份，四处调它：构建（`shell-data.js`）· 编辑器画布预览（`nav-editor.js` §liveShellData）·
// 编辑器 Done（`EditorApp.tsx` §headerContentProblem）· 写盘（`editor-root.js`）。
//   · 样子按位置定、不另存：第 1 颗实心（主按钮）、第 2 颗描边、第 3 颗文字链接样（§STYLE_AT）。
//   · `href` 同 #1779：地址字符串，或电话 / 邮箱引用（`{source: "phone" | "email", location?}`，构建时展开）。
//   · 0 颗是合法的（老板删光了就是不要按钮）；最多 3 颗（992–1199 宽时第 3 颗不出，`blocks/header/Section.tsx`）。
// 🔴 这份只 require 两份零依赖的库（`href-allowed.js`、`item-sources.js`）：编辑器页是客户端组件，直接 import 它。

const { hrefAllowed } = require('./href-allowed');
const { isButtonRef } = require('./item-sources');

const MAX_HEADER_BUTTONS = 3;
/** 第 i 颗的样子（`blocks/header/Section.tsx` §ctaClass 认这三个名）。 */
const STYLE_AT = ['solid', 'outline', 'link'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** 按钮 href 是不是空的：字符串去空白后为空；引用不算空。 */
const hrefEmpty = (href) => !isButtonRef(href) && !str(href);

/**
 * 列表 → 顶栏块 data 的 `buttons`：`[{label, href, style, at}]`，只留画得出的那几颗。
 * `at` = 它在老板那份列表里的下标（编辑器画布上点它开那一颗的弹窗；样子也按它定 —— 中间一颗画不出时后面那颗不换样子）。
 * 画得出 = label 非空，且 href 是引用（原样交下去，`SiteShell` 渲染前展开）或过白名单的地址（`href-allowed.js`，
 * 写盘那一关同一个函数；`loc` 给站内地址加语言前缀）。
 */
function headerButtonsData(list, loc = (h) => h) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, MAX_HEADER_BUTTONS).forEach((b, at) => {
    const label = isObj(b) ? str(b.label) : '';
    if (!label) return;
    const style = STYLE_AT[at];
    if (isButtonRef(b.href)) { out.push({ label, href: { ...b.href }, style, at }); return; }
    // 白名单判的是写进去的原样（前后带空格的也拒，同写盘那道链接判据 `link-href.js`：它只判、不替老板删字）。
    const href = str(b.href);
    if (href && hrefAllowed(b.href)) out.push({ label, href: loc(href), style, at });
  });
  return out;
}

/**
 * 编辑器 Done 与写盘共用的拒收判据：'' = 能存；否则是给老板看的那句话（状态栏 / 面板底下那一行）。
 * 只判老板能在 Content 页里弄出来的几种：超过 3 颗 · 某一颗没名字或没链接。链接能不能用（白名单）归写盘那道链接判据。
 */
function headerButtonsProblem(list) {
  if (!Array.isArray(list)) return 'The header buttons must be a list.';
  if (list.length > MAX_HEADER_BUTTONS) return `The header can have up to ${MAX_HEADER_BUTTONS} buttons.`;
  for (let i = 0; i < list.length; i += 1) {
    const b = list[i];
    if (!isObj(b) || !str(b.label) || hrefEmpty(b.href)) {
      return `${list.length === 1 ? 'The header button' : `Header button ${i + 1}`} needs both a name and a link.`;
    }
  }
  return '';
}

module.exports = { MAX_HEADER_BUTTONS, STYLE_AT, hrefEmpty, headerButtonsData, headerButtonsProblem };
