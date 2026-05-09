import { MetadataRoute } from 'next';
import { defaultLocale, locales, getSeo, getBlogPosts, getAlternateLanguages, pagesByLocale, localeUrl } from '@/lib/config';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const seo = getSeo(defaultLocale);
  const entries: MetadataRoute.Sitemap = [];

  // TICKET-129: defaultLocale uses root URL (/about, /, /blog), other locales
  // use /<locale>/* prefix. Sitemap lists each (locale, page) once at the
  // canonical URL — no /<defaultLocale>/* duplicate entries.
  for (const locale of locales) {
    const localePages = pagesByLocale[locale] ?? [];
    for (const page of localePages) {
      const altLanguages = getAlternateLanguages(page.slug, seo.domain);
      entries.push({
        url: `${seo.domain}${localeUrl(page.slug, locale)}`,
        lastModified: new Date(),
        changeFrequency: (page.changeFrequency as 'weekly' | 'monthly' | 'daily') || 'monthly',
        priority: page.priority ?? 0.5,
        ...(Object.keys(altLanguages).length > 0 ? { alternates: { languages: altLanguages } } : {}),
      });
    }

    const localeBlogPosts = getBlogPosts(locale);
    if (localeBlogPosts.length > 0) {
      const blogIndexAlts = getAlternateLanguages('', seo.domain, 'blogIndex');
      entries.push({
        url: `${seo.domain}${localeUrl('', locale, 'blogIndex')}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
        ...(Object.keys(blogIndexAlts).length > 0 ? { alternates: { languages: blogIndexAlts } } : {}),
      });
      for (const post of localeBlogPosts) {
        const blogPostAlts = getAlternateLanguages(post.slug, seo.domain, 'blogPost');
        entries.push({
          url: `${seo.domain}${localeUrl(post.slug, locale, 'blogPost')}`,
          lastModified: new Date(post.publishedAt),
          changeFrequency: 'monthly',
          priority: 0.6,
          ...(Object.keys(blogPostAlts).length > 0 ? { alternates: { languages: blogPostAlts } } : {}),
        });
      }
    }
  }

  return entries;
}
