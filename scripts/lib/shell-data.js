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
// 🔴 派生不到的维度不造数据（PM 裁定）：`columns.areas` · `form` · `topbar.links` / `topbar.social` 一律不写，
//    块按预设默认画或留空。不许编内容填进去（三处的理由在 #1529 正文「不做」）。
//    navigation.json 里**本来就有**的两格照搬：`footer.description` → `tagline`、`footer.copyright` →
//    `copyright`（旧页脚画的是 `© 年份 {copyright}`，这里拼成同一句）。
// 📌 #1529：老板能写进 navigation.json 的三格（AI 改站那条路，`navigation-owned.js` 把门），**写了才派生，没写就不进 data**：
//    `header.ctaSecondary {label, href}` → 顶栏副按钮（补 `style: 'outline'`，跟主按钮补 `solid` 对称）·
//    `footer.legal [{label, href}]` → 页脚底栏那排链接 · `footer.cta {title, subtitle?, buttons?}` → 页脚 CTA 条。
//    站内链接都跟 `localizeHref` 走。
// 📌 #1632：关键词页那几栏（按服务分组）现在画了 —— `columns.keywordGroups`，**每次构建从这一语言的当前页面现算**
//    （`keywordFooterColumns`，跟建站、sync-config 同一个函数），只有 `layout=columns` 的两个预设画。
//    🔴 navigation.json 里 `footer.columns[1..]` 那份副本**仍然不读**：sync-config 只在还没有第 1 栏时写它一次
//    （建站之后增删的关键词页进不去 / 删掉的留死链），所以它会陈旧；`footer.columns[].title` 同样不读。
// 📌 navigation.json 的 `topbar`（一句话公告）#1425 随公告条那个区退役时数据没删；#1528 起接回 header 的
//    `topbar.message`（§topbarMessage），老站一个字节不改就能重新看见它 —— 只在带 topbar 的两个预设上画。

const { hrefAllowed } = require('./href-allowed');
const { isKeywordPage } = require('./keyword-service');
const { keywordFooterColumns } = require('./keyword-pages');

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

const BUTTON_STYLES = new Set(['solid', 'outline', 'link']);

/**
 * #1529 的三格用的链接判据：label / href 都是非空字符串，**且** href 过写盘那一关的白名单（`href-allowed.js`）。
 * 🔴 这三格在 #1529 之前不在写盘检查里（navigation.json 的陌生键照写），那时写进去的 `javascript:` 不许因为
 *    本票开始画它而上页面 ⟹ 不过白名单的那一项当没写。
 */
const usableLink = (l) => isObj(l) && !!str(l.label) && !!str(l.href) && hrefAllowed(l.href);

/**
 * `footer.cta`（`{title, subtitle?, buttons?: [{label, href, style?}]}`）→ 页脚块的 `cta` 槽。`title` 是必需的（块没标题
 * 就不画这一条）⟹ 没有就 `undefined`。按钮 label / href 缺一就去掉那一个；`style` 不在 solid | outline | link 里就
 * 丢掉这一格（按钮照画、用块的默认样式），并往 `notes` 里记一行 —— 静默丢跟「老板没写」长得一样（PM #1529 裁定）。
 */
function footerCta(cta, loc, notes) {
  if (!isObj(cta) || !str(cta.title)) return undefined;
  const out = { title: str(cta.title) };
  if (str(cta.subtitle)) out.subtitle = str(cta.subtitle);
  const buttons = (Array.isArray(cta.buttons) ? cta.buttons : [])
    .map((b, i) => [b, i])
    .filter(([b]) => usableLink(b))
    .map(([b, i]) => {
      const one = { label: str(b.label), href: loc(str(b.href)) };
      if (b.style !== undefined) {
        if (BUTTON_STYLES.has(b.style)) one.style = b.style;
        else notes.push(`navigation.json footer.cta.buttons[${i}].style = ${JSON.stringify(b.style)} 不是 solid | outline | link —— 这一格丢掉，按钮用默认样式`);
      }
      return one;
    });
  if (buttons.length) out.buttons = buttons;
  return out;
}

