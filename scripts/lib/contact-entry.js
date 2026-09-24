'use strict';

/**
 * contact-entry.js — 「这个站上客人还能不能直接联系到老板」（#1408）
 *
 *   const { entryTypes, contactEntriesOf, footerContactOf } = require('./lib/contact-entry.js');
 *   entryTypes(loadBlockManifests(root));          // Set { 'contact-form', 'contact-info', 'quote-form', 'hero-with-form' }
 *   contactEntriesOf(siteDir, types);              // [{ locale, page, type, id }, …]  或 null（问不出来）
 *   footerContactOf(siteDir);                      // { email: true, phone: false }
 *
 * 发布时的那句提示（`scripts/publish-notice.js`）拿它比两次：上一次发布那份、这次那份。
 *
 * ── 哪些块算「收客入口」：从 manifest 现算 ─────────────────────────────────────────────────────
 * 🔴 判据是 manifest 的 `category === 'contact'`，**不是一张手写的类型名单**。今天那一类是
 *    contact-form / quote-form / contact-info 三个；库里以后再加一个 contact 类的块，它自动算数，
 *    不用回来改这里。手写名单的坏法是静默的：只写 contact-form 的话，一个只有 quote-form（报价表单，
 *    明明是收客的）的站会被告知「没有联系表单了」—— 一句假话，而且每一次发布都说。
 *    `publish-notice.test.js` 里「只有 quote-form 的站 0 条提示」那一格守的就是这一条。
 *
 * ── 唯一一个点名的例外：hero-with-form ─────────────────────────────────────────────────────────
 *    它的 category 是 `banner` —— 它首先是一个 hero（页面开头那一大块），分类表里就该排在 banner；
 *    但它自带一张收客表单（`hero-lead-form.js`），老板把页面上别的表单都删掉、只留它时，客人照样
 *    能留言。不把它算进来，这种站每次发布都会被说一句假话。manifest 上没有「带不带表单」这一维，
 *    所以这里只能点名；以后要是 manifest 长出那一维，这个例外应当换成读它。
 *
 * ── 「站上有哪些块」：用构建那一套，不另写 ──────────────────────────────────────────────────────
 * 🔴 一页上实际出现的块 = 页面 JSON 里的块 + `site-blocks.json` 按 `ref` / `visibility` 注进来的，
 *    这件事只有 `blocks.js` §normalizeLocalePages 说了算（构建用的就是它）。只读页面 JSON 的话，
 *    表单放成共用块（`visibility: ["*"]`）的站会被误报，删掉那个共用表单又不会提示。
 * 🔴 被藏起来的块（`hidden: true`）不算：它在产物里根本不渲染（`SectionRenderer.tsx` 直接 return null），
 *    客人看不见它。
 * 🔴 整站一起算（所有语言、所有页面）：问的是「整个网站上还有没有入口」，不是「这一页有没有」。
 */

const fs = require('fs');
const path = require('path');

const blocksLib = require('../blocks');
const pageFiles = require('./page-files');
const siteShape = require('./site-shape');

// 见文件头「唯一一个点名的例外」。
const NAMED_ENTRY_TYPES = ['hero-with-form'];

/** 收客入口的块类型集合：manifest 里 category 是 contact 的，加上点名的例外。 */
function entryTypes(manifests) {
  const out = new Set(NAMED_ENTRY_TYPES);
  for (const [type, m] of Object.entries(manifests || {})) {
    if (m && m.category === 'contact') out.add(type);
  }
  return out;
}

/**
 * 整站实际渲染出来的收客入口块。
 *
 * @param {string} siteDir `site/` 的绝对路径
 * @param {Set<string>} types `entryTypes()` 的结果
 * @returns {Array<{locale:string,page:string,type:string,id:string}>|null}
 *   null = 问不出来（没有 site/、多语言站的 site_meta.json 读不出语言、某一种语言归一化不过）。
 *   🔴 调用方拿到 null 必须什么都不说 —— 「读不到」当成「没有入口」就是一句假提示。
 */
function contactEntriesOf(siteDir, types) {
  const shape = siteShape.readSiteShape(siteDir);
  if (!shape) return null;
  let locales;
  if (shape.flat) {
    locales = ['en'];
  } else {
    if (!shape.locales.length) return null;
    locales = shape.locales;
  }
  const found = [];
  for (const locale of locales) {
    const localeDir = shape.flat ? siteDir : path.join(siteDir, locale);
    const pagesDir = path.join(localeDir, 'pages');
    if (!fs.existsSync(pagesDir)) return null;
    let pages;
    try {
      pages = [];
      pageFiles.readPagesRecursive(pagesDir, '', pages, null);
      blocksLib.normalizeLocalePages(pages, blocksLib.readSiteBlocks(localeDir), locale, {});
    } catch (e) {
      return null;
    }
    for (const p of pages) {
      for (const b of p.blocks || []) {
        if (!b || b.hidden === true || !types.has(b.type)) continue;
        found.push({ locale, page: p.slug, type: b.type, id: typeof b.id === 'string' ? b.id : '' });
      }
    }
  }
  return found;
}

/**
 * 页脚那一栏能给客人什么：`blocks/footer/Section.tsx` 的联系栏每一页都画 `brand.locations` 的电话和
 * `mailto:brand.email`。提示的后半句只说这里真有的那一样（两样都没有就不说后半句）。
 */
function footerContactOf(siteDir) {
  let brand = {};
  try {
    brand = JSON.parse(fs.readFileSync(path.join(siteDir, 'brand.json'), 'utf-8')) || {};
  } catch (e) {
    brand = {};
  }
  const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
  return {
    email: nonEmpty(brand.email),
    phone: Array.isArray(brand.locations) && brand.locations.some((l) => l && nonEmpty(l.phone)),
  };
}

module.exports = { NAMED_ENTRY_TYPES, entryTypes, contactEntriesOf, footerContactOf };
