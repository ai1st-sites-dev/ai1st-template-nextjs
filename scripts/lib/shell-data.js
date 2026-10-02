'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// shell-data.js —— 站点外壳（顶栏 / 页脚）的 data，构建期从站自己已有的文件派生（#1425 T3）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 旧库的 header / footer 自己去读 navigation.json / brand.json / services.json；新库的 header / footer
// 是纯 props 组件（`{ data, shape, iconTable }`）。这里就是把前者翻成后者的那一处 —— PM 2026-10-02 在 #1425
// 裁的方案 A：**不新增站级文件**，派生在构建期（`sync-config.js` 调它，产物写进 `config-data.ts` 的
// `regions.<区>.dataByLocale`），`SiteShell` 只往下传。
//
// 🔴 内容只存一份（Chris 2026-09-30 #1505）：导航链接仍然只住在 navigation.json，老板改它的三条路
//    （编辑器 · AI 改站 · `navigation-owned.js`）一个都不用动；这里产出的是构建产物，不落盘到 `site/`。
// 🔴 联系方式 / 社交链接写成引用，不抄值（Chris 2026-09-30 #1506）：`topbar.contact` 每项是
//    `{source: …}`，页脚的 `contact` / `social` 是整槽引用 —— 渲染前由 `resolveItemSources` 展开
//    （`src/lib/sections/item-sources.ts`，跟页面块同一个入口）。
// 🔴 派生不到的维度不造数据（PM 裁定）：`legal` · `footer.cta` · `columns.areas` · `form` · `ctaSecondary`
//    · `topbar.links` / `topbar.social` 一律不写，块按预设默认画或留空。不许编内容填进去。
//    navigation.json 里**本来就有**的两格照搬：`footer.description` → `tagline`、`footer.copyright` →
//    `copyright`（旧页脚画的是 `© 年份 {copyright}`，这里拼成同一句）。
// 📌 已知能力差（写进 #1425 交付说明）：
//    · `footer.columns[1..]`（构建按服务分组的关键词页链接栏）在新页脚里没有槽 ⟹ 不再画；
//    · `footer.columns[].title`（栏目标题）同理；
//    · navigation.json 的 `topbar`（一句话公告）随公告条那个区退役，**数据不删、只是不再读**。

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
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

/** `[{label, href}]` 里两样都是非空字符串的那几项，只留这两个键；href 按语言加前缀。 */
function links(list, loc) {
  return (Array.isArray(list) ? list : [])
    .filter((l) => isObj(l) && str(l.label) && str(l.href))
    .map((l) => ({ label: str(l.label), href: loc(str(l.href)) }));
}

/**
 * 一种语言的外壳 data。
 * @param {object} o
 * @param {object} o.nav        这种语言的 navigation.json（构建刚重写过的那一份）
 * @param {object} o.brand      brand.json
 * @param {string} o.brandName  这种语言的生意名（`getBrandName` 同一个取法）
 * @param {Array}  o.services   这种语言的 services.json
 * @param {Array}  o.pages      这种语言的页面（只看 `slug`）
 * @param {string} [o.locale]        这一份是哪种语言的（不传 = 不加前缀）
 * @param {string} [o.defaultLocale] 站的默认语言（它走根路径，不加前缀）
 * @param {number} [o.year]     版权行的年份（默认今年；测试钉一个数）
 * @returns {{ header: object, footer: object }}
 */
function shellDataFor({ nav, brand, brandName, services, pages, locale, defaultLocale, year = new Date().getFullYear() }) {
  const loc = (href) => localizeHref(href, locale, defaultLocale);
  const n = isObj(nav) ? nav : {};
  const h = isObj(n.header) ? n.header : {};
  const f = isObj(n.footer) ? n.footer : {};
  const logo = isObj(brand) ? str(brand.logoUrl) : '';
  const name = str(brandName);

  const header = {};
  if (logo) header.logo = logo;
  if (name) header.brandName = name;
  header.nav = links(h.links, loc);
  if (isObj(h.cta) && str(h.cta.label) && str(h.cta.href)) {
    header.ctaPrimary = { label: str(h.cta.label), href: loc(str(h.cta.href)), style: 'solid' };
  }
  // 只有带 topbar 的预设才画这一条；值不存在的那一项展开时自己去掉（item-sources.js §ITEM_SLOTS）。
  header.topbar = { contact: [{ source: 'phone' }, { source: 'email' }] };

  const columns = Array.isArray(f.columns) ? f.columns : [];
  const hasPage = new Set((Array.isArray(pages) ? pages : []).map((p) => p && p.slug));
  // 服务那一栏的链接规则照旧页脚（有详情页去详情页，没有就落到服务页上它那一节）。
  const serviceLinks = (Array.isArray(services) ? services : [])
    .filter((s) => isObj(s) && str(s.id) && str(s.name))
    .map((s) => ({ label: str(s.name), href: loc(hasPage.has(`services/${s.id}`) ? `/services/${s.id}` : `/services#${s.id}`) }));

  const footer = {};
  if (logo) footer.logo = logo;
  if (name) footer.brandName = name;
  if (str(f.description)) footer.tagline = str(f.description);
  footer.nav = links(columns[0] && columns[0].links, loc);
  footer.columns = { services: serviceLinks, contact: true };
  footer.contact = { source: 'brand' };
  footer.social = { source: 'social' };
  // AI 建站写的是「<生意名>. All rights reserved.」（不带年份），旧页脚在前面补「© 年份」；
  // skipAI 示例站那一份自己已经带着 ©，就照原样（旧页脚在那上面会印出两遍 ©）。
  const copyright = str(f.copyright);
  if (copyright) footer.copyright = copyright.startsWith('©') ? copyright : `© ${year} ${copyright}`;
  return { header, footer };
}

module.exports = { shellDataFor, localizeHref };
