// TICKET-129b: root URL renders default-locale Home (was forwarding to
// app/[locale]/page; now uses shared components/pages/HomePage component since
// app/[locale]/* is deleted to fix Next.js routing precision collision).
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import HomePage from '@/components/pages/HomePage';
import { homeMetadata } from '@/lib/metadata';
import { defaultLocale } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata(defaultLocale);
}

export default async function RootHomePage() {
  return (
    <SiteShell locale={defaultLocale}>
      <HomePage locale={defaultLocale} />
    </SiteShell>
  );
}
