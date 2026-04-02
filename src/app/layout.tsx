import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { LocalBusinessJsonLd, WebSiteJsonLd } from '@/components/JsonLd';
import { brand, seo } from '@/lib/config';

// Build CSS custom properties string from brand config
function buildCssVariables(): string {
  const vars: string[] = [];
  for (const [shade, value] of Object.entries(brand.colors.primary)) {
    vars.push(`--color-primary-${shade}: ${value};`);
  }
  for (const [shade, value] of Object.entries(brand.colors.accent)) {
    vars.push(`--color-accent-${shade}: ${value};`);
  }
  vars.push(`--font-sans: ${brand.fonts.body.join(', ')};`);
  return `:root { ${vars.join(' ')} }`;
}

export const metadata: Metadata = {
  title: {
    default: seo.siteTitle,
    template: `%s | ${brand.name}`,
  },
  description: seo.siteDescription,
  keywords: seo.keywords,
  metadataBase: new URL(seo.domain),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: seo.siteTitle,
    description: seo.siteDescription,
    url: seo.domain,
    siteName: brand.name,
    locale: seo.locale,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: seo.siteTitle,
    description: seo.siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: seo.verification,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={seo.locale.split('_')[0]}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: buildCssVariables() }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={brand.fonts.googleFontsUrl} />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <LocalBusinessJsonLd />
        <WebSiteJsonLd />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
