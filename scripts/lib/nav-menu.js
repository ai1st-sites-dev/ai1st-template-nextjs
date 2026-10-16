'use strict';

// nav-menu.js —— 顶栏菜单 / 页脚第一列「从页面推出来」的那一条规则（#1759 从 `derive-site.js` 原样抽出来）。**纯函数、零 require**。
//
// 两处用它，必须是同一份：
//   · `scripts/derive-site.js` —— 构建时按 §syncMenu 维护 `navigation.json` 的 `header.links` / `header.knownPages`
//   · 编辑器 —— 站内链接按语言加前缀（§localizeHref，`nav-editor.js` §liveShellData 画画布预览）
//
// 规则：
//   · 首项恒为首页，名字 = 首页的 `navLabel` → 这种语言的默认叫法（§HOME_LABELS）→ 'Home'
//   · 其余 = 普通页（调用方已经去掉关键词页、服务详情页，并按 `navOrder` 排好），`navLabel` 非空的才进
//   📌 #1781 —— 这条规则只在**第一次**用：菜单从此是老板自己的一份列表（`navigation.json` 的 `header.links`），构建只在它
//      还不在时按这里算一次（§syncMenu）。原来顶栏还去掉主按钮指向的那一页（`p.slug !== ctaSlug`），随 #1781 删掉 ——
//      菜单里有什么由老板定，页脚第一列跟顶栏是同一份。

// TICKET-133: defensive fallback for the home page navLabel. AI translation
// and translatePageWithClaude both already translate page.navLabel, so the
// happy path is `homePage.navLabel` — this map is only used when navLabel is
// missing (old sites pre-122a / partial translation failure / etc).
const HOME_LABELS = {
  en: 'Home', zh: '首页', fr: 'Accueil', es: 'Inicio',
  ja: 'ホーム', ko: '홈', de: 'Startseite', it: 'Home',
  pt: 'Início', ru: 'Главная', vi: 'Trang chủ',
  ar: 'الرئيسية', hi: 'होम', th: 'หน้าแรก',
};

/** 首页在菜单里叫什么。 */
function homeLabelOf(homeNavLabel, locale) {
  return homeNavLabel || HOME_LABELS[locale] || 'Home';
}

/**
 * 从页面推出来的那一份菜单（首页 + `navLabel` 非空的普通页）。#1781 起只在 `header.links` 还不在时用一次（§syncMenu）。
 * @param {object} a
 * @param {string} a.homeLabel   §homeLabelOf 的结果
 * @param {{ slug: string, navLabel?: string }[]} a.regular  普通页，已按 `navOrder` 排好
 * @returns {{ label: string, href: string }[]}
 */
function menuLinks({ homeLabel, regular }) {
  return [
    { label: homeLabel, href: '/' },
    ...regular
      .filter((p) => p.navLabel)
      .map((p) => ({ label: p.navLabel, href: `/${p.slug}` })),
  ];
}

const pageHref = (slug) => `/${slug}`;

const isItem = (l) => !!l && typeof l === 'object' && !Array.isArray(l);

/** 一项的拷贝：#1783 起连 `children` 那个数组（和里面每一项）一起拷 —— §syncMenu 不改入参。 */
function copyItem(l) {
  if (!isItem(l)) return l;
  const c = { ...l };
  if (Array.isArray(l.children)) c.children = l.children.map((x) => (isItem(x) ? { ...x } : x));
  return c;
}

/**
 * #1783 —— 页脚第一列 = 菜单的**顶层**（下拉里的子项不进页脚）。构建写页脚（`derive-site.js`）和 AI 改站那道门判「页脚第一列跟着菜单」
 * （`navigation-owned.js` 的 `mirrorOf`）用的是这一个函数。不改入参。
 */
function topLevelLinks(links) {
  return Array.isArray(links) ? links.map((l) => {
    if (!isItem(l)) return l;
    const { children, ...rest } = l; // eslint-disable-line no-unused-vars
    return rest;
  }) : links;
}

