import type { Metadata } from 'next';
import type { SiteData } from '@/lib/types/config';
import { getSeo, getPage, getBlogPosts, getAlternateLanguages, getXDefaultHref, getBrandName, isValidLocale, localeUrl } from '@/lib/config';
import { ogImageFields, twitterCard } from '@/lib/og-image';

/**
 * #1802 —— 根布局那一层（原来是 `app/layout.tsx` 的 `generateMetadata` 正文，逐字搬过来）。每页的 metadata 由 Next
 * 合并在它上面；Next 外的整页渲染（`render/meta.tsx`）照 Next 的合并规则拿同一份去合并。
 */
export function rootMetadata(site: SiteData): Metadata {
  const seo = getSeo(site, site.defaultLocale);
  const defaultBrandName = getBrandName(site, site.defaultLocale);
  return {
    title: {
      default: seo.siteTitle,
      template: `%s | ${defaultBrandName}`,
    },
    description: seo.siteDescription,
    metadataBase: new URL(seo.domain),
    alternates: {
      canonical: '/',
    },
    openGraph: {
      title: seo.siteTitle,
      description: seo.siteDescription,
      url: seo.domain,
      siteName: defaultBrandName,
      locale: seo.locale,
      type: 'website',
      ...ogImageFields(site),
    },
    twitter: {
      // #1552 —— 有分享图才声明大图卡；没图降成 summary（§siteOgImage 三档）。
      card: twitterCard(site),
      title: seo.siteTitle,
      description: seo.siteDescription,
    },
    // #1547 — 预览构建（manager 给 indexable=false）整站 noindex；canonical 照常指自己。
    robots: seo.indexable === false ? { index: false, follow: false } : {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    verification: seo.verification,
  };
}

// Shared metadata builders. Used by route files (app/page.tsx, app/[...slug]/page.tsx,
// app/blog/page.tsx, app/blog/[slug]/page.tsx) so each entry point produces canonical /
// hreflang / OG identical to the multi-locale routes that existed before TICKET-129b.

export function homeMetadata(site: SiteData, locale: string): Metadata {
  if (!isValidLocale(site, locale)) return {};
  const seo = getSeo(site, locale);
  const altLanguages = getAlternateLanguages(site, 'home', seo.domain);
  const canonical = localeUrl(site, 'home', locale);
  const ogUrl = `${seo.domain}${canonical}`;
  return {
    title: {
      default: seo.siteTitle,
      template: `%s | ${getBrandName(site, locale)}`,
    },
    description: seo.siteDescription,
    alternates: {
      canonical,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(site, 'home', seo.domain) },
      } : {}),
    },
    openGraph: {
      title: seo.siteTitle,
      description: seo.siteDescription,
      url: ogUrl,
      ...ogImageFields(site), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
      siteName: getBrandName(site, locale),
      locale: seo.locale,
      type: 'website',
    },
    twitter: {
      card: twitterCard(site), // #1552：有图才声明大图卡
      title: seo.siteTitle,
      description: seo.siteDescription,
    },
  };
}

export function subPageMetadata(site: SiteData, locale: string, slug: string): Metadata {
  if (!isValidLocale(site, locale)) return {};
  const page = getPage(site, slug, locale);
  if (!page) return {};
  const seo = getSeo(site, locale);
  const altLanguages = getAlternateLanguages(site, page.slug, seo.domain);
  const canonicalPath = localeUrl(site, page.slug, locale);

  return {
    // TICKET-136: use absolute title so the per-locale brand name appears in
    // <title>. The layout-level title.template uses defaultLocale brand which
    // would otherwise show e.g. "About | Nike" on a zh page that should read
    // "About | 耐克".
    title: { absolute: `${page.title} | ${getBrandName(site, locale)}` },
    description: page.description,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(site, page.slug, seo.domain) },
      } : {}),
    },
    // #1551 —— 子页的 openGraph 会整份替掉根布局那份（Next 不逐键合并），所以 siteName / type 要在这里再写一遍。
    openGraph: {
      title: `${page.title} | ${getBrandName(site, locale)}`,
      description: page.description,
      url: canonicalPath,
      siteName: getBrandName(site, locale),
      type: 'website',
      ...ogImageFields(site), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
    },
  };
}

export function blogIndexMetadata(site: SiteData, locale: string): Metadata {
  if (!isValidLocale(site, locale)) return {};
  const seo = getSeo(site, locale);
  const altLanguages = getAlternateLanguages(site, '', seo.domain, 'blogIndex');
  const canonicalPath = localeUrl(site, '', locale, 'blogIndex');
  return {
    title: 'Blog',
    description: `Read the latest articles and insights from ${getBrandName(site, locale)}.`,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(site, '', seo.domain, 'blogIndex') },
      } : {}),
    },
    openGraph: {
      title: `Blog | ${getBrandName(site, locale)}`,
      description: `Read the latest articles and insights from ${getBrandName(site, locale)}.`,
      url: canonicalPath,
      siteName: getBrandName(site, locale),
      type: 'website',
      ...ogImageFields(site), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
    },
  };
}

export function blogPostMetadata(site: SiteData, locale: string, slug: string): Metadata {
  if (!isValidLocale(site, locale)) return {};
  const post = getBlogPosts(site, locale).find((p) => p.slug === slug);
  if (!post) return {};
  const seo = getSeo(site, locale);
  const altLanguages = getAlternateLanguages(site, post.slug, seo.domain, 'blogPost');
  const canonicalPath = localeUrl(site, post.slug, locale, 'blogPost');

  return {
    title: post.seo.metaTitle,
    description: post.seo.metaDescription,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(site, post.slug, seo.domain, 'blogPost') },
      } : {}),
    },
    openGraph: {
      title: post.seo.metaTitle,
      description: post.seo.metaDescription,
      url: canonicalPath,
      siteName: getBrandName(site, locale),
      ...ogImageFields(site), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
      type: 'article',
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
  };
}

/** #1802 —— 默认语言带前缀那种地址（`/<默认语言>/…`）的跳转小页（TICKET-129b v2 的 A1）。原来写在 `[...slug]/page.tsx` 里，
 *  搬出来是为了 `render/` 拿同一份。 */
export function redirectMetadata(target: string): Metadata {
  return {
    title: 'Redirecting...',
    robots: { index: false, follow: false },
    alternates: { canonical: target },
  };
}
