// TICKET-129: default-locale catch-all alias. Mirrors /[locale]/[...slug]/page.tsx
// with locale locked to defaultLocale. Generated paths are the default-locale
// pages without the /<locale> prefix (e.g. /about instead of /en/about).
import type { Metadata } from 'next';
import LocaleSlugPage, {
  generateStaticParams as localeGenerate,
  generateMetadata as localeMetadata,
} from '../[locale]/[...slug]/page';
import SiteShell from '@/components/SiteShell';
import { defaultLocale } from '@/lib/config';

export async function generateStaticParams() {
  const localeParams = await localeGenerate();
  return localeParams
    .filter((p) => p.locale === defaultLocale)
    .map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug } = await params;
  return localeMetadata({ params: Promise.resolve({ locale: defaultLocale, slug }) });
}

export default async function RootSlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return (
    <SiteShell locale={defaultLocale}>
      <LocaleSlugPage params={Promise.resolve({ locale: defaultLocale, slug })} />
    </SiteShell>
  );
}
