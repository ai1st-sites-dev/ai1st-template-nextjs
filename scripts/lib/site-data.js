'use strict';
// #1665 —— 把 site/ 读成一个普通对象（`SiteData`，类型在 `src/lib/types/config.ts`）。
//
// 以前站点内容是编译期常量：`sync-config.js` 把 site/ 拼成 `src/lib/config-data.ts`，`src/lib/config.ts` 当常量导出 ⟹
// 改一个字就得重新构建。现在服务端加载器（`src/lib/site-data.server.ts`）每次请求调这里，按文件改动时间缓存；
// 预览模式下页面在被访问时才渲染，改了 site/ 刷新就是新的。发布模式（静态导出）也走这里 —— 构建时读、渲染成 HTML。
//
// 🔴 产出必须跟 `sync-config.js` 写进 `config-data.ts` 的那 15 个值**逐个相同**（发布出去的页面一个字不变就靠它）。
//    所以下面每一步都是 sync-config 里那一步的同一个 lib 调用、同一个顺序，差别只有三处，都是有意的：
//    ① 不写任何文件、不打日志 —— 它在请求路径上跑。sync-config 的那些构建闸门（CSS 契约、主题 token、注册表对照、
//      块校验……）不在这里：它们是「这次构建能不能放行」，不是内容；派生文件（navigation.json 重写、theme.css、
//      site.css、custom.css）也不在这里 —— 那是派生，T3 拆成独立脚本。
//    ② `navigation.json` 原样读。sync-config 会先按页面列表重写它的链接再写回文件；发布那次构建前 sync-config 照旧
//      跑过，读到的就是重写后的那份，跟 config-data.ts 里的同一份。
//    ③ 读不了 / 不合法 = 抛错（sync-config 是 `process.exit(1)`）。调用方是一次请求，不是一个进程。
//    「逐个相同」由 `site-data.test.js` 守：同一份站先跑 sync-config，再拿这里的产出跟 config-data.ts 逐字段比。
//
// `lastModified`（sitemap 的 <lastmod>）有两档：`git`（发布，跟 sync-config 同一个解析器，取 git 提交时间）、
// `mtime`（预览，只看文件改动时间 —— 每次保存都跑一遍 git log 不值，预览站也不进搜索引擎）。

const fs = require('fs');
const path = require('path');
const { readSiteBlocks, normalizeLocalePages } = require('../blocks');
const { decorateBlocks } = require('./block-decorate');
const siteRegions = require('./site-regions');
const pageLayoutLib = require('./page-layout');
const { readSiteColorScheme } = require('./color-scheme');
const { dirForLocale } = require('./text-dir.js');
const { readPagesRecursive } = require('./page-files.js');
const { createLastModifiedResolver } = require('./page-lastmod');
const { blockTypesReadingServices, createPageDeps } = require('./page-deps');
const { readBuildTarget, applyBuildTarget } = require('./build-target.js');
const { shellDataFor } = require('./shell-data');
const { resolveItemSources } = require('./item-sources');
const { iconTableFor } = require('./icons');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));

// 「哪些块读 services.json」是扫模板代码算的（registry + src/ + blocks/），一个进程里模板代码不变 ⟹ 算一次。
const servicesReadersByRoot = new Map();
function servicesReadersFor(rootDir) {
  if (!servicesReadersByRoot.has(rootDir)) servicesReadersByRoot.set(rootDir, blockTypesReadingServices(rootDir));
  return servicesReadersByRoot.get(rootDir);
}

