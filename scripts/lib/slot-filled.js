'use strict';
// #1828 —— 「一个槽位填了没」和 `data-has-*` 的来源，从 `block-manifest.js` 挪出来的两个纯函数：那份文件顶上 require 了
//    fs / typescript，进不了浏览器包，而 dashboard 的块图册（`src/lib/catalog/cell.ts`）要在浏览器里算 `data-has-*`。
//    `block-manifest.js` 原样转出这两个，调用方不用改。

/**
 * 一个槽位「填了没」。🔴 三处用同一把尺（#1331）：第 ① 条（必填槽）、第 ⑥ 条（形态的 needs）、
 * 构建时写到块上的 `data-has-*`。分成三份实现的失败方向是静默的：校验放行、构建落回、DOM 又说填了。
 */
function slotFilled(v) {
  return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
}

/**
 * manifest 里 `required: false` 且在 `data` 里填了的槽位名 —— `data-has-<槽位>` 的来源（#1331）。
 * 🔴 名字沿用 manifest 的键原样（`imageUrl` 不改 kebab），shapes.css 和守卫两边才对得上。
 */
function filledOptionalSlots(m, data) {
  const d = data || {};
  return Object.entries((m && m.slots) || {})
    .filter(([slot, spec]) => spec && !spec.required && slotFilled(d[slot]))
    .map(([slot]) => slot);
}

module.exports = { slotFilled, filledOptionalSlots };
