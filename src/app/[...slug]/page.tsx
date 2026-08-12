// TICKET-129b v2: single root catch-all replaces app/[locale]/* (deleted to fix
// Next.js routing precision collision). Handles all non-root non-default-blog
// URLs by parsing optional locale prefix from slug and dispatching to the
// appropriate page component.
//
// A1 redirect mode (TICKET-129b v2): /<defaultLocale>/* paths render a static
// redirect stub HTML that client-side redirects to the equivalent root URL
// (/<defaultLocale>/about → /about). This preserves SEO juice on default-locale
// switches (old /<old-default>/about → /about, all link equity transfers) while
// keeping the root URL canonical.
//
// Routing matrix (after Next.js precision rules):
//   /                     → app/page.tsx (default-locale Home)
//   /blog                 → app/blog/page.tsx (default-locale blog index)
//   /blog/<post>          → app/blog/[slug]/page.tsx (default-locale blog post)
//   /<defaultLocale>(/*)  → here (redirect stub → root URL equivalent)
//   /<page>               → here (default-locale subpage, no prefix)
//   /<locale>             → here (non-default locale Home)
//   /<locale>/<page>      → here (non-default locale subpage)
//   /<locale>/blog        → here (non-default locale blog index)
//   /<locale>/blog/<post> → here (non-default locale blog post)
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SiteShell from '@/components/SiteShell';
import HomePage from '@/components/pages/HomePage';
import SubPage from '@/components/pages/SubPage';
import BlogIndexPage from '@/components/pages/BlogIndexPage';
import BlogPostPage from '@/components/pages/BlogPostPage';
import { homeMetadata, subPageMetadata, blogIndexMetadata, blogPostMetadata } from '@/lib/metadata';
import { defaultLocale, locales, getNonHomePages, getBlogPosts, getHomePage, getPage, pageStartsWithHero } from '@/lib/config';

const RESERVED_SLUGS = ['blog', '_next'];

type Resolved =
  | { kind: 'home'; locale: string }
  | { kind: 'subpage'; locale: string; slug: string }
  | { kind: 'blogIndex'; locale: string }
  | { kind: 'blogPost'; locale: string; slug: string }
  | { kind: 'redirect'; target: string }
  | { kind: 'unknown' };

// Parse a slug array into (locale, kind, optional inner slug). First segment is
// treated as a locale code if and only if it appears in `locales`. Otherwise the
// entire slug array is treated as a default-locale path.
function resolveSlug(slugArray: string[]): Resolved {
  if (slugArray.length === 0) return { kind: 'unknown' };

  const isLocaleCode = locales.includes(slugArray[0]);

  // A1 redirect mode (TICKET-129b v2): any /<defaultLocale>/* redirects to the
  // root URL equivalent. The static-export HTML for these paths becomes a small
  // redirect stub (meta refresh + JS replace) instead of the full alias content.
  if (isLocaleCode && slugArray[0] === defaultLocale) {
    const rest = slugArray.slice(1);
    const target = rest.length > 0 ? `/${rest.join('/')}` : '/';
    return { kind: 'redirect', target };
  }

  const locale = isLocaleCode ? slugArray[0] : defaultLocale;
  const rest = isLocaleCode ? slugArray.slice(1) : slugArray;

  if (rest.length === 0) return { kind: 'home', locale };

  if (rest[0] === 'blog') {
    if (rest.length === 1) return { kind: 'blogIndex', locale };
    if (rest.length === 2) return { kind: 'blogPost', locale, slug: rest[1] };
    return { kind: 'unknown' };
  }

  return { kind: 'subpage', locale, slug: rest.join('/') };
}

export async function generateStaticParams() {
  const params: { slug: string[] }[] = [];

  // 1. Default-locale subpages, no prefix: /about /services /menu ...
  //    Skip 'home' (handled by app/page.tsx) and any reserved slugs (blog handled
  //    by app/blog/* + /<locale>/blog).
  const defaultPages = getNonHomePages(defaultLocale).filter(
    (p) => !RESERVED_SLUGS.some((r) => p.slug === r || p.slug.startsWith(r + '/'))
  );
  for (const p of defaultPages) {
    params.push({ slug: p.slug.split('/') });
  }

  // 2. All locale Home aliases (including defaultLocale as alias): /en /zh /fr ...
  for (const locale of locales) {
    params.push({ slug: [locale] });
  }

  // 3. All locale subpages with prefix: /en/about /zh/services ...
  for (const locale of locales) {
    const pages = getNonHomePages(locale).filter(
      (p) => !RESERVED_SLUGS.some((r) => p.slug === r || p.slug.startsWith(r + '/'))
    );
    for (const p of pages) {
      params.push({ slug: [locale, ...p.slug.split('/')] });
    }
  }

  // 4. All locale blog index/posts (including defaultLocale as /<defaultLocale>/blog
  //    alias for /blog). Default-locale /blog and /blog/<post> are emitted by
  //    app/blog/page.tsx and app/blog/[slug]/page.tsx — those URLs will not reach
  //    this catch-all.
  for (const locale of locales) {
    const posts = getBlogPosts(locale);
    if (posts.length === 0) continue;
    params.push({ slug: [locale, 'blog'] });
    for (const post of posts) {
      params.push({ slug: [locale, 'blog', post.slug] });
    }
  }

  // Deduplicate (locale code happening to equal a default-locale page slug etc.)
  const seen = new Set<string>();
  return params.filter((p) => {
    const key = p.slug.join('\x00');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = resolveSlug(slug);
  switch (r.kind) {
    case 'home': return homeMetadata(r.locale);
    case 'subpage': return subPageMetadata(r.locale, r.slug);
    case 'blogIndex': return blogIndexMetadata(r.locale);
    case 'blogPost': return blogPostMetadata(r.locale, r.slug);
    case 'redirect': return {
      title: 'Redirecting...',
      robots: { index: false, follow: false },
      alternates: { canonical: r.target },
    };
    default: return {};
  }
}

export default async function CatchAllPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const r = resolveSlug(slug);

  if (r.kind === 'unknown') notFound();

  // A1 redirect stub: bypass SiteShell (no Header/Footer/JsonLd needed for a
  // ~500-byte transitional page). Three-layer defense: <meta http-equiv="refresh">
  // (browser-native, works without JS) + <script>window.location.replace</script>
  // (instant, no history entry) + visible <a> link (fallback for edge cases).
  if (r.kind === 'redirect') {
    return (
      <>
        <meta httpEquiv="refresh" content={`0; url=${r.target}`} />
        <p style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          Redirecting to <a href={r.target}>{r.target}</a>...
        </p>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.location.replace(${JSON.stringify(r.target)});`,
          }}
        />
      </>
    );
  }

  let body: React.ReactNode;
  switch (r.kind) {
    case 'home': body = <HomePage locale={r.locale} />; break;
    case 'subpage': body = <SubPage locale={r.locale} slug={r.slug} />; break;
    case 'blogIndex': body = <BlogIndexPage locale={r.locale} />; break;
    case 'blogPost': body = <BlogPostPage locale={r.locale} slug={r.slug} />; break;
  }

  // #960: 第一段是 hero 的页面才让透明浮层顶栏浮起来。blog 那两种没有 hero,恒为 false。
  // 判断走 pageStartsWithHero(它跳过 #962 藏起来的 block,理由写在 config.ts 那里)。
  const page =
    r.kind === 'home' ? getHomePage(r.locale)
      : r.kind === 'subpage' ? getPage(r.slug, r.locale)
        : undefined;
  return <SiteShell locale={r.locale} overHero={pageStartsWithHero(page)}>{body}</SiteShell>;
}
