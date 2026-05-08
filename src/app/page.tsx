import { defaultLocale } from '@/lib/config';

export const metadata = {
  alternates: { canonical: `/${defaultLocale}` },
  robots: { index: false, follow: true },
};

export default function HomePage() {
  const target = `/${defaultLocale}`;
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${target}`} />
      <p>
        Redirecting to <a href={target}>{target}</a>...
      </p>
      <script
        dangerouslySetInnerHTML={{ __html: `window.location.replace(${JSON.stringify(target)});` }}
      />
    </>
  );
}
