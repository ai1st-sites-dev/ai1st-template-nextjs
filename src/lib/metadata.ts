import type { Metadata } from 'next';
import type { SiteData } from '@/lib/types/config';
import { getSeo, getPage, getBlogPosts, getAlternateLanguages, getXDefaultHref, getBrandName, isValidLocale, localeUrl } from '@/lib/config';
import { ogImageFields, twitterCard } from '@/lib/og-image';

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
