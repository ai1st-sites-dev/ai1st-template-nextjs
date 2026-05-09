import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SiteShell from '@/components/SiteShell';
import { brand, defaultLocale, getSeo, getAlternateLanguages, getXDefaultHref, isValidLocale, locales, localeUrl } from '@/lib/config';

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isValidLocale(locale)) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages('home', seo.domain);
  // TICKET-129: defaultLocale uses root URL alias — canonical of /<defaultLocale>
  // points to / (SEO consolidate); other locales keep /<locale> prefix.
  const canonical = locale === defaultLocale ? '/' : `/${locale}`;
  const ogUrl = locale === defaultLocale ? seo.domain : `${seo.domain}/${locale}`;
  return {
    title: {
      default: seo.siteTitle,
      template: `%s | ${brand.name}`,
    },
    description: seo.siteDescription,
    keywords: seo.keywords,
    alternates: {
      canonical,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref('home', seo.domain) },
      } : {}),
    },
    openGraph: {
      title: seo.siteTitle,
      description: seo.siteDescription,
      url: ogUrl,
      siteName: brand.name,
      locale: seo.locale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.siteTitle,
      description: seo.siteDescription,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();
  // TICKET-129: keep `localeUrl` import-side-effect (for tree-shaking visibility);
  // actual SiteShell wrapping centralized in src/components/SiteShell.tsx so root
  // alias pages can produce identical UI without duplicating Header/Footer/JsonLd.
  void localeUrl;
  return <SiteShell locale={locale}>{children}</SiteShell>;
}
