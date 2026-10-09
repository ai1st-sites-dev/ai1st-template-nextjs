// TICKET-129b: root URL renders default-locale Home (was forwarding to
// app/[locale]/page; now uses shared components/pages/HomePage component since
// app/[locale]/* is deleted to fix Next.js routing precision collision).
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import HomePage from '@/components/pages/HomePage';
import { homeMetadata } from '@/lib/metadata';
import { getHomePage } from '@/lib/config';
import { requestSiteData } from '@/lib/site-data.server';

export async function generateMetadata(): Promise<Metadata> {
  const site = await requestSiteData();
  return homeMetadata(site, site.defaultLocale);
}

export default async function RootHomePage() {
  const site = await requestSiteData();
  const { defaultLocale } = site;
  return (
    <SiteShell site={site} locale={defaultLocale} page={getHomePage(site, defaultLocale)?.slug}>
      <HomePage site={site} locale={defaultLocale} />
    </SiteShell>
  );
}
