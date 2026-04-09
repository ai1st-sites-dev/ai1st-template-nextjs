import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { LocalBusinessJsonLd, WebSiteJsonLd } from '@/components/JsonLd';
import { brand, seo } from '@/lib/config';

// Generate SVG favicon data URI from brand name + primary color
function buildFaviconSvg(): string {
  const letter = (brand.name || 'X').charAt(0).toUpperCase();
  const bg = brand.colors.primary[500] || '#6366f1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${bg}"/><text x="16" y="23" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="20" font-weight="bold">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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
        {brand.logoUrl ? (
          <link rel="icon" href={brand.logoUrl} />
        ) : (
          <>
            <link rel="icon" type="image/svg+xml" href={buildFaviconSvg()} />
            <link rel="icon" href="/favicon.ico" sizes="any" />
          </>
        )}
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
