'use strict';

// nav-editor.js —— 编辑器顶栏 Content 页的「Navigation links」在浏览器那一侧的全部算法（#1759）。纯函数，只 require 三份零依赖的库
// （`nav-menu.js` 菜单规则、`header-buttons.js` 顶栏按钮规则（#1787）、`topbar-links.js` 顶栏上面那一行（#1780）），所以编辑器页（客户端）能直接 import，`editor-nav.test.js` 也能逐条量。
//
// 面板里那一份（存在 Puck root 的 `navMenu` 里，跟别的外壳字段同一个事务：Design 面板 Done / Cancel、撤销、自动存）：
//   { home: { label, title }, items: [{ slug, title, label, shown, order? }] }
//   · `items` 是这种语言**全部**能进菜单的普通页（含按钮指向的那一页、含隐藏着的），顺序 = 构建的顺序（navOrder）。
//     面板列表只是它的一个视图：显示着的、不是按钮那一页的，按这个顺序；隐藏着的排在最后、名字灰掉；按钮那一页不列。
//   · `label` 是输入框里那个字；隐藏着的页 `label` 是它的标题（显示回来就用它，票正文那张表的最后一行）。
//   · `order` 是打开时这一页的 navOrder（没写就没有这个键），重新编号时只交跟它不一样的那几页。
//
// 规矩（票正文做什么 3）：
//   · 拖动只在「显示着、不是按钮那一页」的那几格之间换位，它们占的那几个位置不变 ⟹ 按钮那一页、隐藏着的页在全部页的顺序里
//     保持原来的相对位置（页脚第一列不去按钮那一页，只在顶栏里拖了一下不该让它在页脚里挪位）。
//   · 隐藏 = 原地关掉（列表里挪到最后只是显示）；显示回来 = 名字写回标题、挪到最后一个显示着的后面。
//   · 存盘时比打开时那一份：名字 / 显示变了的交 navLabel（隐藏 = null）；全部页的先后变了才重新编号 1..n。
//     正在编辑的这一页不进 `nav`，并进这一笔的页面 JSON（`lib/editor-nav.js` 文件头说为什么）。

const { menuLinks, homeLabelOf, ctaSlugOf, localizeHref } = require('./nav-menu');
const { headerButtonsData } = require('./header-buttons');
const { topbarContact } = require('./topbar-links');

/** 跟写盘那一侧（`lib/editor-nav.js` §NAV_LABEL_MAX）同一个数。 */
const NAV_LABEL_MAX = 40;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * 底稿 / 构建那一份（`lib/editor-nav.js` §navMenuOf 的结果）→ 面板里那一份。形状不对 ⟹ null。
 * 首页那一格的名字跟构建同一条（§homeLabelOf）：首页没写 `navLabel` 的老站，画布 / 网站上它叫 "Home"，
 * 面板里不许是空的 —— 空的话 §navMenuProblem 把整个顶栏面板的 Done 都拦下（#1759 QA3 退回）。
 * 打开时这一份就是 §navMenuChanges 的比较基准 ⟹ 没动过的首页名字两边都是兜底值，不会被当成改动写盘。
 */
function navMenuToPanel(nav, locale) {
  if (!isObj(nav) || !Array.isArray(nav.pages)) return null;
  const home = isObj(nav.home) ? nav.home : {};
  return {
    home: { label: homeLabelOf(str(home.navLabel), locale), title: str(home.title) },
    items: nav.pages.filter((p) => isObj(p) && typeof p.slug === 'string' && p.slug).map((p) => {
      const shown = !!str(p.navLabel).trim();
      return {
        slug: p.slug,
        title: str(p.title),
        label: shown ? str(p.navLabel) : (str(p.title) || p.slug),
        shown,
        ...(Number.isFinite(p.navOrder) ? { order: p.navOrder } : {}),
      };
    }),
  };
}

