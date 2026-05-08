import { MetadataRoute } from 'next';
import { defaultLocale, locales, getSeo, getBlogPosts, pagesByLocale } from '@/lib/config';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const seo = getSeo(defaultLocale);
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of locales) {
    const localePages = pagesByLocale[locale] ?? [];
    for (const page of localePages) {
      const path = page.slug === 'home' ? `/${locale}` : `/${locale}/${page.slug}`;
      entries.push({
        url: `${seo.domain}${path}`,
        lastModified: new Date(),
        changeFrequency: (page.changeFrequency as 'weekly' | 'monthly' | 'daily') || 'monthly',
        priority: page.priority ?? 0.5,
      });
    }

    const localeBlogPosts = getBlogPosts(locale);
    if (localeBlogPosts.length > 0) {
      entries.push({
        url: `${seo.domain}/${locale}/blog`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
      for (const post of localeBlogPosts) {
        entries.push({
          url: `${seo.domain}/${locale}/blog/${post.slug}`,
          lastModified: new Date(post.publishedAt),
          changeFrequency: 'monthly',
          priority: 0.6,
        });
      }
    }
  }

  return entries;
}
