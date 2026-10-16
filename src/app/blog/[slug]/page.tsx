// TICKET-129b: default-locale blog post. Uses shared BlogPostPage component
// since app/[locale]/* is deleted.
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import BlogPostPage from '@/components/pages/BlogPostPage';
import { blogPostMetadata } from '@/lib/metadata';
import { redirect } from 'next/navigation';
import { getBlogPosts, localeUrl } from '@/lib/config';
import { isPreviewRender } from '@/lib/render-mode';
import { loadSiteData, requestSiteData } from '@/lib/site-data.server';

async function publishedParams() {
  const site = loadSiteData();
  const posts = getBlogPosts(site, site.defaultLocale);
  if (posts.length === 0) return [{ slug: '_' }];
  return posts.map((post) => ({ slug: post.slug }));
}

// #1665 —— 预览模式下**不导出** generateStaticParams（值是 undefined），这条路由就是普通的按请求渲染（构建表里的 ƒ）。
//    🔴 不能写成「预览模式返回 []」：只要导出了这个函数，Next 就把这条路由当成预先渲染（●）+ 没列出的参数按需生成并缓存，
//       请求时一调 connection() 就报 DYNAMIC_SERVER_USAGE、页面 500（实测，本票 r1）。发布模式照旧是那个函数。
export const generateStaticParams = isPreviewRender ? undefined : publishedParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const site = await requestSiteData();
  return blogPostMetadata(site, site.defaultLocale, slug);
}

export default async function RootBlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await requestSiteData();
  // #1802 —— 原来在 BlogPostPage 里（它现在不 import Next）：没有这篇 ⟹ 跳回博客列表（空博客的 `_` 占位页走的就是这一支）。
  if (!getBlogPosts(site, site.defaultLocale).some((p) => p.slug === slug)) redirect(localeUrl(site, '', site.defaultLocale, 'blogIndex'));
  return (
    <SiteShell site={site} locale={site.defaultLocale} currentPath={`/blog/${slug}`}>
      <BlogPostPage site={site} locale={site.defaultLocale} slug={slug} />
    </SiteShell>
  );
}
