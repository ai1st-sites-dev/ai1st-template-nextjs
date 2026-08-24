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

module.exports = { pruneDeadBreadcrumbHrefs, slugFromHref };
