'use strict';

// href-allowed.js —— 老板填的链接能去哪儿：判据本身（#1416 的白名单，#1511 从 `link-href.js` 原样挪出来）。
//
// 规则与理由写在 `link-href.js` 文件头「放行什么」那一段，这里不重抄。
// 🔴 这份**不 require 任何东西**：`site-forms.js`（客户端组件也 import 它）要用它判 `redirect`，
//    而 `link-href.js` 顶层带着 block-manifest（fs / path）。往这里加 require = 把服务端代码拖进客户端包。

const ALLOWED_SCHEME = /^(?:https?|mailto|tel):/i;
const SITE_PATH = /^\/(?![/\\])/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 这个 href 能不能收。能 ⟹ `true`。空串算「没填」，也回 `true`。 */
function hrefAllowed(href) {
  if (typeof href !== 'string' || href === '') return true;
  if (CONTROL.test(href) || href !== href.trim()) return false;
  return ALLOWED_SCHEME.test(href) || SITE_PATH.test(href);
}

module.exports = { hrefAllowed };