// 预览那一档：一页读到的那几份文件里最晚的改动时间；一份都读不到 ⟹ 现在（同 page-lastmod 的第三档）。
function mtimeResolver(now) {
  return {
    resolveLatest(absPaths) {
      let best = null;
      for (const p of absPaths || []) {
        let iso = null;
        try { iso = fs.statSync(p).mtime.toISOString(); } catch { /* 读不到 —— 跳过 */ }
        if (iso && iso > now) iso = now;
        if (iso && (!best || iso > best)) best = iso;
      }
      return { value: best || now };
    },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir   模板根（有 blocks/、page-layouts/、src/ 的那一层）
 * @param {string} [opts.siteDir] 站点内容目录；不给 = `<rootDir>/site`
 * @param {object} [opts.env]     读 SITE_URL / SITE_INDEXABLE / NEXT_PUBLIC_LEAD_API；不给 = process.env
 * @param {'git'|'mtime'} [opts.lastModified]  不给 = git
 */
function assembleSiteData({ rootDir, siteDir, env = process.env, lastModified: lastModifiedMode = 'git' }) {
  siteDir = siteDir || path.join(rootDir, 'site');
  if (!fs.existsSync(path.join(siteDir, 'brand.json'))) {
    throw new Error(`Site config not found: ${siteDir}/brand.json`);
  }

  const { regions, structureThemeId } = siteRegions.resolveSiteRegionLayout(siteDir);
  const colorScheme = readSiteColorScheme(siteDir);

  const siteMetaPath = path.join(siteDir, 'site_meta.json');
  let defaultLocale;
  let locales;
  let isLegacySchema = false;
  let siteId = '';
  let leadApi = '';
  if (!fs.existsSync(siteMetaPath)) {
    defaultLocale = 'en';
    locales = ['en'];
    isLegacySchema = true;
  } else {
    const siteMeta = readJson(siteMetaPath);
    ({ defaultLocale, locales } = siteMeta);
    siteId = siteMeta.siteId || '';
    leadApi = siteMeta.leadApi || '';
    if (!defaultLocale || !Array.isArray(locales) || locales.length === 0) {
      throw new Error('site_meta.json invalid: must contain defaultLocale (string) and locales (non-empty array)');
    }
    if (!locales.includes(defaultLocale)) {
      throw new Error(`site_meta.json invalid: defaultLocale "${defaultLocale}" not in locales [${locales.join(', ')}]`);
    }
  }
  const dir = dirForLocale(defaultLocale);

  const brand = readJson(path.join(siteDir, 'brand.json'));
  if (typeof brand.tagline === 'string') {
    brand.tagline = { [defaultLocale]: brand.tagline };
  } else if (!brand.tagline || typeof brand.tagline !== 'object' || Array.isArray(brand.tagline)) {
    brand.tagline = { [defaultLocale]: '' };
  }
  if (typeof brand.name === 'string') {
    brand.name = { [defaultLocale]: brand.name };
  } else if (!brand.name || typeof brand.name !== 'object' || Array.isArray(brand.name)) {
    brand.name = { [defaultLocale]: '' };
  }

  const seoByLocale = {};
  const servicesByLocale = {};
  const formsByLocale = {};
  const navigationByLocale = {};
  const pagesByLocale = {};
  const blogPostsByLocale = {};

  const now = new Date().toISOString();
  const lastModified = lastModifiedMode === 'mtime'
    ? mtimeResolver(now)
    : createLastModifiedResolver({ rootDir, pathspec: path.relative(rootDir, siteDir) || 'site', buildTime: now });
  const servicesReaders = servicesReadersFor(rootDir);

  for (const locale of locales) {
    const localeDir = isLegacySchema ? siteDir : path.join(siteDir, locale);
    if (!isLegacySchema && !fs.existsSync(localeDir)) throw new Error(`Locale directory missing: ${localeDir}`);
    for (const required of ['seo.json', 'services.json', 'navigation.json', 'pages/home.json']) {
      if (!fs.existsSync(path.join(localeDir, required))) {
        throw new Error(`Required file missing: ${path.join(localeDir, required)}`);
      }
    }

    seoByLocale[locale] = readJson(path.join(localeDir, 'seo.json'));
    servicesByLocale[locale] = readJson(path.join(localeDir, 'services.json'));
    if (!Array.isArray(servicesByLocale[locale])) {
      throw new Error(`Locale "${locale}" services.json must be an array (current type: ${typeof servicesByLocale[locale]})`);
    }

    // #1471 —— 表单库读不了 / 不是数组 ⟹ 空表单库（同 sync-config：块退回内置默认字段，不拦）。
    let forms = [];
    const formsPath = path.join(localeDir, 'forms.json');
    if (fs.existsSync(formsPath)) {
      try { forms = readJson(formsPath); } catch { forms = []; }
      if (!Array.isArray(forms)) forms = [];
    }
    formsByLocale[locale] = forms;

    const pagesDir = path.join(localeDir, 'pages');
    const localePages = [];
    const pageSourceBySlug = new Map();
    if (fs.existsSync(pagesDir)) {
      readPagesRecursive(pagesDir, '', localePages, pageSourceBySlug);
      localePages.sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
    }
    pagesByLocale[locale] = localePages;
    if (!localePages.find((p) => p.slug === 'home')) {
      throw new Error(`Locale "${locale}" missing required home page: pages/home.json must contain { "slug": "home", "blocks": [...] }`);
    }

    const blocksReport = {};
    normalizeLocalePages(localePages, readSiteBlocks(localeDir), locale, blocksReport);

    const pageDeps = createPageDeps({ localeDir, services: servicesReaders });
    for (const page of localePages) {
      const dep = pageDeps.filesFor(page, pageSourceBySlug.get(page.slug), (blocksReport.siteBlockIdsByPage || {})[page.slug]);
      page.lastModified = lastModified.resolveLatest(dep.files).value;
    }

    const blogDir = path.join(localeDir, 'blog');
    const localeBlogPosts = [];
    if (fs.existsSync(blogDir)) {
      for (const file of fs.readdirSync(blogDir).filter((f) => f.endsWith('.json'))) {
        localeBlogPosts.push(readJson(path.join(blogDir, file)));
      }
      localeBlogPosts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }
    blogPostsByLocale[locale] = localeBlogPosts;

    navigationByLocale[locale] = readJson(path.join(localeDir, 'navigation.json'));
  }

  decorateBlocks(pagesByLocale, { rootDir, structureThemeId, log: () => {} });

  const picked = pageLayoutLib.resolveSiteLayout(siteDir);
  if (picked.problems.length) {
    throw new Error(`page layout 不合法（site/page-layout.json）：${[...new Set(picked.problems)].join(' · ')}`);
  }
  const repeated = pageLayoutLib.resolveRepeatVariants(picked.layout, regions);
  const pageLayout = { id: picked.layout.id, regions: picked.layout.regions,
    ...(picked.layout.repeatVariants ? { repeatVariants: repeated.variants } : {}) };

  regions.header.dataByLocale = {};
  regions.footer.dataByLocale = {};
  regions.header.iconTableByLocale = {};
  regions.footer.iconTableByLocale = {};
  for (const locale of locales) {
    const names = brand.name || {};
    const brandName = names[locale] ?? names[defaultLocale] ?? Object.values(names)[0] ?? '';
    const d = shellDataFor({
      nav: navigationByLocale[locale], brand, brandName,
      services: servicesByLocale[locale], pages: pagesByLocale[locale], locale, defaultLocale,
    });
    regions.header.dataByLocale[locale] = d.header;
    regions.footer.dataByLocale[locale] = d.footer;
    const [h, f] = resolveItemSources([{ type: 'header', data: d.header }, { type: 'footer', data: d.footer }],
      { brand, services: servicesByLocale[locale], pages: pagesByLocale[locale], url: (slug) => `/${slug}`, log: () => {} });
    regions.header.iconTableByLocale[locale] = iconTableFor('header', h.data);
    regions.footer.iconTableByLocale[locale] = iconTableFor('footer', f.data);
  }

  // #1547 —— 这次发布到哪个地址、收不收录（规则在 build-target.js）。预览时读的是容器起来时就有的环境变量。
  applyBuildTarget(seoByLocale, readBuildTarget(env));

  // TICKET-268b —— env 压过 site_meta（让部署挑这个环境的 manager 地址）。
  const resolvedLeadApi = env.NEXT_PUBLIC_LEAD_API || leadApi || '';

  // 过一遍 JSON：config-data.ts 就是 JSON.stringify 写出来的，undefined 的键、函数这类东西在那边本来就不存在。
  return JSON.parse(JSON.stringify({
    siteId, leadApi: resolvedLeadApi, colorScheme, dir, defaultLocale, locales, brand,
    seoByLocale, servicesByLocale, formsByLocale, navigationByLocale, pagesByLocale, blogPostsByLocale,
    regions, pageLayout,
  }));
}

module.exports = { assembleSiteData };
