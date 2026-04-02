import { MetadataRoute } from 'next';
import { seo } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${seo.domain}/sitemap.xml`,
  };
}
