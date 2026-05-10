import type { Metadata } from 'next';
import './globals.css';
import { brand, getSeo, getBrandName, defaultLocale } from '@/lib/config';

const seo = getSeo(defaultLocale);
// TICKET-136: layout.tsx is a server component with no locale prop — use the
// default-locale brand name for the site-wide baseline metadata (per-page
// metadata builders in lib/metadata.ts already pass locale through).
const defaultBrandName = getBrandName(defaultLocale);

function buildFaviconSvg(): string {
  const letter = (defaultBrandName || 'X').charAt(0).toUpperCase();
  const bg = brand.colors.primary[500] || '#6366f1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${bg}"/><text x="16" y="23" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="20" font-weight="bold">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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
    template: `%s | ${defaultBrandName}`,
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
    siteName: defaultBrandName,
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
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        {/* TICKET-131: when this page is embedded in an iframe (dashboard
            PreviewPanel), notify the parent on every navigation so the URL bar
            stays in sync. Standalone production users (window.parent === window)
            short-circuit immediately — script is a no-op for them. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(window.parent===window)return;function n(){try{window.parent.postMessage({type:"xsite:nav",path:window.location.pathname+window.location.search+window.location.hash},"*");}catch(e){}}n();var p=history.pushState;history.pushState=function(){p.apply(this,arguments);n();};var r=history.replaceState;history.replaceState=function(){r.apply(this,arguments);n();};window.addEventListener("popstate",n);})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
