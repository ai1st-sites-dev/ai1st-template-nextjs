import type { BrandConfig, NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig, RegionsConfig, PageLayoutConfig, SiteFormConfig } from './types/config';

import {
  brand as _brand,
  siteId as _siteId,
  leadApi as _leadApi,
  colorScheme as _colorScheme,
  dir as _dir,
  defaultLocale as _defaultLocale,
  locales as _locales,
  seoByLocale as _seoByLocale,
  servicesByLocale as _servicesByLocale,
  formsByLocale as _formsByLocale,
  navigationByLocale as _navigationByLocale,
  pagesByLocale as _pagesByLocale,
  blogPostsByLocale as _blogPostsByLocale,
  regions as _regions,
  pageLayout as _pageLayout,
} from './config-data';

export const brand = _brand as BrandConfig;
// TICKET-268b: tenant id + lead API base for the ContactFormSection (POST /api/leads).
export const siteId = _siteId as string;
export const leadApi = _leadApi as string;
// #1472 —— 站级深浅（`site_meta.json` 的 colorScheme，判据在 `scripts/lib/color-scheme.js`）。`layout.tsx` 读它写 `<html data-bs-theme>`。
export const colorScheme = _colorScheme as 'light' | 'dark' | 'auto';
// #1473 —— 站级文字方向（主语言推出来的，判据在 `scripts/lib/text-dir.js`）。`layout.tsx` 读它写 `<html dir>`。
export const dir = _dir as 'ltr' | 'rtl';
export const defaultLocale = _defaultLocale as string;
export const locales = _locales as string[];
export const seoByLocale = _seoByLocale as Record<string, SeoConfig>;
export const servicesByLocale = _servicesByLocale as Record<string, ServiceConfig[]>;
// #1471 —— 站级表单库（`site/<locale>/forms.json`，形状与校验在 `scripts/lib/site-forms.js`）。没有 forms.json 的语言是空数组。
export const formsByLocale = _formsByLocale as Record<string, SiteFormConfig[]>;
export const navigationByLocale = _navigationByLocale as Record<string, NavigationConfig>;
export const pagesByLocale = _pagesByLocale as Record<string, DynamicPageConfig[]>;
export const blogPostsByLocale = _blogPostsByLocale as Record<string, BlogPostConfig[]>;
// #1353: 三个 Region（顶栏 / 页脚 / 公告条）选中的形态。它们是 Region 不是 section，所以走的是自己
// 的写出口（sync-config.js 的 §Regions），不是那张按 section.type 索引的偏好表 —— 那张表对它们按
// 构造是瞎的。🔴 这个导出以前叫 `regionLayout` 且带 `headerScrim`；#1353 把它们搬进形态层之后，
// 值是**形态名**（跟别的 32 个块同一套词），遮罩由 CSS 决定，所以两样都换了。
export const regions = _regions as RegionsConfig;
// #1000: 这个站的页面由哪些区组成(page-layouts/ 里的一个)。构建期选出来并校验过 —— 缺 header /
// content / footer 的布局进不来(spec §4.4 / D11 的替身)。没有 site/page-layout.json 的站(今天全部)
// 拿到的是 `standard`,也就是 header → content → footer 这一条老路。
export const pageLayout = _pageLayout as PageLayoutConfig;
// 🔴 #991 的 `themeCss` 不在这里了（#1002 + #1008 各拿走它的一个消费者，加起来一个都不剩）：
// 它以前同时管两件事 —— 挑 `<link href="/themes/<name>.css">` 的文件名（#1002 改成固定路径
// `/theme.css`，那张表的字节现在被贴进生成的 theme.css），以及让 hero 渲染中性 markup（#1008 把
// hero 那九个变体分支删掉了，中性 markup 现在无条件生效）。哪张表要贴进 theme.css 仍然由
// `site/theme.json` 的 `css` 字段决定，但那是**构建期**的事，只有 sync-config.js 需要知道
// （§readThemeSheet），运行时的组件一个都不问了。

export function isValidLocale(locale: string): boolean {
  return locales.includes(locale);
}

export function getSeo(locale: string): SeoConfig {
  return seoByLocale[locale] ?? seoByLocale[defaultLocale];
}

export function getServices(locale: string): ServiceConfig[] {
  return servicesByLocale[locale] ?? servicesByLocale[defaultLocale];
}

/** #1471 —— 这个语言的表单库；没有这个语言就用默认语言那份；都没有 ⟹ 空数组（块退回内置默认字段）。 */
export function getForms(locale: string): SiteFormConfig[] {
  return formsByLocale?.[locale] ?? formsByLocale?.[defaultLocale] ?? [];
}

export function getNavigation(locale: string): NavigationConfig {
  return navigationByLocale[locale] ?? navigationByLocale[defaultLocale];
}

export function getBlogPosts(locale: string): BlogPostConfig[] {
  return blogPostsByLocale[locale] ?? [];
}

