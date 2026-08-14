import type { BrandConfig, NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig, RegionLayoutConfig, PageLayoutConfig } from './types/config';

import {
  brand as _brand,
  siteId as _siteId,
  leadApi as _leadApi,
  defaultLocale as _defaultLocale,
  locales as _locales,
  seoByLocale as _seoByLocale,
  servicesByLocale as _servicesByLocale,
  navigationByLocale as _navigationByLocale,
  pagesByLocale as _pagesByLocale,
  blogPostsByLocale as _blogPostsByLocale,
  regionLayout as _regionLayout,
  pageLayout as _pageLayout,
  themeCss as _themeCss,
} from './config-data';

export const brand = _brand as BrandConfig;
// TICKET-268b: tenant id + lead API base for the ContactFormSection (POST /api/leads).
export const siteId = _siteId as string;
export const leadApi = _leadApi as string;
export const defaultLocale = _defaultLocale as string;
export const locales = _locales as string[];
export const seoByLocale = _seoByLocale as Record<string, SeoConfig>;
export const servicesByLocale = _servicesByLocale as Record<string, ServiceConfig[]>;
export const navigationByLocale = _navigationByLocale as Record<string, NavigationConfig>;
export const pagesByLocale = _pagesByLocale as Record<string, DynamicPageConfig[]>;
export const blogPostsByLocale = _blogPostsByLocale as Record<string, BlogPostConfig[]>;
// #960: 顶栏和页脚的结构。它们是 Region 不是 section,所以走的是自己的写出口(sync-config.js 的
// §Regions),不是那张按 section.type 索引的偏好表 —— 那张表对它们按构造是瞎的。
export const regionLayout = _regionLayout as RegionLayoutConfig;
// #1000: 这个站的页面由哪些区组成(page-layouts/ 里的一个)。构建期选出来并校验过 —— 缺 header /
// content / footer 的布局进不来(spec §4.4 / D11 的替身)。没有 site/page-layout.json 的站(今天全部)
// 拿到的是 `standard`,也就是 header → content → footer 这一条老路。
export const pageLayout = _pageLayout as PageLayoutConfig;
// #991 — the stylesheet in public/themes/ that owns block layout for this site, '' when it has none.
// Empty is the state of every site built before this existed, and it is what keeps their output
// identical: no <link> in layout.tsx, and hero keeps its variant markup.
export const themeCss = _themeCss as string;

export function isValidLocale(locale: string): boolean {
  return locales.includes(locale);
}

export function getSeo(locale: string): SeoConfig {
  return seoByLocale[locale] ?? seoByLocale[defaultLocale];
}

export function getServices(locale: string): ServiceConfig[] {
  return servicesByLocale[locale] ?? servicesByLocale[defaultLocale];
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

// #960 — 「这一页的第一段是不是 hero」。透明浮层顶栏只在它为真时才浮起来,所以这个判断必须跟
// 构建期那条对比度规则(scripts/region-layout.js 的 firstSectionHero)说的是同一件事。
//
// 🔴 数的是**画得出来的**第一段,不是数组的第 0 个:站自己的页面 JSON 可以把某一段标成不显示
// (`hidden`,SectionRenderer 直接 return null),而那一段仍然留在 sections 里。按第 0 个数会错两次 ——
// ① 首段被藏起来、hero 排第二 ⟹ 屏幕上顶栏压着的就是 hero,却判成不浮
// ② 藏的正好是 hero 本身 ⟹ 判成浮,而顶栏底下换成了下一段(多半是白底),白字压白底,谁都看不见。
// ② 以前造不出来(那时只有主题能藏,30 套没有一套藏 hero);#993 之后藏不藏由站自己的页面 JSON 说了算,
//    所以它现在是**造得出来的** —— 这两行本来就不该靠"今天恰好没有"活着。
export function pageStartsWithHero(page: DynamicPageConfig | undefined): boolean {
  return page?.blocks.find((b) => !b.hidden)?.type === 'hero';
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
