// TICKET-129b: default-locale blog index. Uses shared BlogIndexPage component
// since app/[locale]/* is deleted.
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import BlogIndexPage from '@/components/pages/BlogIndexPage';
import { blogIndexMetadata } from '@/lib/metadata';
import { defaultLocale } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  return blogIndexMetadata(defaultLocale);
}

export default async function RootBlogIndex() {
  return (
    <SiteShell locale={defaultLocale}>
      <BlogIndexPage locale={defaultLocale} />
    </SiteShell>
  );
}
