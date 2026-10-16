// #1802 —— 站根那三份文本：sitemap.xml / robots.txt / llms.txt。内容来自 Next 那边同一份函数
// （`src/lib/seo-files.ts` §sitemapEntries / §robotsRules、`src/lib/llms-txt.ts` §buildLlmsTxt），这里只按 Next 的格式写成文本：
// 下面两个序列化函数逐行照抄 Next 的 `build/webpack/loaders/metadata/resolve-route-data.ts`（§resolveSitemap / §resolveRobots），
// 只留了我们的数据会走到的分支（没有图片 / 视频条目）。
//
// 预览（target=preview）：不出 sitemap.xml，robots.txt 整站 Disallow 且不写 Sitemap 行（没有那份文件可指）。
import type { MetadataRoute } from 'next';
import type { SiteData } from '@/lib/types/config';
import { robotsRules, sitemapEntries } from '@/lib/seo-files';
import { buildLlmsTxt } from '@/lib/llms-txt';

const asArray = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function robotsTxt(data: MetadataRoute.Robots): string {
  let content = '';
  for (const rule of asArray(data.rules)) {
    for (const agent of asArray(rule.userAgent || ['*'])) content += `User-Agent: ${agent}\n`;
    for (const item of asArray(rule.allow)) content += `Allow: ${item}\n`;
    for (const item of asArray(rule.disallow)) content += `Disallow: ${item}\n`;
    if (rule.crawlDelay) content += `Crawl-delay: ${rule.crawlDelay}\n`;
    content += '\n';
  }
  if (data.host) content += `Host: ${data.host}\n`;
  for (const item of asArray(data.sitemap)) content += `Sitemap: ${item}\n`;
  return content;
}

export function sitemapXml(data: MetadataRoute.Sitemap): string {
  const hasAlternates = data.some((item) => Object.keys(item.alternates ?? {}).length > 0);
  let content = '<?xml version="1.0" encoding="UTF-8"?>\n';
  content += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  content += hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' : '>\n';
  for (const item of data) {
    content += '<url>\n';
    content += `<loc>${item.url}</loc>\n`;
    const languages = item.alternates?.languages as Record<string, string> | undefined;
    if (languages && Object.keys(languages).length) {
      for (const language in languages) content += `<xhtml:link rel="alternate" hreflang="${language}" href="${languages[language]}" />\n`;
    }
    if (item.lastModified) {
      content += `<lastmod>${item.lastModified instanceof Date ? item.lastModified.toISOString() : item.lastModified}</lastmod>\n`;
    }
    if (item.changeFrequency) content += `<changefreq>${item.changeFrequency}</changefreq>\n`;
    if (typeof item.priority === 'number') content += `<priority>${item.priority}</priority>\n`;
    content += '</url>\n';
  }
  content += '</urlset>\n';
  return content;
}

/** 站根那几份文本文件：`{ 文件名: 内容 }`。 */
export function rootTextFiles(site: SiteData, target: 'live' | 'preview'): Record<string, string> {
  const files: Record<string, string> = { 'llms.txt': buildLlmsTxt(site) };
  if (target === 'preview') {
    files['robots.txt'] = robotsTxt({ rules: { userAgent: '*', disallow: '/' } });
  } else {
    files['sitemap.xml'] = sitemapXml(sitemapEntries(site));
    files['robots.txt'] = robotsTxt(robotsRules(site));
  }
  return files;
}