/** 面板列表那个视图：显示着的（不含按钮那一页）按顺序，再接隐藏着的。回的每一项带它在 `items` 里的下标 `at`。 */
function panelRows(menu, ctaHref) {
  const cta = ctaSlugOf(ctaHref);
  const rows = (menu && Array.isArray(menu.items) ? menu.items : []).map((it, at) => ({ ...it, at })).filter((it) => it.slug !== cta);
  return [...rows.filter((r) => r.shown), ...rows.filter((r) => !r.shown)];
}

/** 列表下面那句灰字点名的那一页（按钮指向它）；按钮不指向菜单里的页 ⟹ null。 */
function buttonPage(menu, ctaHref) {
  const cta = ctaSlugOf(ctaHref);
  return (menu && Array.isArray(menu.items) ? menu.items : []).find((it) => it.slug === cta) || null;
}

/** 显示着的第 `from` 格拖到第 `to` 格（下标都是「显示着、不是按钮那一页」那几格里的）。别的页原地不动。 */
function moveShown(menu, ctaHref, from, to) {
  const cta = ctaSlugOf(ctaHref);
  const slots = menu.items.map((it, i) => (it.shown && it.slug !== cta ? i : -1)).filter((i) => i >= 0);
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return menu;
  const seq = slots.map((i) => menu.items[i]);
  const [it] = seq.splice(from, 1);
  seq.splice(to, 0, it);
  const items = menu.items.slice();
  slots.forEach((i, k) => { items[i] = seq[k]; });
  return { ...menu, items };
}

/** 显示 / 隐藏一页。显示回来：名字写回标题、挪到最后一个显示着的（不是按钮那一页）后面。 */
function setShown(menu, ctaHref, slug, shown) {
  const at = menu.items.findIndex((it) => it.slug === slug);
  if (at < 0 || menu.items[at].shown === shown) return menu;
  const cur = menu.items[at];
  if (!shown) {
    const items = menu.items.slice();
    items[at] = { ...cur, shown: false, label: cur.title || cur.slug };
    return { ...menu, items };
  }
  const cta = ctaSlugOf(ctaHref);
  const rest = menu.items.filter((_, i) => i !== at);
  let last = -1;
  rest.forEach((it, i) => { if (it.shown && it.slug !== cta) last = i; });
  const items = rest.slice();
  items.splice(last + 1, 0, { ...cur, shown: true, label: cur.title || cur.slug });
  return { ...menu, items };
}

/** 改一个链接的名字（`slug === 'home'` 改首页）。 */
function setLabel(menu, slug, label) {
  if (slug === 'home') return { ...menu, home: { ...menu.home, label } };
  return { ...menu, items: menu.items.map((it) => (it.slug === slug ? { ...it, label } : it)) };
}

/** Done / 存盘前要说的那一句（没有问题 ⟹ ''）。只看显示着的 + 首页：隐藏着的名字不进菜单。 */
function navMenuProblem(menu) {
  if (!menu) return '';
  const named = [{ label: menu.home.label }, ...menu.items.filter((it) => it.shown)];
  if (named.some((it) => !str(it.label).trim())) return 'Every link in the menu needs a name. To take a page out of the menu, hide it instead.';
  if (named.some((it) => str(it.label).trim().length > NAV_LABEL_MAX)) return `Menu link names can be up to ${NAV_LABEL_MAX} characters.`;
  return '';
}

/**
 * 跟打开时那一份比，要写什么。`slug` = 正在编辑的这一页：它的改动单独回（并进这一笔的页面 JSON），不进 `nav`。
 * @returns {{ nav: Record<string, { navLabel?: string | null, navOrder?: number }>, page: { navLabel?: string | null, navOrder?: number } | null }}
 */
