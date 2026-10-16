import { MetadataRoute } from 'next';
import { sitemapEntries } from '@/lib/seo-files';
import { requestSiteData } from '@/lib/site-data.server';

// #1665 —— 理由同 robots.ts：静态导出要一个「能静态生成」的声明，又不能是 force-static（会把预览模式也钉死在构建那一刻）。
export const revalidate = false;

// #1802 —— 内容在 `lib/seo-files.ts` §sitemapEntries（Next 外的 `render/` 用同一份）。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries(await requestSiteData());
}
