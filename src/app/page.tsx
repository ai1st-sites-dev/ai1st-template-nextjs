// TICKET-129: root URL aliases the default-locale Home content.
//   /                 → renders default-locale Home (was a meta-refresh redirect)
//   /<defaultLocale>  → still works (alias kept for backward compat / hreflang sources)
// SiteShell + LocaleHomePage are reused from the [locale] subtree so the rendered
// HTML is byte-equivalent (modulo the canonical URL adjusted in generateMetadata).
import LocaleHomePage from './[locale]/page';
import SiteShell from '@/components/SiteShell';
import { defaultLocale } from '@/lib/config';

export default async function HomePage() {
  return (
    <SiteShell locale={defaultLocale}>
      <LocaleHomePage params={Promise.resolve({ locale: defaultLocale })} />
    </SiteShell>
  );
}
