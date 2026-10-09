// TICKET-129b: default-locale blog index. Uses shared BlogIndexPage component
// since app/[locale]/* is deleted.
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import BlogIndexPage from '@/components/pages/BlogIndexPage';
import { blogIndexMetadata } from '@/lib/metadata';
import { requestSiteData } from '@/lib/site-data.server';

export async function generateMetadata(): Promise<Metadata> {
  const site = await requestSiteData();
  return blogIndexMetadata(site, site.defaultLocale);
}

export default async function RootBlogIndex() {
  const site = await requestSiteData();
  return (
    <SiteShell site={site} locale={site.defaultLocale}>
      <BlogIndexPage site={site} locale={site.defaultLocale} />
    </SiteShell>
  );
}