/**
 * #1781 —— 每次构建对菜单做的全部事情。菜单是老板的数据（`header.links`），构建只做三件事：
 *   · 还没有菜单（新站第一次构建）⟹ 按 §menuLinks 算一份（今天的结果）。
 *   · 新出现的普通页（不在 `knownPages` 里）⟹ 追加到菜单末尾，名字 = `navLabel` → `title` → slug。老板删掉的那一项不会被加回来
 *     （它的 slug 已经在 `knownPages` 里）。菜单里已经有一项指着它（老板先手填了 `/faq`、或 AI 同一笔建页 + 加菜单项）⟹ 只记进
 *     `knownPages`、不再追加（#1781 r5，QA3 r4 T2：否则顶栏和页脚各多一条重复的）。
 *   · 页面没了（在 `knownPages` 里、这次不在普通页里）⟹ 菜单里指向它的那几项一起去掉。
 *     #1783 —— 下拉里（`children`）指向它的子项也一起去掉；新页面只追加到顶层。子项指着的页也算「菜单里已经有一项指着它」
 *     （否则老板放进下拉的那一页，下一次构建又在顶层多出一条）。
 * `knownPages` 还不在（#1781 之前的站、或新站第一次构建）⟹ 当成「现在这些普通页都见过了」：老站已有的菜单一项不加、一项不减。
 * 🔴 纯函数，**不改入参**（`navigation-owned.test.js` ③ 认得出把 navigation.json 的值传给它，前提就是这一条，那份测试里有一格专门量它）。
 * @param {object} a
 * @param {unknown} a.links       `header.links` 的现值（不是数组 = 还没有）
 * @param {unknown} a.knownPages  `header.knownPages` 的现值（不是数组 = 还没有）
 * @param {string} a.homeLabel
 * @param {{ slug: string, navLabel?: string, title?: string }[]} a.regular  这一次构建的普通页，已按 `navOrder` 排好
 * @returns {{ links: object[], knownPages: string[] }}
 */
function syncMenu({ links, knownPages, homeLabel, regular }) {
  const slugs = regular.map((p) => p.slug);
  const now = new Set(slugs);
  if (!Array.isArray(links)) return { links: menuLinks({ homeLabel, regular }), knownPages: slugs };
  const copy = links.map(copyItem);
  if (!Array.isArray(knownPages)) return { links: copy, knownPages: slugs };
  const known = knownPages.filter((s) => typeof s === 'string');
  const knownSet = new Set(known);
  const gone = new Set(known.filter((s) => !now.has(s)).map(pageHref));
  const alive = (l) => !(l && typeof l === 'object' && typeof l.href === 'string' && gone.has(l.href));
  const kept = copy.filter(alive);
  for (const l of kept) if (isItem(l) && Array.isArray(l.children)) l.children = l.children.filter(alive);
  const added = regular.filter((p) => !knownSet.has(p.slug));
  const pointedAt = new Set(kept.flatMap((l) => (isItem(l) ? [l, ...(Array.isArray(l.children) ? l.children : [])] : []))
    .map((l) => (l && typeof l === 'object' ? l.href : undefined)).filter((h) => typeof h === 'string'));
  for (const p of added) {
    if (!pointedAt.has(pageHref(p.slug))) kept.push({ label: p.navLabel || p.title || p.slug, href: pageHref(p.slug) });
  }
  return { links: kept, knownPages: [...known.filter((s) => now.has(s)), ...added.map((p) => p.slug)] };
}

/**
 * #1759 —— 从 `shell-data.js` 原样搬来（那边照旧导出它）：编辑器预览也要它，而 shell-data 拖着关键词页那一串 require。
 * 站内链接按语言加前缀（TICKET-129：默认语言走根路径，其余语言 `/<locale>/…`）。旧库的 header / footer 渲染时各自
 * 调一份 `localizeHref`；新库的块是纯 props、不知道自己在哪种语言下 ⟹ 这一步挪到派生这里做（#1425 QA2 r1 F2：
 * 漏了它，`/zh/*` 上顶栏页脚的每个链接都指回英文页）。判法逐字照旧那份：只动 `/` 开头、不是 `//` 的。
 */
function localizeHref(href, locale, defaultLocale) {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (!locale || locale === defaultLocale) return href;
  if (href === '/') return `/${locale}`;
  return `/${locale}${href}`;
}

module.exports = { HOME_LABELS, homeLabelOf, menuLinks, syncMenu, topLevelLinks, localizeHref };
