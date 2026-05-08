import { MetadataRoute } from 'next';
import { getSeo, defaultLocale } from '@/lib/config';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const seo = getSeo(defaultLocale);
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${seo.domain}/sitemap.xml`,
  };
}
