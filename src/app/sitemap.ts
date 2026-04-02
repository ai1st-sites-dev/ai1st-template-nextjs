import { MetadataRoute } from 'next';
import { seo, blogPosts, allPages } from '@/lib/config';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = allPages.map((page) => ({
    url: `${seo.domain}${page.slug === 'home' ? '' : `/${page.slug}`}`,
    lastModified: new Date(),
    changeFrequency: (page.changeFrequency as 'weekly' | 'monthly' | 'daily') || 'monthly',
    priority: page.priority ?? 0.5,
  }));

  if (blogPosts.length > 0) {
    pages.push({
      url: `${seo.domain}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    });

    for (const post of blogPosts) {
      pages.push({
        url: `${seo.domain}/blog/${post.slug}`,
        lastModified: new Date(post.publishedAt),
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }

  return pages;
}
