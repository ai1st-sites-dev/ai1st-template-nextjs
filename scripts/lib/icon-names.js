'use strict';
// #1798 —— 图标名的清单与收集，从 `icons.js` 挪出来的纯函数（那份文件读 svg、顶上 require fs，进不了浏览器包）。
// `icons.js` 原样转出 iconNamesIn / BLOCK_ICONS / usesIconTable；新加的两个是给岛用的：
//   · publishedIconNames(块, data)  发布出去的岛 props 里那张图标表该有哪些名字 = 这个块写死要用的（去掉 9 个社交平台图标）
//                                    ∪ data 里出现的（`iconNamesIn`）。社交图标常备是给编辑器画布的（#1785），发布页上 data 里有哪个就带哪个。
//   · pickIcons(表, 名字)            按名字从已经查好的表里挑。

// #1785 —— Social links 那 9 个平台的图标名（平台表和平台名 → 图标名都住在 item-sources.js，这里不抄一份）。
const { SOCIAL_PLATFORMS, socialIcon } = require('./item-sources');
const SOCIAL_ICON_NAMES = SOCIAL_PLATFORMS.map((p) => socialIcon(p.platform));

/** 数据里每一个叫 `icon` 的字符串值（槽位契约：它就是图标名）。 */
function iconNamesIn(value, out = new Set()) {
  if (Array.isArray(value)) { for (const v of value) iconNamesIn(v, out); return out; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'icon' && typeof v === 'string') out.add(v);
      else iconNamesIn(v, out);
    }
  }
  return out;
}

/**
 * 块组件自己点名的图标（不来自数据）：header 的汉堡 / 关闭 / 电话，footer 联系信息那几个，
 * 以及社交链接没写图标时的兜底。改组件里的字面名要同步这里 —— 漏了的失败方向是可见的：那个图标不画，
 * 且 `icons.test.js` 会逐个核「组件里写的字面名都在这张表里」。
 */
const BLOCK_ICONS = {
  // #1780 —— 顶栏上面那一行的三类图标都常备（电话 / 信封 / 链接）：老板在编辑器里新加一项，画布不用等重建就画得出图标。
  // #1785 —— 两行都带上 Social links 那 9 个平台的图标（item-sources.js §SOCIAL_PLATFORMS / §socialIcon）：表是构建时按数据里
  //    出现的名字查的，老板在编辑器里刚加一条、还没重建时，画布上也要画对那个图标，不是落回 link-45deg。
  'header': ['list', 'x-lg', 'telephone', 'envelope', 'link-45deg', ...SOCIAL_ICON_NAMES],
  'footer': ['telephone', 'geo-alt', 'clock', 'envelope', 'link-45deg', ...SOCIAL_ICON_NAMES],
  // #1475 —— 按钮的箭头（`arrow: true`）。项目的图标来自数据（`items[].icon`），由 §iconNamesIn 收，不写在这里。
  //    #1527 —— 条目小清单（`items[].bullets`）每行的勾号，同 pricing。
  'features': ['arrow-right', 'check'],
  // #1482 —— 同 features：块头按钮的箭头；stats 的图标来自数据（`stats[].icon`），由 §iconNamesIn 收。
  milestones: ['arrow-right'],
  // #1487 —— 招聘卡的图标圈（person-plus）+ 它按钮的箭头（`join.cta.arrow`）。成员链接的图标来自数据（`members[].links[].icon`），
  //    由 §iconNamesIn 收 —— 所以那个字段必须叫 `icon`。
  'team': ['person-plus', 'arrow-right'],
  // #1489 —— contact items 五种 kind 的图标（同 footer 那五个）+ 地图地址卡上的钉子。
  'contact': ['telephone', 'envelope', 'geo-alt', 'clock', 'link-45deg', 'geo-alt-fill'],
  // #1483 —— 功能清单每行的勾号；highlights 的图标来自数据（`highlights[].icon`），由 §iconNamesIn 收。
  'pricing': ['check'],
  // #1488 —— 星级（每条 n 颗实心 + 空心补到 5 颗）和轮播的前 / 后箭头，都是组件里写死的名字。
  //    #1500 —— 平台评分改成四舍五入到整数颗，半星不再用到（`star-half` 拿掉）。
  //    #1766 —— summary 的平台 logo 不再是图标（模板自带的全彩文件，`review-platforms.js`），这一行不再列品牌图标。
  'testimonials': ['star-fill', 'star', 'chevron-left', 'chevron-right'],
  // #1484 —— 问答的开合图标（itemToggle：chevron = chevron-down；plus = plus + dash，展开时换着显示）+ help 卡按钮的箭头。
  'faq': ['chevron-down', 'plus', 'dash', 'arrow-right'],
  // #1504 —— 星级（按分数四舍五入的实心星）。#1766 —— 常见平台的 logo 换成模板自带的全彩文件（`review-platforms.js`），不再是图标。
  'reviews': ['star-fill'],
  // #1498 —— 同 milestones：按钮的箭头；按钮图标来自数据（`ctas[].icon`），由 §iconNamesIn 收。
  'content': ['arrow-right'],
};

/**
 * #1475 —— 这个块的组件画不画服务端查好的图标表：`BLOCK_ICONS` 里有它这一行 = 画（那一行可以是空数组 ——
 * 组件没写死任何名字、图标全来自数据的块也要登记一行）。老块（`ServiceIcon` 那一套）不在这里，
 * 它们数据里的 `icon` 是另一套图标的名字，拿来查 bootstrap-icons 只会刷一排「查不到」。
 */
function usesIconTable(block) {
  return typeof block === 'string' && Object.prototype.hasOwnProperty.call(BLOCK_ICONS, block);
}

/** #1798 —— 发布出去的岛要带的图标名（见文件头）。 */
function publishedIconNames(block, data) {
  const social = new Set(SOCIAL_ICON_NAMES);
  const fixed = (BLOCK_ICONS[block] || []).filter((n) => !social.has(n));
  return new Set([...fixed, ...iconNamesIn(data)]);
}

/**
 * #1798 —— 从一张已经查好的图标表里按名字挑（表里没有的名字跳过 —— 查不到的图标本来就不画）。
 * @template T
 * @param {Record<string, T> | undefined} table
 * @param {Iterable<string>} names
 * @returns {Record<string, T>}
 */
function pickIcons(table, names) {
  /** @type {Record<string, T>} */
  const out = {};
  for (const n of [...names].sort()) if (table && Object.prototype.hasOwnProperty.call(table, n)) out[n] = table[n];
  return out;
}

module.exports = { SOCIAL_ICON_NAMES, iconNamesIn, BLOCK_ICONS, usesIconTable, publishedIconNames, pickIcons };
