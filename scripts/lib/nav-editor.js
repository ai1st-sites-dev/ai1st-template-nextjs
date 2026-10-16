'use strict';

// nav-editor.js —— 编辑器顶栏 Content 页「Navigation links」在浏览器那一侧的算法（#1759 立，#1781 重写）。纯函数，只 require
// 零依赖的库（`nav-menu.js` 的语言前缀、`href-allowed.js` 链接白名单、`item-sources.js` 的引用判据、`header-buttons.js` 顶栏按钮
// 规则（#1787）、`topbar-links.js` 顶栏上面那一行（#1780）），所以编辑器页（客户端）能直接 import，`editor-nav.test.js` 也能逐条量。
//
// #1781 —— 菜单是老板自己的一份列表（`navigation.json` 的 `header.links`，Puck root 的 `headerLinks`）：`[{label, href}]`，
//   `href` 是字符串或本店电话 / 邮箱的引用（同按钮）。面板里一行一项：拖动 · 名字 · Edit · 删除；Edit / Add 开链接弹窗。
//   原来那套「从页面推、改 navLabel / navOrder」随 #1781 拿掉了（写盘那一侧的 `editor-nav.js` §planNavWrite 还在，编辑器不再调它）。
//
// 规矩：
//   · 每一项要有名字（≤ §NAV_LABEL_MAX 个字）和链接（字符串非空，或电话 / 邮箱引用）。不过 ⟹ Done 被拒并说一句（§menuLinksProblem）。
//     写盘那一侧（`editor-root.js` §checkShape）照样再判一次，话是同一句。
//   · 预览（§liveShellData）：顶栏和页脚第一列都画这一份（构建时页脚第一列 = 菜单原样，`derive-site.js`）。
//   · #1783 —— 每一项可以带一层下拉 `children: [{label, href, description?}]`：子项的名字 / 链接规矩同顶层，`description` 可空、
//     ≤ §NAV_DESC_MAX 个字；子项不能再有子项（§childrenProblem）。AI 改站那道门（`navigation-owned.js` §menuLinkProblems）用同一个函数。
//     页脚第一列只画顶层。

const { localizeHref } = require('./nav-menu');
const { hrefAllowed } = require('./href-allowed');
const { BUTTON_SOURCES } = require('./item-sources');
const { headerButtonsData } = require('./header-buttons');
const { topbarContact } = require('./topbar-links');

/** 跟写盘那一侧（`lib/editor-root.js` 的菜单检查）同一个数：顶栏一行放得下的名字。 */
const NAV_LABEL_MAX = 40;
/** #1783 —— 下拉子项那一行灰色小字的上限（票正文「一行字、可空、最多 80 字符」）。 */
const NAV_DESC_MAX = 80;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** 本店电话 / 邮箱的引用（同按钮：`{source: "phone" | "email", location?}`）。 */
function isMenuRef(h) {
  return isObj(h) && typeof h.source === 'string' && BUTTON_SOURCES.includes(h.source);
}

/** 这一项有没有链接：非空字符串，或 §isMenuRef。 */
function hasHref(h) {
  return isMenuRef(h) || !!str(h).trim();
}

/** 一项不能存时那一句（'' = 能存）。 */
function menuItemProblem(item) {
  const label = isObj(item) ? str(item.label).trim() : '';
  if (!label) return 'Every link in the menu needs a name.';
  if (label.length > NAV_LABEL_MAX) return `Menu link names can be up to ${NAV_LABEL_MAX} characters.`;
  if (!hasHref(isObj(item) ? item.href : undefined)) return `The menu link "${label}" needs somewhere to go.`;
  return '';
}

/**
 * #1783 —— 一项的下拉（`children`）不能存时那一句（'' = 能存；没有 `children` = 能存）。只一层：子项再带 `children` ⟹ 拒。
 * 子项的名字 / 链接同顶层（§menuItemProblem）；`description` 不是字符串、或超过 §NAV_DESC_MAX 个字 ⟹ 拒。
 */
function childrenProblem(item) {
  if (!isObj(item) || item.children === undefined) return '';
  const parent = str(item.label).trim() || 'this link';
  if (!Array.isArray(item.children)) return `The dropdown under "${parent}" must be a list of links.`;
  for (const c of item.children) {
    if (isObj(c) && c.children !== undefined) return `Dropdown links can't have their own dropdown — "${parent}" can only have one level of links under it.`;
    const why = menuItemProblem(c);
    if (why) return why;
    if (c.description !== undefined && typeof c.description !== 'string') return `The description of "${str(c.label).trim()}" must be text.`;
    if (str(c.description).trim().length > NAV_DESC_MAX) return `Dropdown link descriptions can be up to ${NAV_DESC_MAX} characters.`;
  }
  return '';
}

