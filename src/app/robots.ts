import { MetadataRoute } from 'next';
import { getSeo } from '@/lib/config';
import { requestSiteData } from '@/lib/site-data.server';

// #1665 —— 这里原来是 `export const dynamic = 'force-static'`，它会让预览模式下这条路由也在构建时生成一次、之后不变。
//    换成 `revalidate = false`：静态导出要的是「这条路由能静态生成」，Next 认 force-static / error / revalidate=false 三种
//    （`next/dist/build/utils/is-static-gen-enabled.js`；一个都不写，导出构建当场报 "force-static/revalidate not configured"，
//    实测 /llms.txt）。`revalidate = false` 不强制静态：预览模式下 `requestSiteData` 先调了 `connection()`，这条路由按请求生成。
export const revalidate = false;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await requestSiteData();
  const seo = getSeo(site, site.defaultLocale);
  return {
    // #1547 — 预览构建（indexable=false）整站 Disallow；Sitemap 行照常写这次构建的地址。
    rules: seo.indexable === false
      ? { userAgent: '*', disallow: '/' }
      : { userAgent: '*', allow: '/' },
    sitemap: `${seo.domain}/sitemap.xml`,
  };
}
