#!/usr/bin/env node
/**
 * breadcrumb-links.js — #1176：关键词页的面包屑里那个中间级，只许指向真的会被写出来的页面。
 *
 * ── 治的是什么 ────────────────────────────────────────────────────────────────────────────────
 * 关键词页的面包屑中间那一级指的是**服务详情页**，而服务详情页只在服务数 >= 3 时才被要求生成
 * （`create-site.js` Call 1 的提示词那句 `servicesList.length >= 3`）。没有服务详情页时
 * `serviceDetailMap` 是空的：Call 2 的提示词里整个「SERVICE DETAIL PAGES」清单块被整块省掉，
 * 只剩一个占位符 `<service-slug>` —— 模型看不到任何真路径，于是自己编一个。#1162 真建的两服务站
 * （Cedar Hill Plumbing）上，关键词页的面包屑全部指向 `/services/<某服务>`，而那些页面一个都不存在。
 *
 * 🔴 **为什么提示词那一侧不够，这里还要再核一遍。** 提示词是请求，不是保证 —— 两个方向都量到过：
 *    ① 空 map 时告诉它「省掉中间级」，它仍可能写一个；
 *    ② **非空 map 时它也不一定照抄清单**。这两件事都只能在生成之后按「这个 slug 到底会不会被写出来」
 *    核，核不过就把那一级的 `href` 去掉、只留文字。`PageHeaderSection` 的 `href` 本来就是可选的
 *    （`src/components/sections/PageHeaderSection.tsx:69-73` 那个三元），没有 `href` 时渲染成
 *    `<span>`，面包屑照样读得通。**去掉一个链接和留一个 404 之间，前者对读的人和对 SEO 都更便宜。**
 *
 * 🔴 **只判站内的 href。** 判据要跟 `scripts/check-dead-links.js` 判的那一类对齐：外链
 *    （`https://…` / `mailto:` / `tel:`）和纯锚点不在那道检查的射程里，把它们一起删掉是拿一个没量过
 *    的性质去动产物。相对路径（不以 `/` 开头、又不是外链）照样判 —— 关键词页住在
 *    `/<服务>/<关键词>`，一个相对 href 会被解析成 `/<服务>/<那一段>`，同样是 404。
 *
 * 🔴 **只管面包屑。** 同一个提示词还叫模型把 CTA 指到 `/quote`，那也可能是死链，但 CTA 没了 href
 *    就不是 CTA 了 —— 那一条交给 `scripts/check-dead-links.js` 报出来（本票的决定是「报，不拦」）。
 *
 * ── #1184：光「活着」不够，还要「指对」 ────────────────────────────────────────────────────────
 * 上面那一半只问「这个 slug 会不会被写出来」，所以它对**活着但指错**完全失明：#1176 交付形态的真机
 * 产物上，两个关键词页的面包屑写着 `{label:"Sump Pump Installation", href:"/services/water-heater-repair"}`
 * 和 `…href:"/services/drain-cleaning"` —— 文字写着 A、点进去是 B，而那两页真的存在，死链数是 0。
 * 成因是提示词那一句没给退路（`use one of the SERVICE DETAIL PAGES listed above, verbatim`）：这个
 * 关键词页所属的服务不在清单上，模型只能从清单里挑一个，于是挑了别人的。
 *
 * ⟹ `alignBreadcrumbsToOwnService()` 按「指对没有」再核一次：**只动指向服务详情页的那一级** ——
 *    指到别人家的，自己有详情页就改成自己的、没有就去掉 href 只留文字。`/services` 这种非详情页的
 *    href 一个都不碰（那不是这条病），CTA 之类照旧由 `scripts/check-dead-links.js` 报。
 *
 * 🔴 **两个键各派生一次，不单靠 `parentService`。** 那个字段是 Call 1 的 AI 写的（提示词只说
 *    `parentService: "{service-id}"`），而对齐用的键在关键词页那边是代码算出来的 `serviceSlug`
 *    （`create-site.js` 的 `keywordPagesFrom`）。所以详情页那边同时按 `parentService` 和它自己 slug
 *    的末段各记一次 —— AI 把 `parentService` 写成显示名（`"Drain Cleaning"`）时也还对得上。
 *
 * 🔴 **抽成一个文件是为了能被单独测。** 这段逻辑住在 `create-site.js` 的 `main()` 里时，唯一的
 *    体检方式是真跑一次 AI 建站，而**那件事是不确定的**：同一份两服务的 payload，一次 AI 照着
 *    「Skip service detail pages」跳过了（#1162 那个站），另一次它照样生成了两页服务详情页
 *    （本票 2026-08-24 的 `dev2-1176-before` 那一跑）—— 两跑都真，而只有前者能让那条死链出现。
 *    一个只有在硬币翻对面时才红得出来的检查，等于没有检查。
 */

