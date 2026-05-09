import Header from './Header';
import Footer from './Footer';
import { LocalBusinessJsonLd, WebSiteJsonLd } from './JsonLd';

// TICKET-129: shared layout wrapper used by [locale]/layout.tsx and the
// default-locale root alias pages (src/app/page.tsx, [...slug]/page.tsx,
// blog/page.tsx, blog/[slug]/page.tsx). Centralizes Header/Footer/JsonLd
// rendering so all entry points produce equivalent UI without duplication.
export default function SiteShell({ locale, children }: { locale: string; children: React.ReactNode }) {
  return (
    <>
      <LocalBusinessJsonLd locale={locale} />
      <WebSiteJsonLd locale={locale} />
      <Header locale={locale} />
      <main className="flex-1">{children}</main>
      <Footer locale={locale} />
    </>
  );
}
