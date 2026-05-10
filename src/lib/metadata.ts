import type { Metadata } from 'next';
import { brand, getSeo, getPage, getBlogPosts, getAlternateLanguages, getXDefaultHref, isValidLocale, localeUrl } from '@/lib/config';

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
      template: `%s | ${brand.name}`,
    },
    description: seo.siteDescription,
    keywords: seo.keywords,
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
      siteName: brand.name,
      locale: seo.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
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
    title: page.title,
    description: page.description,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(page.slug, seo.domain) },
      } : {}),
    },
    openGraph: {
      title: `${page.title} | ${brand.name}`,
      description: page.description,
      url: canonicalPath,
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
    description: `Read the latest articles and insights from ${brand.name}.`,
    alternates: {
      canonical: canonicalPath,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref('', seo.domain, 'blogIndex') },
      } : {}),
    },
    openGraph: {
      title: `Blog | ${brand.name}`,
      description: `Read the latest articles and insights from ${brand.name}.`,
      url: canonicalPath,
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
      type: 'article',
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
  };
}