export function getTagline(locale: string): string {
  return brand.tagline[locale] ?? brand.tagline[defaultLocale] ?? '';
}

// TICKET-136: per-locale brand name with 3-level fallback. Mirrors getTagline
// shape so call sites read identical to taglines. Final fallback to the first
// non-empty entry covers the edge case where neither the requested locale nor
// the default-locale entry are populated.
export function getBrandName(locale: string): string {
  return brand.name[locale] ?? brand.name[defaultLocale] ?? Object.values(brand.name)[0] ?? '';
}

export function getPage(slug: string, locale: string): DynamicPageConfig | undefined {
  return (pagesByLocale[locale] ?? []).find((p) => p.slug === slug);
}

export function getHomePage(locale: string): DynamicPageConfig {
  const pages = pagesByLocale[locale] ?? pagesByLocale[defaultLocale];
  return pages.find((p) => p.slug === 'home')!;
}

export function getNonHomePages(locale: string): DynamicPageConfig[] {
  return (pagesByLocale[locale] ?? []).filter((p) => p.slug !== 'home');
}

export function getNavPages(locale: string): DynamicPageConfig[] {
  return (pagesByLocale[locale] ?? []).filter((p) => p.navLabel);
}

// TICKET-124: cross-locale slug → locales[] reverse index, built once at module
// load (O(N×P) where N=locales, P=pages, ~14×6=84 ops). Used by hreflang +
// sitemap alternates to determine which locales actually have a given page.
const slugToLocales: Record<string, string[]> = (() => {
  const idx: Record<string, string[]> = {};
  for (const loc of locales) {
    for (const p of pagesByLocale[loc] ?? []) {
      (idx[p.slug] ??= []).push(loc);
    }
  }
  return idx;
})();

// TICKET-129: build a path / absolute URL for a given (slug, locale, kind).
// defaultLocale uses root URL alias (no /<locale> prefix); other locales keep
// /<locale>/* prefix. Used by hreflang + sitemap + canonical to produce SEO-
// consolidating links pointing at the root URL for default locale.
//
// Returns the path-only form (no domain). Callers prefix the domain themselves.
export function localeUrl(
  slug: string,
  locale: string,
  kind: 'page' | 'blogIndex' | 'blogPost' = 'page'
): string {
  const isDefault = locale === defaultLocale;
  const prefix = isDefault ? '' : `/${locale}`;
  if (kind === 'blogIndex') return `${prefix}/blog`;
  if (kind === 'blogPost') return `${prefix}/blog/${slug}`;
  if (slug === 'home') return prefix || '/';
  return `${prefix}/${slug}`;
}

// Returns hreflang locale → absolute URL map for a given page slug. Returns {}
// when the slug exists in 0 or 1 locales (single-locale sites stay byte-identical
// to pre-TICKET-124, no `hreflang="en"` self-reference noise). Caller is
// responsible for adding the `x-default` entry via getXDefaultHref.
//
// `kind` distinguishes between regular pages (use slugToLocales index), the blog
// index (locales with at least 1 published post), and individual blog posts (the
// `slug` argument is matched against blogPostsByLocale[loc][*].slug).
export function getAlternateLanguages(
  slug: string,
  domain: string,
  kind: 'page' | 'blogIndex' | 'blogPost' = 'page'
): Record<string, string> {
  let matching: string[];
  if (kind === 'blogIndex') {
    matching = locales.filter((l) => (blogPostsByLocale[l] ?? []).length > 0);
  } else if (kind === 'blogPost') {
    matching = locales.filter((l) => (blogPostsByLocale[l] ?? []).some((p) => p.slug === slug));
  } else {
    matching = slugToLocales[slug] ?? [];
  }
  if (matching.length <= 1) return {};
  // TICKET-129: defaultLocale uses root URL via localeUrl (no /<locale> prefix).
  return Object.fromEntries(matching.map((l) => [l, `${domain}${localeUrl(slug, l, kind)}`]));
}

// Returns the absolute URL for the x-default hreflang (defaultLocale's version
// of this page). Used in tandem with getAlternateLanguages — only call when
// getAlternateLanguages returned a non-empty map (single-locale sites must NOT
// emit x-default either, per TICKET-124 backward-compat AC).
//
// TICKET-129: x-default points to the root URL (no /<defaultLocale> prefix).
export function getXDefaultHref(
  slug: string,
  domain: string,
  kind: 'page' | 'blogIndex' | 'blogPost' = 'page'
): string {
  return `${domain}${localeUrl(slug, defaultLocale, kind)}`;
}

// Returns BCP-47 language code (e.g. "en-CA" / "zh-CN") for Schema.org
// inLanguage field. Reads seo.locale (which uses underscore form like "en_CA"
// for OpenGraph) and converts to dash form per BCP-47 spec.
export function getInLanguage(locale: string): string {
  const seo = getSeo(locale);
  return (seo.locale || locale).replace('_', '-');
}