'use strict';

/** 站内 href → 拿来跟页面 slug 比的那个形态；判不了（外链/纯锚点）返回 null。 */
function slugFromHref(href) {
  if (typeof href !== 'string') return null;
  const trimmed = href.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#')) return null;              // 纯锚点，留在当前页
  if (trimmed.startsWith('//')) return null;             // 协议相对 = 外链
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // https: / mailto: / tel: / data:
  return trimmed.replace(/[#?].*$/, '').replace(/^\/+|\/+$/g, '');
}

/**
 * 把 `keywordPages` 里 page-header 面包屑上指向「不会存在的页面」的 href 去掉（原地改）。
 *
 * @param {Array<{slug?: string, sections?: Array<{type?: string, data?: object}>}>} keywordPages
 * @param {Iterable<string>} knownSlugs 这个站最终会写出来的全部页面 slug（含关键词页自己）
 * @returns {string[]} 每去掉一个 href 记一条 `"<页面 slug>: <被去掉的 href>"`，顺序即遍历顺序
 */
function pruneDeadBreadcrumbHrefs(keywordPages, knownSlugs) {
  const known = knownSlugs instanceof Set ? knownSlugs : new Set(knownSlugs || []);
  const dropped = [];
  for (const page of keywordPages || []) {
    for (const section of page.sections || []) {
      if (section.type !== 'page-header') continue;
      const crumbs = section.data && section.data.breadcrumbs;
      if (!Array.isArray(crumbs)) continue;
      for (const crumb of crumbs) {
        if (!crumb || typeof crumb.href !== 'string') continue;
        const slug = slugFromHref(crumb.href);
        if (slug === null) continue;
        // '' 是首页（`/`），它总是存在；'home' 是首页那个 slug 的字面写法。
        if (slug === '' || slug === 'home' || known.has(slug)) continue;
        dropped.push(`${page.slug}: ${crumb.href}`);
        delete crumb.href;
      }
    }
  }
  return dropped;
}

/** 服务名 / 服务 id → 对齐用的键。跟 `create-site.js` 的 `keywordPagesFrom` 那条 slugify 是同一套。 */
function serviceKey(name) {
  if (typeof name !== 'string') return null;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return key === '' ? null : key;
}

/**
 * 从 Call 1 的页面清单里认出服务详情页。
 *
 * @param {Array<{slug?: string, parentService?: string, serviceDetailPage?: boolean}>} sitePages
 * @returns {{byServiceKey: Map<string,string>, detailSlugs: Set<string>}}
 *   `byServiceKey` 两个键各记一次（见文件头 #1184 那段）；`detailSlugs` 是「哪些 slug 是服务详情页」。
 */
function serviceDetailIndex(sitePages) {
  const byServiceKey = new Map();
  const detailSlugs = new Set();
  for (const page of sitePages || []) {
    if (!page || !page.serviceDetailPage) continue;
    const slug = slugFromHref(`/${String(page.slug || '')}`);
    if (!slug) continue;
    detailSlugs.add(slug);
    for (const key of [serviceKey(page.parentService), serviceKey(slug.split('/').pop())]) {
      if (key && !byServiceKey.has(key)) byServiceKey.set(key, slug);
    }
  }
  return { byServiceKey, detailSlugs };
}

/**
 * 让关键词页面包屑上那个服务级**指向它自己那个服务**的详情页（原地改）。
 *
 * @param {Array<{slug?: string, sections?: Array<{type?: string, data?: object}>}>} keywordPages
 *        AI 生成的关键词页
 * @param {Array<{slug?: string, parentService?: string, serviceDetailPage?: boolean}>} sitePages
 *        Call 1 出的页面清单（服务详情页在里面）
 * @param {Array<{nestedSlug?: string, service?: string, serviceSlug?: string}>} keywordPagesList
 *        每个关键词页属于哪个服务（`create-site.js` 的 `keywordPagesFrom` 的产物）
 * @returns {string[]} 每改一处记一条人话，顺序即遍历顺序
 */
function alignBreadcrumbsToOwnService(keywordPages, sitePages, keywordPagesList) {
  const { byServiceKey, detailSlugs } = serviceDetailIndex(sitePages);
  const ownByPageSlug = new Map();
  for (const kp of keywordPagesList || []) {
    if (!kp || typeof kp.nestedSlug !== 'string') continue;
    const key = serviceKey(kp.serviceSlug) || serviceKey(kp.service);
    ownByPageSlug.set(kp.nestedSlug, {
      serviceName: typeof kp.service === 'string' ? kp.service : '',
      detailSlug: (key && byServiceKey.get(key)) || null,
    });
  }

  const changes = [];
  for (const page of keywordPages || []) {
    const own = page && typeof page.slug === 'string' ? ownByPageSlug.get(page.slug) : null;
    if (!own) continue;   // 这一页不在关键词页清单里 ⟹ 不知道它属于哪个服务，不猜
    // 🔴 两种形状都读（#998）：AI 交回来的是 `sections`，而**写盘那一刻** `pageWithBlocks` 把它搬成
    //    `blocks`。真跑里这个函数拿到的是前者，但只认前者会让「拿盘上那份产物来跑一遍」静默变成空操作
    //    —— 我自己第一版就这么读到了 `changes: []`，而那两页的 href 明明是错的。
    for (const section of page.sections || page.blocks || []) {
      if (section.type !== 'page-header') continue;
      const crumbs = section.data && section.data.breadcrumbs;
      if (!Array.isArray(crumbs)) continue;

      // ① 指着【别人家】服务详情页的那一级。判据只认服务详情页那一族 —— 别的 href 不是这条病。
      for (const crumb of crumbs) {
        if (!crumb || typeof crumb.href !== 'string') continue;
        const slug = slugFromHref(crumb.href);
        if (slug === null || !detailSlugs.has(slug)) continue;
        if (slug === own.detailSlug) continue;
        if (own.detailSlug) {
          changes.push(`${page.slug}: ${crumb.href} → /${own.detailSlug}`);
          crumb.href = `/${own.detailSlug}`;
        } else {
          changes.push(`${page.slug}: ${crumb.href} → 去掉 href,只留文字「${crumb.label}」`);
          delete crumb.href;
        }
      }

      // ② 自己那个服务【有】详情页，却没有任何一级指着它 —— 把服务那一级补上。
      //    只认「文字就是这个服务名」而且在首尾之间的那一级：首级是 Home、末级是本页自己。
      //    模型漏写 href，或者上面 #1176 那道把一个死链剥掉之后，都会落在这里。
      if (!own.detailSlug) continue;
      const pointsAtOwn = crumbs.some(
        (c) => c && typeof c.href === 'string' && slugFromHref(c.href) === own.detailSlug,
      );
      if (pointsAtOwn) continue;
      const wanted = serviceKey(own.serviceName);
      for (let i = 1; i < crumbs.length - 1; i += 1) {
        const crumb = crumbs[i];
        if (!crumb || typeof crumb.href === 'string') continue;
        if (!wanted || serviceKey(crumb.label) !== wanted) continue;
        changes.push(`${page.slug}: 本来没有 href → /${own.detailSlug}`);
        crumb.href = `/${own.detailSlug}`;
        break;
      }
    }
  }
  return changes;
}

module.exports = {
  pruneDeadBreadcrumbHrefs,
  slugFromHref,
  serviceKey,
  serviceDetailIndex,
  alignBreadcrumbsToOwnService,
};
