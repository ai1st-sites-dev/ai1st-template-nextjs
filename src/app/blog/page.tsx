// TICKET-129: default-locale blog index alias.
//   /blog               → renders default-locale blog (PM补完, user §60-63 missed it)
//   /<defaultLocale>/blog → still works (existing path, alias kept)
import type { Metadata } from 'next';
import LocaleBlogIndex, { generateMetadata as localeMetadata } from '../[locale]/blog/page';
import SiteShell from '@/components/SiteShell';
import { defaultLocale } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  return localeMetadata({ params: Promise.resolve({ locale: defaultLocale }) });
}

export default async function RootBlogIndex() {
  return (
    <SiteShell locale={defaultLocale}>
      <LocaleBlogIndex params={Promise.resolve({ locale: defaultLocale })} />
    </SiteShell>
  );
}
