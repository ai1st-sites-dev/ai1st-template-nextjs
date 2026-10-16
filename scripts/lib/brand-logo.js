'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// brand-logo.js —— 顶栏 / 页脚那个 logo 位置画什么、多大（#1784）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 两个旋钮存在顶栏那一份 `regionOptions.header`（`blocks/header/manifest.json` 的 `slots.options.knobs`；没有任何预设写到它们
// ⟹ 不归预设管，`header-knobs.js` 文件头）：
//   · logoType  text | image —— 只出店名 / 只出 logo 图（图的 `alt` 写店名）。
//     没存 ⟹ 看 `brand.logoHasWordmark`（「这张图里自带店名吗」）：真 ⟹ image，假或没有 ⟹ text。🔴 **不看有没有图**：
//     老板没传 logo 时建站会生成一张只有图标的 logo，照样写 `logoUrl`，但 `logoHasWordmark = false`（`create-site.js` 建站 logo 那段）。
//     选了 image 但没有图 ⟹ 照 text 画（老板把 Content 页的 Logo 清空了，顶栏不能变成一片空白）。
//   · logoSize  数字 = 图高 px（#1784 r7，Chris 2026-10-15「照 Durable」：只有 image 有 Scale 滑杆）。范围 / 步长 / 默认只写在
//     `blocks/header/manifest.json` 的 `slots.options.numbers`（24–80、步长 4、默认 40），这里现取。没存、或存的不在范围里
//     （r6 存下的 's' / 'm' 这类旧值）⟹ 默认。text 没有大小：店名一律 1.25rem（两个块的 block.css）。
//     992 以下图高最多 44px 也在 block.css。
// 页脚不单独设（正文「不做」）：外壳把顶栏这一份递给页脚（`SiteShell.tsx`）。`logoHasWordmark` 由构建派生进两个块的 data
// （`shell-data.js`），编辑器画布上换了 logo 照存盘那条规矩当场置真（`nav-editor.js` §liveShellData）。
// 🔴 三边读这一份：顶栏 Section、页脚 Section、编辑器 Customize 页亮哪一格 —— 各写一份默认的话，
//    面板说 image、站上画成 text，两边都不会红。

const { numbersOf, inRange } = require('./header-knobs');
const headerManifest = require('../../blocks/header/manifest.json');

const TYPES = ['text', 'image'];
/** 顶栏 manifest 里 logoSize 那一条（`{ min, max, step, default }`）。 */
const LOGO_SIZE = numbersOf(headerManifest).find((r) => r.name === 'logoSize');

/**
 * @param {object} options  顶栏的 options（存下的那份；没写的格就是没写）
 * @param {{ hasLogo?: boolean, hasWordmark?: boolean }} brand  这个站有没有 logo 图、那张图里是不是自带店名
 * @returns {{ type: 'text' | 'image', size: number, chosen: 'text' | 'image' }}  size = 图高 px
 *   `chosen` = 面板上该亮的那一格（存下的值，没存按 hasWordmark）；`type` = 实际画的（chosen 是 image 却没图 ⟹ text）。
 */
function resolveBrandLogo(options, brand) {
  const o = options && typeof options === 'object' ? options : {};
  const b = brand && typeof brand === 'object' ? brand : {};
  const chosen = TYPES.includes(o.logoType) ? o.logoType : (b.hasWordmark === true ? 'image' : 'text');
  const size = inRange(LOGO_SIZE, o.logoSize) ? o.logoSize : LOGO_SIZE.default;
  return { type: chosen === 'image' && b.hasLogo === true ? 'image' : 'text', size, chosen };
}

module.exports = { resolveBrandLogo, LOGO_SIZE };
