import Link from 'next/link';
import { pagesByLocale, localeUrl } from '@/lib/config';

interface ServiceRelatedPagesSectionProps {
  data: {
    serviceSlug: string;
    headline: string;
    subheadline?: string;
  };
  locale: string;
}

export default function ServiceRelatedPagesSection({ data, locale }: ServiceRelatedPagesSectionProps) {
  const allPages = pagesByLocale[locale] ?? [];
  const relatedPages = allPages.filter(
    (p) => p.slug.startsWith(`${data.serviceSlug}/`) && p.slug !== data.serviceSlug
  );

  if (relatedPages.length === 0) return null;

  return (
    <section className="section-padding bg-gray-50" aria-labelledby="related-pages-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="related-pages-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {relatedPages.map((page) => (
            <Link
              key={page.slug}
              href={localeUrl(page.slug, locale)}
              className="group rounded-xl border border-gray-200 bg-white p-6 transition-all hover:border-primary-300 hover:shadow-lg"
            >
              <h3 className="font-semibold text-gray-900 group-hover:text-primary-600">
                {page.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{page.description}</p>
              <span className="mt-4 inline-flex items-center text-sm font-medium text-primary-600">
                Learn more
                <svg className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
