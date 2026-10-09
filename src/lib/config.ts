// #1665 —— 这个文件不再碰任何文件，也不再有模块级的站点数据。站点内容是一个普通对象（`SiteData`，形状见
// `types/config.ts`），由服务端加载器 `src/lib/site-data.server.ts` 每次请求从 `site/` 读出来；这里的函数都把它当
// 第一个参数接进来。为什么不能在这里读文件：编辑器页（`EditorApp`，浏览器端代码）经 `SectionRenderer` 引到了
// 块组件、`SiteShell`、`item-sources`，它们都 import 这个文件 ⟹ 这里一出现读文件，编辑器页的浏览器包当场编不过。
// 字段的来历（#1471 表单库、#1472 深浅、#1473 文字方向、#1353 Region、#1000 页面布局 …）写在 `SiteData` 上。
import type { NavigationConfig, SeoConfig, ServiceConfig, BlogPostConfig, DynamicPageConfig, SiteData, SiteFormConfig } from './types/config';
// #1628 —— 语言开关指向哪儿的那条规则（纯函数，test:scripts 直接测）。
import { switchLocaleHref as switchLocaleHrefFrom } from '../../scripts/lib/locale-switch.js';

export type { SiteData };

export function isValidLocale(site: SiteData, locale: string): boolean {
  return site.locales.includes(locale);
}

export function getSeo(site: SiteData, locale: string): SeoConfig {
  return site.seoByLocale[locale] ?? site.seoByLocale[site.defaultLocale];
}

export function getServices(site: SiteData, locale: string): ServiceConfig[] {
  return site.servicesByLocale[locale] ?? site.servicesByLocale[site.defaultLocale];
}

/** #1471 —— 这个语言的表单库；没有这个语言就用默认语言那份；都没有 ⟹ 空数组（块退回内置默认字段）。 */
export function getForms(site: SiteData, locale: string): SiteFormConfig[] {
  return site.formsByLocale?.[locale] ?? site.formsByLocale?.[site.defaultLocale] ?? [];
}

/**
 * #1665 —— 块里的表单部件（`BlockLeadForm`，浏览器端）要的那三样：往哪儿提交、哪个站、这个语言的表单库。
 * 它以前自己 import 这个文件；现在由渲染它的块（服务端）从站点数据里取好递下去，浏览器只拿到这三样。
 */
export function leadFormSite(site: SiteData, locale: string): { siteId: string; leadApi: string; forms: SiteFormConfig[] } {
  return { siteId: site.siteId, leadApi: site.leadApi, forms: getForms(site, locale) };
}

export function getNavigation(site: SiteData, locale: string): NavigationConfig {
  return site.navigationByLocale[locale] ?? site.navigationByLocale[site.defaultLocale];
}

export function getBlogPosts(site: SiteData, locale: string): BlogPostConfig[] {
  return site.blogPostsByLocale[locale] ?? [];
}

export function getTagline(site: SiteData, locale: string): string {
  const { brand, defaultLocale } = site;
  return brand.tagline[locale] ?? brand.tagline[defaultLocale] ?? '';
}

// TICKET-136: per-locale brand name with 3-level fallback. Mirrors getTagline
// shape so call sites read identical to taglines. Final fallback to the first
// non-empty entry covers the edge case where neither the requested locale nor
// the default-locale entry are populated.
export function getBrandName(site: SiteData, locale: string): string {
  const { brand, defaultLocale } = site;
  return brand.name[locale] ?? brand.name[defaultLocale] ?? Object.values(brand.name)[0] ?? '';
}

export function getPage(site: SiteData, slug: string, locale: string): DynamicPageConfig | undefined {
  return (site.pagesByLocale[locale] ?? []).find((p) => p.slug === slug);
}

export function getHomePage(site: SiteData, locale: string): DynamicPageConfig {
  const pages = site.pagesByLocale[locale] ?? site.pagesByLocale[site.defaultLocale];
  return pages.find((p) => p.slug === 'home')!;
}

export function getNonHomePages(site: SiteData, locale: string): DynamicPageConfig[] {
  return (site.pagesByLocale[locale] ?? []).filter((p) => p.slug !== 'home');
}

export function getNavPages(site: SiteData, locale: string): DynamicPageConfig[] {
  return (site.pagesByLocale[locale] ?? []).filter((p) => p.navLabel);
}

