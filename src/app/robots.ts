import { MetadataRoute } from 'next';
import { getSeo, defaultLocale } from '@/lib/config';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const seo = getSeo(defaultLocale);
  return {
    // #1547 — 预览构建（indexable=false）整站 Disallow；Sitemap 行照常写这次构建的地址。
    rules: seo.indexable === false
      ? { userAgent: '*', disallow: '/' }
      : { userAgent: '*', allow: '/' },
    sitemap: `${seo.domain}/sitemap.xml`,
  };
}
