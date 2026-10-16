// #1802 —— 一个站要出哪些页（§pageRoutes）、每一页画什么（§routeBody）、它的 metadata 是哪一份（§routeMetadata）。
//
// 页面集合照 Next 那边的路由矩阵逐条来（`src/app/[...slug]/page.tsx` 文件头 + §publishedParams、`app/page.tsx`、`app/blog/*`），
// 发布出去的地址一个都不多、一个都不少：
//   /                        默认语言首页（`app/page.tsx`，跟根布局同一段 ⟹ title template 不套）
//   /<页>                    默认语言的其余页（slug 以 blog / _next 开头的不出，跟 RESERVED_SLUGS 一样）
//   /blog、/blog/<文>        默认语言博客（列表页**总是**出，哪怕一篇都没有；文章页只出存在的）
//   /<语言>、/<语言>/<页>    每种语言；默认语言的这一组是跳回无前缀地址的小页（TICKET-129b v2 A1）
//   /<语言>/blog(/<文>)      有文章的语言才出；默认语言的同样是跳转小页
//   404.html                 默认语言（#1552）
// 📌 Next 那边还会多出几样，这里有意不出（理由都写在 `scripts/render-diff.js` 的白名单里）：`/~editor/*`（编辑器路由，
//    T1 搬进 dashboard）、空博客时的 `/blog/_`（Next 静态导出给一个动态段占位，页面本身是空的 `<body>`）、`_not-found.html`
//    （跟 404.html 逐字节相同）、`*.txt` RSC 载荷。
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import HomePage from '@/components/pages/HomePage';
import SubPage from '@/components/pages/SubPage';
import BlogIndexPage from '@/components/pages/BlogIndexPage';
import BlogPostPage from '@/components/pages/BlogPostPage';
import NotFoundPage from '@/components/pages/NotFoundPage';
import { getBlogPosts, getHomePage, getNonHomePages, getPage } from '@/lib/config';
import { blogIndexMetadata, blogPostMetadata, homeMetadata, redirectMetadata, subPageMetadata } from '@/lib/metadata';
import type { SiteData } from '@/lib/types/config';

export type Route =
  | { kind: 'home'; path: string; locale: string }
  | { kind: 'subpage'; path: string; locale: string; slug: string }
  | { kind: 'blogIndex'; path: string; locale: string }
  | { kind: 'blogPost'; path: string; locale: string; slug: string }
  | { kind: 'redirect'; path: string; target: string }
  | { kind: 'notFound'; path: string };

const RESERVED_SLUGS = ['blog', '_next'];
const reserved = (slug: string) => RESERVED_SLUGS.some((r) => slug === r || slug.startsWith(`${r}/`));