// TICKET-124: cross-locale slug → locales[] reverse index (O(N×P) where N=locales, P=pages, ~14×6=84 ops).
// Used by hreflang + sitemap alternates to determine which locales actually have a given page.
// #1665: it used to be built once at module load; the data is a per-request object now, so it is built once per
// SiteData object (the loader hands out the same object until a file under site/ changes).
const slugIndexCache = new WeakMap<SiteData, Record<string, string[]>>();
function slugToLocalesOf(site: SiteData): Record<string, string[]> {
  let idx = slugIndexCache.get(site);
  if (!idx) {
    idx = {};
    for (const loc of site.locales) {
      for (const p of site.pagesByLocale[loc] ?? []) {
        (idx[p.slug] ??= []).push(loc);
      }
    }
    slugIndexCache.set(site, idx);
  }
  return idx;
}

// TICKET-129: build a path / absolute URL for a given (slug, locale, kind).
// defaultLocale uses root URL alias (no /<locale> prefix); other locales keep
// /<locale>/* prefix. Used by hreflang + sitemap + canonical to produce SEO-
// consolidating links pointing at the root URL for default locale.
//
// Returns the path-only form (no domain). Callers prefix the domain themselves.
// #1665: the only thing it reads is defaultLocale, so it takes just that much of the site — browser components
// (LanguageSwitcher) are handed `{ defaultLocale }`, not the whole site.
export function localeUrl(
  site: Pick<SiteData, 'defaultLocale'>,
  slug: string,
  locale: string,
  kind: 'page' | 'blogIndex' | 'blogPost' = 'page'
): string {
  const isDefault = locale === site.defaultLocale;
  const prefix = isDefault ? '' : `/${locale}`;
  if (kind === 'blogIndex') return `${prefix}/blog`;
  if (kind === 'blogPost') return `${prefix}/blog/${slug}`;
  if (slug === 'home') return prefix || '/';
  return `${prefix}/${slug}`;
}

// #1628: where the language switcher sends you — the same page in `target` if `target` has it, else `target`'s home
// (a link to a page that was never built is a dead link, and dead links block publishing, #1553). `path` has its
// locale prefix removed. The rule lives in scripts/lib/locale-switch.js so test:scripts can test it; this passes it
// the real indexes — slugToLocales, the same one getAlternateLanguages uses.
// #1665: the switcher is browser code, so the server side (SiteShell) builds this index and hands it down as a prop.
export interface LocaleSwitchIndex {
  defaultLocale: string;
  slugToLocales: Record<string, string[]>;
  blogSlugsByLocale: Record<string, string[]>;
}
export function localeSwitchIndex(site: SiteData): LocaleSwitchIndex {
  return {
    defaultLocale: site.defaultLocale,
    slugToLocales: slugToLocalesOf(site),
    blogSlugsByLocale: Object.fromEntries(
      site.locales.map((l) => [l, (site.blogPostsByLocale[l] ?? []).map((p) => p.slug)])
    ),
  };
}
export function switchLocaleHref(index: LocaleSwitchIndex, path: string, target: string): string {
  return switchLocaleHrefFrom(path, target, index);
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
  site: SiteData,
  slug: string,
  domain: string,
  kind: 'page' | 'blogIndex' | 'blogPost' = 'page'
): Record<string, string> {
  const { locales, blogPostsByLocale } = site;
  let matching: string[];
  if (kind === 'blogIndex') {
    matching = locales.filter((l) => (blogPostsByLocale[l] ?? []).length > 0);
  } else if (kind === 'blogPost') {
    matching = locales.filter((l) => (blogPostsByLocale[l] ?? []).some((p) => p.slug === slug));
  } else {
    matching = slugToLocalesOf(site)[slug] ?? [];
  }
  if (matching.length <= 1) return {};
  // TICKET-129: defaultLocale uses root URL via localeUrl (no /<locale> prefix).
  return Object.fromEntries(matching.map((l) => [l, `${domain}${localeUrl(site, slug, l, kind)}`]));
}

// Returns the absolute URL for the x-default hreflang (defaultLocale's version
// of this page). Used in tandem with getAlternateLanguages — only call when
// getAlternateLanguages returned a non-empty map (single-locale sites must NOT
// emit x-default either, per TICKET-124 backward-compat AC).
//
// TICKET-129: x-default points to the root URL (no /<defaultLocale> prefix).
export function getXDefaultHref(
  site: SiteData,
  slug: string,
  domain: string,
  kind: 'page' | 'blogIndex' | 'blogPost' = 'page'
): string {
  return `${domain}${localeUrl(site, slug, site.defaultLocale, kind)}`;
}

// Returns BCP-47 language code (e.g. "en-CA" / "zh-CN") for Schema.org
// inLanguage field. Reads seo.locale (which uses underscore form like "en_CA"
// for OpenGraph) and converts to dash form per BCP-47 spec.
export function getInLanguage(site: SiteData, locale: string): string {
  const seo = getSeo(site, locale);
  return (seo.locale || locale).replace('_', '-');
}
