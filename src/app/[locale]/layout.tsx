import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { LocalBusinessJsonLd, WebSiteJsonLd } from '@/components/JsonLd';
import { brand, getSeo, getAlternateLanguages, getXDefaultHref, isValidLocale, locales } from '@/lib/config';

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isValidLocale(locale)) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages('home', seo.domain);
  return {
    title: {
      default: seo.siteTitle,
      template: `%s | ${brand.name}`,
    },
    description: seo.siteDescription,
    keywords: seo.keywords,
    alternates: {
      canonical: `/${locale}`,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref('home', seo.domain) },
      } : {}),
    },
    openGraph: {
      title: seo.siteTitle,
      description: seo.siteDescription,
      url: `${seo.domain}/${locale}`,
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
