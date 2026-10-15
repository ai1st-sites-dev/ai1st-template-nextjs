'use strict';

// topbar-links.js —— #1780 顶栏上面那一行（topbar 那两个预设才有）的链接列表：存在 `<语言>/navigation.json` 的
//   `header.topbarLinks`，每项 `{label, href}`；`href` 是字符串，或本店电话 / 邮箱的引用 `{source: "phone" | "email"}`（同按钮，#1506）。
//
// 三处用它，规则只在这里写一份：
//   · 构建（`shell-data.js`）把列表派生成 header 的 `topbar.contact`（§topbarContact）；
//   · 编辑器画布预览（`nav-editor.js` §liveShellData）用同一个 §topbarContact 换上面板里的现值；
//   · Done / 写盘两道判（EditorApp §headerContentProblem、`editor-root.js` §topbarRefusal）都调 §topbarLinksProblem。
// 🔴 编辑器（客户端包）也 import 这份 ⟹ 只 require 客户端也能用的两份：`href-allowed.js`（零依赖）、`item-sources.js`（编辑器本来就 import 它）。
//
// 没有 `topbarLinks` 这一格 ⟹ 当作 §DEFAULT_TOPBAR_LINKS（电话 + 邮箱，#1780 之前写死在 shell-data.js 的样子），老站不变。

const { hrefAllowed } = require('./href-allowed');
const { isButtonRef } = require('./item-sources');

const MAX_TOPBAR_LINKS = 3;
const DEFAULT_TOPBAR_LINKS = [{ label: '', href: { source: 'phone' } }, { label: '', href: { source: 'email' } }];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** 本店电话 / 邮箱的引用 `{source: "phone" | "email", location?}`：跟顶栏按钮的 href 同一个判据（#1779 `item-sources.js` §isButtonRef），不另写一份。 */
const isContactRef = isButtonRef;

/** 存着的那一格 → 列表（不是数组 = 没写过 ⟹ 默认那两项的一份新拷贝）。 */
function topbarLinksOf(v) {
  return Array.isArray(v) ? v : DEFAULT_TOPBAR_LINKS.map((x) => ({ label: x.label, href: { ...x.href } }));
}

/** 这一项是哪一类：电话 / 邮箱（引用或 `tel:` / `mailto:`）—— label 可以空、显示号码本身；其余（站内页、外部网址、锚点）label 必填。 */
function linkKindOf(href) {
  if (isContactRef(href)) return href.source;
  const s = str(href);
  if (/^tel:/i.test(s)) return 'phone';
  if (/^mailto:/i.test(s)) return 'email';
  return 'other';
}

/** 这一项的链接填了没有（只有协议头 `tel:` / `mailto:` / `https://` 也算没填）。 */
function hasTarget(href) {
  if (isContactRef(href)) return true;
  const s = str(href);
  return !!s && !/^(?:tel:|mailto:|https?:\/\/)$/i.test(s);
}

/**
 * 这一份列表能不能存 → 给老板看的一句话（'' = 能存）。编辑器 Done 和写盘两道都用它（同一句话、同一个开关）。
 * 判据（#1780 做什么 4 / 不做）：至少一项（清空最后一项 ⟹ 让他改用不带 top bar 的版式）· 最多 §MAX_TOPBAR_LINKS 项 ·
 * 每一项要有链接 · 电话 / 邮箱以外的那几类要有字（没有号码可以显示）。
 * 🔴 `shown` = 存完以后顶栏的版式带不带上面那一行。不带 ⟹ 一条都不判：那一段不出、那一行不画，而「清空了就换个不带 top bar 的版式」
 *    正是拒收那句话给的出路 —— 照着走必须存得进去（#1780 r1 QA2：编辑器只在带的时候判、写盘一律判，两边说的不是一件事）。
 *    两边各自算 `shown`（编辑器按面板现值，写盘按 root + 盘上的现值），算法同一份：`region-options.js` §effectiveRegionKnobs 的 `topbar`。
 * @param {unknown} list
 * @param {boolean} shown
 */
function topbarLinksProblem(list, shown) {
  if (!Array.isArray(list)) return 'The top bar links could not be read. Nothing was changed.';
  if (!shown) return '';
  if (list.length === 0) {
    return 'The top bar needs at least one link. To remove the top bar, choose a header layout without it (Design → Layout).';
  }
  if (list.length > MAX_TOPBAR_LINKS) return `The top bar can have at most ${MAX_TOPBAR_LINKS} links.`;
  for (let i = 0; i < list.length; i += 1) {
    const it = isObj(list[i]) ? list[i] : {};
    if (!hasTarget(it.href)) return `Link ${i + 1} in the top bar needs somewhere to go.`;
    if (linkKindOf(it.href) === 'other' && !str(it.label)) return `Link ${i + 1} in the top bar needs a label.`;
  }
  return '';
}

/**
 * 列表 → header 的 `topbar.contact`（`blocks/header/Section.tsx` 画的那份）。
 *   · 引用 ⟹ 照旧留成引用 `{source, location?}`，label 不空就带上 `label`：渲染前 `item-sources.js` §resolveItemSlots 展开成
 *     `{icon, text, href}`，带 label 的用 label 换掉 text；指向的值不存在 ⟹ 那一项不画（同 #1780 之前）。
 *   · 字符串 ⟹ 当场画成 `{icon, text, href}`：`tel:` 电话图标、`mailto:` 信封、其余链接图标；字 = label，空的电话 / 邮箱显示号码本身；
 *     站内地址按语言加前缀（`loc`）。不过写盘白名单（`href-allowed.js`）或没字可显示的那一项不画。
 *   · 每一项带 `at` = 它在列表里的下标：中间有一项不画时，画布上点到的那一项仍对得上老板列表里的那一项
 *     （`blocks/header/Section.tsx` 挂成 `data-editor-region-link="topbar.<at>"`）。
 * @param {unknown} v  `header.topbarLinks` 存着的值
 * @param {(href: string) => string} [loc]
 */
function topbarContact(v, loc = (h) => h) {
  const out = [];
  topbarLinksOf(v).forEach((it, at) => {
    if (!isObj(it)) return;
    const label = str(it.label);
    const h = it.href;
    if (isContactRef(h)) {
      out.push({ source: h.source, ...(h.location !== undefined ? { location: h.location } : {}), ...(label ? { label } : {}), at });
      return;
    }
    const href = str(h);
    if (!hasTarget(href) || !hrefAllowed(href)) return;
    const kind = linkKindOf(href);
    const text = label || (kind === 'phone' ? href.slice(4) : kind === 'email' ? href.slice(7) : '');
    if (!text) return;
    out.push({ icon: kind === 'phone' ? 'telephone' : kind === 'email' ? 'envelope' : 'link-45deg', text, href: loc(href), at });
  });
  return out;
}

module.exports = { MAX_TOPBAR_LINKS, DEFAULT_TOPBAR_LINKS, isContactRef, topbarLinksOf, linkKindOf, topbarLinksProblem, topbarContact };
