import Link from 'next/link';
import ServiceIcon from '@/components/ServiceIcon';
import { getServices, pagesByLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

export default function ServicesListSection({ locale, block }: { locale: string; block?: BlockConfig }) {
  const services = getServices(locale);
  const labels = getLabels(locale);
  const allPages = pagesByLocale[locale] ?? [];
  const serviceDetailSlugs = new Set(
    allPages.filter(p => p.slug.startsWith('services/') && p.slug !== 'services').map(p => p.slug.replace('services/', ''))
  );

  return (
    <div {...blockAttrs('services-list', block)} className="container-width px-4 py-16 sm:px-6 lg:px-8">
      {services.map((service, index) => (
        <article
          key={service.id}
          id={service.id}
          className={`scroll-mt-32 py-16 ${index !== 0 ? 'border-t border-gray-200' : ''}`}
        >
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
                <ServiceIcon icon={service.icon} className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                {service.name}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-gray-600">
                {service.fullDescription}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={localeUrl('quote', locale)} className="btn-primary">
                  {labels.getAQuoteFor} {service.name}
                </Link>
                {serviceDetailSlugs.has(service.id) && (
                  <Link href={localeUrl(`services/${service.id}`, locale)} className="btn-secondary">
                    {labels.learnMore}
                  </Link>
                )}
              </div>
            </div>

            <div>
              <div className="rounded-xl bg-gray-50 p-8">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">{labels.keyFeatures}</h3>
                <ul className="space-y-3">
                  {service.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                      </svg>
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {service.products.length > 0 && (
                <div className="mt-6 rounded-xl border border-gray-200 p-8">
                  <h3 className="mb-4 text-lg font-semibold text-gray-900">{labels.productsWeOffer}</h3>
                  <div className="space-y-4">
                    {service.products.map((product) => (
                      <div key={product.name}>
                        <h4 className="font-medium text-gray-900">{product.name}</h4>
                        <p className="mt-1 text-sm text-gray-600">{product.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
