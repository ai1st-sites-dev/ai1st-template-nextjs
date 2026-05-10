import type { BrandConfig, NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig } from './types/config';

import {
  brand as _brand,
  defaultLocale as _defaultLocale,
  locales as _locales,
  seoByLocale as _seoByLocale,
  servicesByLocale as _servicesByLocale,
  navigationByLocale as _navigationByLocale,
  pagesByLocale as _pagesByLocale,
  blogPostsByLocale as _blogPostsByLocale,
} from './config-data';

export const brand = _brand as BrandConfig;
export const defaultLocale = _defaultLocale as string;
export const locales = _locales as string[];
export const seoByLocale = _seoByLocale as Record<string, SeoConfig>;
export const servicesByLocale = _servicesByLocale as Record<string, ServiceConfig[]>;
export const navigationByLocale = _navigationByLocale as Record<string, NavigationConfig>;
export const pagesByLocale = _pagesByLocale as Record<string, DynamicPageConfig[]>;
export const blogPostsByLocale = _blogPostsByLocale as Record<string, BlogPostConfig[]>;

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