/** 整份菜单不能存时那一句（'' = 能存；不是数组 = 这一笔不带菜单，不管）。#1783：连下拉一起判（§childrenProblem）。 */
function menuLinksProblem(links) {
  if (!Array.isArray(links)) return '';
  for (const it of links) {
    const why = menuItemProblem(it) || childrenProblem(it);
    if (why) return why;
  }
  return '';
}

/** 第 `from` 项拖到第 `to` 项的位置。下标越界 / 原地 ⟹ 原样。不改入参。 */
function moveItem(list, from, to) {
  if (!Array.isArray(list) || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

/**
 * 画布预览：构建烤进来的顶栏 / 页脚 data（`shell-data.js` 那一份）换上面板里的现值 —— 菜单、按钮、logo、顶栏上面那一行的链接（#1780）。
 * 按钮跟构建同一个函数（`header-buttons.js` §headerButtonsData，#1787）；菜单项名字非空、链接是白名单里的字符串或引用（同 `shell-data.js` §links）。
 * #1781 —— 每一项多带一个 `editorIndex`（它在 `headerLinks` 里的下标）：顶栏块据它给画布上那一项挂 `data-editor-region-link`，
 *   点它开那一项的链接弹窗。只在这里加 —— 构建那份（`shell-data.js`）没有它，发布的网站上一个字节不多。
 *   菜单不再扣掉主按钮指向的那一页（同构建，#1781）。没带的那一样原样。
 * @param {{ header: object, footer: object }} data  这种语言构建那一份（`regions.<区>.dataByLocale[语言]`）
 * @param {object} p  面板现值：{ headerLinks?, headerButtons?, logoUrl?, headerTopbar? }
 */
function liveShellData(data, p, locale, defaultLocale) {
  const loc = (href) => localizeHref(href, locale, defaultLocale);
  const header = isObj(data.header) ? { ...data.header } : {};
  const footer = isObj(data.footer) ? { ...data.footer } : {};
  if (typeof p.logoUrl === 'string') {
    const url = p.logoUrl.trim();
    // 清空 ⟹ 连「图里自带店名吗」一起去掉（没图本来就照店名画）；换图 ⟹ 那一格照构建那份（存盘那一侧同样不碰它，`editor-root.js` 写 logoUrl 那段）。
    //   #1784 r7 起编辑器里换图都在 Logo 子页的 Image 下，换的那一下就把 logoType 存成 image（`EditorApp.tsx` §LogoSubPage），用不着这一格定默认。
    for (const d of [header, footer]) {
      if (url) d.logo = url; else { delete d.logo; delete d.logoHasWordmark; }
    }
  }
  if (Array.isArray(p.headerButtons)) header.buttons = headerButtonsData(p.headerButtons, loc);
  // #1780 —— 顶栏上面那一行：同构建一条规则（`topbar-links.js` §topbarContact），引用照旧由 SiteShell 展开。
  if (Array.isArray(p.headerTopbar)) {
    const tb = isObj(header.topbar) ? header.topbar : {};
    header.topbar = { ...tb, contact: topbarContact(p.headerTopbar, loc) };
  }
  if (Array.isArray(p.headerLinks)) {
    // 名字非空、链接是白名单里的字符串或引用的那一项（同 `shell-data.js` §links）；画不出的 ⟹ null。
    const one = (l, at) => {
      const label = isObj(l) ? str(l.label).trim() : '';
      if (!label) return null;
      if (isMenuRef(l.href)) return { label, href: { ...l.href }, editorIndex: at };
      if (str(l.href).trim() && hrefAllowed(str(l.href).trim())) return { label, href: loc(str(l.href).trim()), editorIndex: at };
      return null;
    };
    const items = [];
    p.headerLinks.forEach((l, i) => {
      const it = one(l, i);
      if (!it) return;
      // #1783 —— 下拉：子项的 `editorIndex` 是 `"<i>.<j>"`（顶栏块据它挂 `data-editor-region-link="nav.<i>.<j>"`）。
      const kids = isObj(l) && Array.isArray(l.children) ? l.children.map((c, j) => {
        const k = one(c, `${i}.${j}`);
        if (k && isObj(c) && str(c.description).trim()) k.description = str(c.description).trim();
        return k;
      }).filter(Boolean) : [];
      if (kids.length) it.children = kids;
      items.push(it);
    });
    header.nav = items;
    footer.nav = items.map(({ editorIndex, children, ...rest }) => rest); // eslint-disable-line no-unused-vars
  }
  return { header, footer };
}

module.exports = { NAV_LABEL_MAX, NAV_DESC_MAX, isMenuRef, menuItemProblem, childrenProblem, menuLinksProblem, moveItem, liveShellData };