/**
 * navigation.json 的 `topbar`（老公告条的形状：`{message: string, link?: {label, href}}`）→ header 的
 * `topbar.message`（`{text, href?, label?}`）。#1528：老站的数据原样接回，不要求改文件。
 * 只填了链接、没填文字（老编辑器允许这么存）⟹ 链接文字当那句话、整句是链接。两样都没有 ⟹ `undefined`（不写这一格）。
 * 🔴 地址不在白名单里（`href-allowed.js`，写盘那一关同一个函数）⟹ 当没有链接、只画字：#1425 到 #1528 之间
 *    `topbar.link` 不在写盘检查里（那时它不画），那段时间写进去的 `javascript:` 不许因为本票重新画到页面上。
 */
function topbarMessage(tb, loc) {
  if (!isObj(tb)) return undefined;
  const link = isObj(tb.link) ? tb.link : {};
  const href = str(link.href) && hrefAllowed(link.href) ? loc(str(link.href)) : '';
  const label = str(link.label);
  const text = str(tb.message) || (href ? label : '');
  if (!text) return undefined;
  const m = { text };
  if (href) m.href = href;
  if (href && label && text !== label) m.label = label;
  return m;
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
 * @returns {{ header: object, footer: object, notes: string[] }}  `notes` = 构建该说一声的事（sync-config 打出来）
 */
function shellDataFor({ nav, brand, brandName, services, pages, locale, defaultLocale, year = new Date().getFullYear() }) {
  const loc = (href) => localizeHref(href, locale, defaultLocale);
  const n = isObj(nav) ? nav : {};
  const h = isObj(n.header) ? n.header : {};
  const f = isObj(n.footer) ? n.footer : {};
  const logo = isObj(brand) ? str(brand.logoUrl) : '';
  const name = str(brandName);
  const notes = [];

  const header = {};
  if (logo) header.logo = logo;
  if (name) header.brandName = name;
  header.nav = links(h.links, loc);
  if (isObj(h.cta) && str(h.cta.label) && str(h.cta.href)) {
    header.ctaPrimary = { label: str(h.cta.label), href: loc(str(h.cta.href)), style: 'solid' };
  }
  if (usableLink(h.ctaSecondary)) {
    header.ctaSecondary = { label: str(h.ctaSecondary.label), href: loc(str(h.ctaSecondary.href)), style: 'outline' };
  }
  // 只有带 topbar 的预设才画这一条；值不存在的那一项展开时自己去掉（item-sources.js §ITEM_SLOTS）。
  header.topbar = { contact: [{ source: 'phone' }, { source: 'email' }] };
  const message = topbarMessage(n.topbar, loc);
  if (message) header.topbar = { message, ...header.topbar };

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
  // #1632 —— 关键词页栏从当前页面现算（§文件头）。先去掉首页，跟 sync-config 同一个过滤（keywordFooterColumns 对认不出
  // 服务 id 的页按 slug 第一段分组，整份 pages 喂进去会让每张普通页自成一栏）。
  const kwPages = (Array.isArray(pages) ? pages : []).filter((p) => p && p.slug !== 'home' && isKeywordPage(p));
  const keywordGroups = kwPages.length
    ? keywordFooterColumns(kwPages, services, locale)
      .map((g) => ({ title: str(g.title), links: links(g.links, loc) }))
      .filter((g) => g.title && g.links.length)
    : [];
  if (keywordGroups.length) footer.columns.keywordGroups = keywordGroups; // 没有关键词页就不写这个键
  footer.contact = { source: 'brand' };
  footer.social = { source: 'social' };
  // AI 建站写的是「<生意名>. All rights reserved.」（不带年份），旧页脚在前面补「© 年份」；
  // skipAI 示例站那一份自己已经带着 ©，就照原样（旧页脚在那上面会印出两遍 ©）。
  const copyright = str(f.copyright);
  if (copyright) footer.copyright = copyright.startsWith('©') ? copyright : `© ${year} ${copyright}`;
  const legal = links((Array.isArray(f.legal) ? f.legal : []).filter(usableLink), loc);
  if (legal.length) footer.legal = legal;
  const cta = footerCta(f.cta, loc, notes);
  if (cta) footer.cta = cta;
  return { header, footer, notes };
}

module.exports = { shellDataFor, localizeHref };
