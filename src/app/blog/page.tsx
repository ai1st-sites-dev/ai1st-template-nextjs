// TICKET-129b: default-locale blog index. Uses shared BlogIndexPage component
// since app/[locale]/* is deleted.
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import SiteRender from '@/components/SiteRender';
import BlogIndexPage from '@/components/pages/BlogIndexPage';
import { blogIndexMetadata } from '@/lib/metadata';
import { requestSiteData } from '@/lib/site-data.server';

export async function generateMetadata(): Promise<Metadata> {
  const site = await requestSiteData();
  return blogIndexMetadata(site, site.defaultLocale);
}

export default async function RootBlogIndex() {
  const site = await requestSiteData();
  // #1833 r2 —— 站页面：包在 SiteRender 里，Custom HTML 块才原样写老板的代码（`lib/editor-canvas.ts` §SiteRenderContext）。
  return (
    <SiteRender>
      <SiteShell site={site} locale={site.defaultLocale} currentPath="/blog">
        <BlogIndexPage site={site} locale={site.defaultLocale} />
      </SiteShell>
    </SiteRender>
  );
}
