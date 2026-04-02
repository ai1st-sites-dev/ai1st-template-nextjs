import Link from 'next/link';
import ServiceIcon from '@/components/ServiceIcon';
import { services, allPages } from '@/lib/config';

interface FeaturesGridSectionProps {
  data: {
    headline: string;
    subheadline: string;
    columns?: 2 | 3 | 4;
    variant?: 'card' | 'icon-top' | 'list' | 'alternating' | 'bordered' | 'minimal';
  };
}

const colClasses = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
};

export default function FeaturesGridSection({ data }: FeaturesGridSectionProps) {
  const columns = data.columns || 4;
  const variant = data.variant || 'card';
  const serviceDetailSlugs = new Set(
    allPages.filter(p => p.slug.startsWith('services/') && p.slug !== 'services').map(p => p.slug.replace('services/', ''))
  );
  const getServiceHref = (id: string) => serviceDetailSlugs.has(id) ? `/services/${id}` : `/services#${id}`;

  if (variant === 'list') {
    return (
      <section className="section-padding" aria-labelledby="services-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="services-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className="mt-16">
            {services.map((service, index) => (
              <Link
                key={service.id}
                href={getServiceHref(service.id)}
                className={`group flex items-start gap-6 py-6 transition-colors hover:bg-gray-50 ${
                  index < services.length - 1 ? 'border-b border-gray-200' : ''
                }`}
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white">
                  <ServiceIcon icon={service.icon} className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{service.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{service.shortDescription}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'alternating') {
    return (
      <section className="section-padding" aria-labelledby="services-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="services-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className="mt-16 grid gap-8 sm:grid-cols-2">
            {services.map((service, index) => (
              <Link
                key={service.id}
                href={getServiceHref(service.id)}
                className={`group p-6 transition-all ${
                  index % 2 === 0
                    ? 'rounded-xl bg-primary-50 hover:bg-primary-100'
                    : 'rounded-xl border border-gray-200 bg-white hover:border-primary-300 hover:shadow-lg'
                }`}
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white">
                  <ServiceIcon icon={service.icon} className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-gray-900">{service.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{service.shortDescription}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'minimal') {
    return (
      <section className="section-padding" aria-labelledby="services-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="services-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className="mx-auto mt-16 grid max-w-5xl gap-x-12 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service, index) => (
              <Link
                key={service.id}
                href={getServiceHref(service.id)}
                className={`group flex items-start gap-4 py-8 transition-colors hover:bg-gray-50 ${
                  index < services.length - (services.length % 3 === 0 ? 3 : services.length % 3)
                    ? 'border-b border-gray-100'
                    : ''
                }`}
              >
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-primary-200 transition-colors group-hover:bg-primary-500" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-gray-900">{service.name}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{service.shortDescription}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'bordered') {
    return (
      <section className="section-padding" aria-labelledby="services-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="services-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className={`mt-16 grid gap-8 ${colClasses[columns]}`}>
            {services.map((service) => (
              <Link
                key={service.id}
                href={getServiceHref(service.id)}
                className="group border-l-4 border-primary-500 bg-white p-6 transition-shadow hover:shadow-sm"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white">
                  <ServiceIcon icon={service.icon} className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-gray-900">{service.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{service.shortDescription}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section-padding" aria-labelledby="services-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="services-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            {data.subheadline}
          </p>
        </div>
        <div className={`mt-16 grid gap-8 ${colClasses[columns]}`}>
          {services.map((service) => (
            <Link
              key={service.id}
              href={getServiceHref(service.id)}
              className={`group transition-all ${
                variant === 'icon-top'
                  ? 'rounded-xl bg-gray-50 p-8 text-center hover:bg-white hover:shadow-lg'
                  : 'rounded-xl border border-gray-200 p-6 hover:border-primary-300 hover:shadow-lg'
              }`}
            >
              <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50 text-primary-500 transition-colors group-hover:bg-primary-500 group-hover:text-white ${
                variant === 'icon-top' ? 'mx-auto h-14 w-14' : ''
              }`}>
                <ServiceIcon icon={service.icon} className={variant === 'icon-top' ? 'h-7 w-7' : 'h-6 w-6'} />
              </div>
              <h3 className={`font-semibold text-gray-900 ${variant === 'icon-top' ? 'text-xl' : 'text-lg'}`}>{service.name}</h3>
              <p className={`mt-2 leading-relaxed text-gray-600 ${variant === 'icon-top' ? 'text-sm' : 'text-sm'}`}>
                {service.shortDescription}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
