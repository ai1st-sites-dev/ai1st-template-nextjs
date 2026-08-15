import { MetadataRoute } from 'next';
import type { BlogPostConfig, DynamicPageConfig } from '@/lib/types/config';
import { defaultLocale, locales, getSeo, getBlogPosts, getAlternateLanguages, pagesByLocale, localeUrl } from '@/lib/config';

export const dynamic = 'force-static';

// #1026 — 只在「这一页连一个可用的日期都没有」时才用得上，并且用了就在构建日志里说一声。
// 之前每一条 <lastmod> 写的都是这个值，于是站每重建一次（换主题、发一篇博客、改任何配置）就等于
// 告诉搜索引擎「所有页面都更新了」——哪怕一个字节都没动。
const BUILD_TIME = new Date();

function usableDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 页面的日期由 sync-config.js 每次构建量出来（git 提交时间 → 文件修改时间 → 构建时刻，规则在
// scripts/lib/page-lastmod.js 的文件头上），走到兜底这一支说明 config-data.ts 是旧的或者被手改过。
function pageLastModified(page: DynamicPageConfig, locale: string): Date {
  const d = usableDate(page.lastModified);
  if (d) return d;
  console.warn(`[sitemap] [${locale}] ${page.slug || '/'}: 没有可用的 lastModified，<lastmod> 退回构建时刻`);
  return BUILD_TIME;
}

// 博客列表页什么时候变的 = 最新那篇文章的发布日期。这一页没有自己的源文件，它的内容就是那些文章。
// 🔴 取最大值，不是取排好序的第一篇：sync-config 按 `new Date(publishedAt)` 排序，而认不出来的日期
// 在那里是 NaN，排出来的第一篇不一定是最新的那篇。
function blogIndexLastModified(posts: BlogPostConfig[], locale: string): Date {
  let newest: Date | null = null;
  for (const post of posts) {
    const d = usableDate(post.publishedAt);
    if (d && (!newest || d > newest)) newest = d;
  }
  if (newest) return newest;
  console.warn(`[sitemap] [${locale}] /blog: 没有一篇文章带得出可用的发布日期，<lastmod> 退回构建时刻`);
  return BUILD_TIME;
}

// 文章自己的日期。这一行本来就用的是文章的发布日期（本票要修的是另外两处写构建时刻的），这里只补上
// 「日期不可用时怎么落」这一档 —— 本票正文第三个实施要点要的就是它。
// 🔴 补它不是防御性编程：`new Date("TBD")` 会一路走到导出那一步才炸 `RangeError: Invalid time value`，
// 整个 `next build` 当场失败（实测：给两篇文章写上 publishedAt: "TBD"，构建停在
// `Export encountered an error on /sitemap.xml/route`）。少一个日期不该让这个站从此重建不出来。
function postLastModified(post: BlogPostConfig, locale: string): Date {
  const d = usableDate(post.publishedAt);
  if (d) return d;
  console.warn(`[sitemap] [${locale}] /blog/${post.slug}: publishedAt 认不出来`
    + `（${JSON.stringify(post.publishedAt)}），<lastmod> 退回构建时刻`);
  return BUILD_TIME;
}

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
        lastModified: pageLastModified(page, locale),
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
        lastModified: blogIndexLastModified(localeBlogPosts, locale),
        changeFrequency: 'weekly',
        priority: 0.7,
        ...(Object.keys(blogIndexAlts).length > 0 ? { alternates: { languages: blogIndexAlts } } : {}),
      });
      for (const post of localeBlogPosts) {
        const blogPostAlts = getAlternateLanguages(post.slug, seo.domain, 'blogPost');
        entries.push({
          url: `${seo.domain}${localeUrl(post.slug, locale, 'blogPost')}`,
          lastModified: postLastModified(post, locale),
          changeFrequency: 'monthly',
          priority: 0.6,
          ...(Object.keys(blogPostAlts).length > 0 ? { alternates: { languages: blogPostAlts } } : {}),
        });
      }
    }
  }

  return entries;
}