/** 这个站要出的全部页，次序固定（同一份站出两次逐项相同）。同一个地址只出一次（语言码恰好等于某页 slug 时，先到的那条算）。 */
export function pageRoutes(site: SiteData): Route[] {
  const { locales, defaultLocale } = site;
  const out: Route[] = [{ kind: 'home', path: '/', locale: defaultLocale }];
  // 🔴 默认语言里 slug 第一段恰好是语言码的页（`fr`、`fr/x`）不出：Next 那边 `[...slug]` §resolveSlug **先**判第一段是不是语言码，
  //    这种地址永远按语言解析（`/fr` 是法语首页、`/<默认语言>` 是跳转小页），那一页在 Next 产物里从来出不来（#1802 QA1 的反向线索）。
  for (const p of getNonHomePages(site, defaultLocale)) {
    if (!reserved(p.slug) && !locales.includes(p.slug.split('/')[0])) out.push({ kind: 'subpage', path: `/${p.slug}`, locale: defaultLocale, slug: p.slug });
  }
  out.push({ kind: 'blogIndex', path: '/blog', locale: defaultLocale });
  for (const post of getBlogPosts(site, defaultLocale)) out.push({ kind: 'blogPost', path: `/blog/${post.slug}`, locale: defaultLocale, slug: post.slug });
  for (const locale of locales) {
    const isDefault = locale === defaultLocale;
    out.push(isDefault ? { kind: 'redirect', path: `/${locale}`, target: '/' } : { kind: 'home', path: `/${locale}`, locale });
    for (const p of getNonHomePages(site, locale)) {
      if (reserved(p.slug)) continue;
      const path = `/${locale}/${p.slug}`;
      out.push(isDefault ? { kind: 'redirect', path, target: `/${p.slug}` } : { kind: 'subpage', path, locale, slug: p.slug });
    }
    const posts = getBlogPosts(site, locale);
    if (posts.length === 0) continue;
    out.push(isDefault ? { kind: 'redirect', path: `/${locale}/blog`, target: '/blog' } : { kind: 'blogIndex', path: `/${locale}/blog`, locale });
    for (const post of posts) {
      const path = `/${locale}/blog/${post.slug}`;
      out.push(isDefault ? { kind: 'redirect', path, target: `/blog/${post.slug}` } : { kind: 'blogPost', path, locale, slug: post.slug });
    }
  }
  out.push({ kind: 'notFound', path: '/404' });
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

/** 这一页写到输出目录的哪个文件：`/` → `index.html`、`/about` → `about/index.html`、404 → `404.html`。 */
export function routeFile(route: Route): string {
  if (route.kind === 'notFound') return '404.html';
  return route.path === '/' ? 'index.html' : `${route.path.slice(1)}/index.html`;
}

/** 这一页的 metadata（合并在根布局那份上面），以及它是不是根布局的子段（见 `meta.tsx` §pageMeta）。 */
export function routeMetadata(site: SiteData, route: Route): { page: Metadata | null; childSegment: boolean; extraRobots: string | null } {
  switch (route.kind) {
    case 'home': return { page: homeMetadata(site, route.locale), childSegment: route.path !== '/', extraRobots: null };
    case 'subpage': return { page: subPageMetadata(site, route.locale, route.slug), childSegment: true, extraRobots: null };
    case 'blogIndex': return { page: blogIndexMetadata(site, route.locale), childSegment: true, extraRobots: null };
    case 'blogPost': return { page: blogPostMetadata(site, route.locale, route.slug), childSegment: true, extraRobots: null };
    case 'redirect': return { page: redirectMetadata(route.target), childSegment: true, extraRobots: null };
    case 'notFound': return { page: null, childSegment: false, extraRobots: 'noindex' };
  }
}

/** 去掉语言前缀的路径（语言开关要它，跟 `[...slug]/page.tsx` 算 `currentPath` 那一句同一个规则）。 */
function currentPathOf(site: SiteData, route: Route): string {
  const segs = route.path.split('/').filter(Boolean);
  const rest = segs.length && site.locales.includes(segs[0]) ? segs.slice(1) : segs;
  return `/${rest.join('/')}`;
}

/** 这一页 <body> 里的东西（跳转小页不经 SiteShell，跟 Next 那边一样）。跳转小页的 `<meta http-equiv="refresh">` 不在这里 —— 它进 <head>（`document.tsx`）。 */
export function routeBody(site: SiteData, route: Route): ReactNode {
  switch (route.kind) {
    case 'redirect':
      return (
        <>
          <p style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
            Redirecting to <a href={route.target}>{route.target}</a>...
          </p>
          <script dangerouslySetInnerHTML={{ __html: `window.location.replace(${JSON.stringify(route.target)});` }} />
        </>
      );
    case 'notFound':
      return <NotFoundPage site={site} />;
    case 'home':
      return (
        <SiteShell site={site} locale={route.locale} page={getHomePage(site, route.locale)?.slug} currentPath={currentPathOf(site, route)}>
          <HomePage site={site} locale={route.locale} />
        </SiteShell>
      );
    case 'subpage':
      return (
        <SiteShell site={site} locale={route.locale} page={getPage(site, route.slug, route.locale)?.slug} currentPath={currentPathOf(site, route)}>
          <SubPage site={site} locale={route.locale} slug={route.slug} />
        </SiteShell>
      );
    case 'blogIndex':
      return (
        <SiteShell site={site} locale={route.locale} currentPath={currentPathOf(site, route)}>
          <BlogIndexPage site={site} locale={route.locale} />
        </SiteShell>
      );
    case 'blogPost':
      return (
        <SiteShell site={site} locale={route.locale} currentPath={currentPathOf(site, route)}>
          <BlogPostPage site={site} locale={route.locale} slug={route.slug} />
        </SiteShell>
      );
  }
}