function navMenuChanges({ initial, now, slug }) {
  const nav = {};
  const add = (s, k, v) => { (nav[s] = nav[s] || {})[k] = v; };
  if (!initial || !now) return { nav, page: null };
  const before = new Map(initial.items.map((it) => [it.slug, it]));
  const effective = (it) => (it.shown ? str(it.label).trim() : '');
  for (const it of now.items) {
    const b = before.get(it.slug);
    if (b && effective(it) !== effective(b)) add(it.slug, 'navLabel', effective(it) || null);
  }
  const order = (m) => m.items.map((it) => it.slug).join('\n');
  if (order(now) !== order(initial)) {
    now.items.forEach((it, i) => { if (before.has(it.slug) && before.get(it.slug).order !== i + 1) add(it.slug, 'navOrder', i + 1); });
  }
  if (str(now.home.label).trim() !== str(initial.home.label).trim()) add('home', 'navLabel', str(now.home.label).trim());
  const page = nav[slug] || null;
  delete nav[slug];
  return { nav, page };
}

/** 一页的 JSON 换上 §navMenuChanges 的 `page` 那一份（navLabel: null = 删键）。不改入参。 */
function applyPageNav(json, change) {
  if (!change || !isObj(json)) return json;
  const out = { ...json };
  if ('navLabel' in change) { if (change.navLabel === null) delete out.navLabel; else out.navLabel = change.navLabel; }
  if ('navOrder' in change) out.navOrder = change.navOrder;
  return out;
}

/**
 * 画布预览：构建烤进来的顶栏 / 页脚 data（`shell-data.js` 那一份）换上面板里的现值 —— 菜单（同构建一条规则，§menuLinks）、按钮、logo、
 *   顶栏上面那一行的链接（#1780）。
 * 按钮跟构建同一个函数（`header-buttons.js` §headerButtonsData，#1787）。没带的那一样原样。
 * @param {{ header: object, footer: object }} data  这种语言构建那一份（`regions.<区>.dataByLocale[语言]`）
 * @param {object} p  面板现值：{ navMenu?, headerButtons?, logoUrl?, headerTopbar? }
 */
function liveShellData(data, p, locale, defaultLocale) {
  const loc = (href) => localizeHref(href, locale, defaultLocale);
  const header = isObj(data.header) ? { ...data.header } : {};
  const footer = isObj(data.footer) ? { ...data.footer } : {};
  if (typeof p.logoUrl === 'string') {
    if (p.logoUrl.trim()) { header.logo = p.logoUrl.trim(); footer.logo = p.logoUrl.trim(); } else { delete header.logo; delete footer.logo; }
  }
  if (Array.isArray(p.headerButtons)) header.buttons = headerButtonsData(p.headerButtons, loc);
  // #1780 —— 顶栏上面那一行：同构建一条规则（`topbar-links.js` §topbarContact），引用照旧由 SiteShell 展开。
  if (Array.isArray(p.headerTopbar)) {
    const tb = isObj(header.topbar) ? header.topbar : {};
    header.topbar = { ...tb, contact: topbarContact(p.headerTopbar, loc) };
  }
  if (isObj(p.navMenu) && Array.isArray(p.navMenu.items)) {
    const m = p.navMenu;
    // 主按钮 = 第 1 颗（#1787）：它指向的那一页不进顶栏菜单（同构建，`derive-site.js` 的 ctaSlug）。
    const first = Array.isArray(p.headerButtons) && isObj(p.headerButtons[0]) ? p.headerButtons[0] : null;
    const ctaHref = first ? str(first.href).trim() : '';
    const { header: h, footer: f } = menuLinks({
      homeLabel: homeLabelOf(str(m.home && m.home.label).trim(), locale),
      regular: m.items.map((it) => ({ slug: it.slug, navLabel: it.shown ? str(it.label).trim() : '' })),
      ctaSlug: ctaSlugOf(ctaHref),
    });
    const links = (list) => list.filter((l) => l.label && l.href).map((l) => ({ label: l.label, href: loc(l.href) }));
    header.nav = links(h);
    footer.nav = links(f);
  }
  return { header, footer };
}

module.exports = {
  NAV_LABEL_MAX, navMenuToPanel, panelRows, buttonPage, moveShown, setShown, setLabel, navMenuProblem, navMenuChanges, applyPageNav, liveShellData,
};
