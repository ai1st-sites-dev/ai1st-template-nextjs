'use strict';

// nav-menu.js —— 顶栏菜单 / 页脚第一列「从页面推出来」的那一条规则（#1759 从 `derive-site.js` 原样抽出来）。**纯函数、零 require**。
//
// 两处用它，必须是同一份：
//   · `scripts/derive-site.js` —— 构建时把它写进 `navigation.json` 的 `header.links` / `footer.columns[0].links`
//   · 编辑器（`EditorApp.tsx` §withHeaderContent）—— 顶栏 Content 页里改名 / 拖顺序 / 隐藏 / 改按钮链接时，画布上当场按它重画
// 🔴 预览用另一条规则 = 老板眼前那一版跟发布后不是同一个菜单（#1759 PM 裁定第二轮第 1 条）。
//
// 规则（构建一直是这样，本票没改）：
//   · 首项恒为首页，名字 = 首页的 `navLabel` → 这种语言的默认叫法（§HOME_LABELS）→ 'Home'
//   · 其余 = 普通页（调用方已经去掉关键词页、服务详情页，并按 `navOrder` 排好），`navLabel` 非空的才进
//   · 顶栏再去掉顶栏主按钮指向的那一页（它就是右边那颗按钮）；页脚第一列不去这一道

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

/** 顶栏主按钮指向哪一页（`/contact` → `contact`）。不是字符串 ⟹ ''（构建那头对它调 `.replace`，编辑器只会给字符串）。 */
function ctaSlugOf(ctaHref) {
  return typeof ctaHref === 'string' ? ctaHref.replace(/^\//, '') : '';
}

/**
 * @param {object} a
 * @param {string} a.homeLabel   §homeLabelOf 的结果
 * @param {{ slug: string, navLabel?: string }[]} a.regular  普通页，已按 `navOrder` 排好
 * @param {string} a.ctaSlug     顶栏主按钮指向的那一页（§ctaSlugOf 的结果；构建那头是 `header.cta.href.replace(/^\//, '')`）
 * @returns {{ header: { label: string, href: string }[], footer: { label: string, href: string }[] }}
 */
function menuLinks({ homeLabel, regular, ctaSlug }) {
  const header = [
    { label: homeLabel, href: '/' },
    ...regular
      .filter((p) => p.navLabel && p.slug !== ctaSlug)
      .map((p) => ({ label: p.navLabel, href: `/${p.slug}` })),
  ];
  const footer = [
    { label: homeLabel, href: '/' },
    ...regular
      .filter((p) => p.navLabel)
      .map((p) => ({ label: p.navLabel, href: `/${p.slug}` })),
  ];
  return { header, footer };
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

module.exports = { HOME_LABELS, homeLabelOf, ctaSlugOf, menuLinks, localizeHref };
