import type { Metadata } from 'next';
import { getSeo, getPage, getBlogPosts, getAlternateLanguages, getXDefaultHref, getBrandName, isValidLocale, localeUrl } from '@/lib/config';
import { ogImageFields, twitterCard } from '@/lib/og-image';

// Shared metadata builders. Used by route files (app/page.tsx, app/[...slug]/page.tsx,
// app/blog/page.tsx, app/blog/[slug]/page.tsx) so each entry point produces canonical /
// hreflang / OG identical to the multi-locale routes that existed before TICKET-129b.

export function homeMetadata(locale: string): Metadata {
  if (!isValidLocale(locale)) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages('home', seo.domain);
  const canonical = localeUrl('home', locale);
  const ogUrl = `${seo.domain}${canonical}`;
  return {
    title: {
      default: seo.siteTitle,
      template: `%s | ${getBrandName(locale)}`,
    },
    description: seo.siteDescription,
    alternates: {
      canonical,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref('home', seo.domain) },
      } : {}),
    },
    openGraph: {
      title: seo.siteTitle,
      description: seo.siteDescription,
      url: ogUrl,
      ...ogImageFields(), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
      siteName: getBrandName(locale),
      locale: seo.locale,
      type: 'website',
    },
    twitter: {
      card: twitterCard(), // #1552：有图才声明大图卡
      title: seo.siteTitle,
      description: seo.siteDescription,
    },
  };
}

export function subPageMetadata(locale: string, slug: string): Metadata {
  if (!isValidLocale(locale)) return {};
  const page = getPage(slug, locale);
  if (!page) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages(page.slug, seo.domain);
  const canonicalPath = localeUrl(page.slug, locale);

  return {
    // TICKET-136: use absolute title so the per-locale brand name appears in
    // <title>. The layout-level title.template uses defaultLocale brand which
    // would otherwise show e.g. "About | Nike" on a zh page that should read
    // "About | 耐克".
    title: { absolute: `${page.title} | ${getBrandName(locale)}` },
    description: page.description,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(page.slug, seo.domain) },
      } : {}),
    },
    openGraph: {
      title: `${page.title} | ${getBrandName(locale)}`,
      description: page.description,
      url: canonicalPath,
      ...ogImageFields(), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
    },
  };
}

export function blogIndexMetadata(locale: string): Metadata {
  if (!isValidLocale(locale)) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages('', seo.domain, 'blogIndex');
  const canonicalPath = localeUrl('', locale, 'blogIndex');
  return {
    title: 'Blog',
    description: `Read the latest articles and insights from ${getBrandName(locale)}.`,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref('', seo.domain, 'blogIndex') },
      } : {}),
    },
    openGraph: {
      title: `Blog | ${getBrandName(locale)}`,
      description: `Read the latest articles and insights from ${getBrandName(locale)}.`,
      url: canonicalPath,
      ...ogImageFields(), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
    },
  };
}

export function blogPostMetadata(locale: string, slug: string): Metadata {
  if (!isValidLocale(locale)) return {};
  const post = getBlogPosts(locale).find((p) => p.slug === slug);
  if (!post) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages(post.slug, seo.domain, 'blogPost');
  const canonicalPath = localeUrl(post.slug, locale, 'blogPost');

  return {
    title: post.seo.metaTitle,
    description: post.seo.metaDescription,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(post.slug, seo.domain, 'blogPost') },
      } : {}),
    },
    openGraph: {
      title: post.seo.metaTitle,
      description: post.seo.metaDescription,
      url: canonicalPath,
      ...ogImageFields(), // #1552：页面级 openGraph 整份替掉根布局那份，图要每个构造器都给
      type: 'article',
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
  };
}
