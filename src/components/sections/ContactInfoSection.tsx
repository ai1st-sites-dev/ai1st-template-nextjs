import { brand } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface ContactInfoSectionProps {
  data: {
    headline: string;
    variant?: 'cards' | 'inline' | 'map-style' | 'banner';
  };
}

export default function ContactInfoSection({ data }: ContactInfoSectionProps) {
  const variant = data.variant || 'cards';

  if (variant === 'map-style') {
    return (
      <section {...blockAttrs('contact-info')} className="section-padding" aria-labelledby="locations-heading">
        <div className="container-width">
          <h2 id="locations-heading" className="text-center text-3xl font-bold text-gray-900">
            {data.headline}
          </h2>
          <div className="mt-12 grid gap-12 lg:grid-cols-2">
            {/* Map placeholder */}
            <div className="h-80 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100" />
            {/* Location details */}
            <div className="flex flex-col justify-center space-y-8">
              {brand.locations.map((location) => (
                <div key={location.label}>
                  <h3 className="text-lg font-semibold text-gray-900">{location.label}</h3>
                  <p className="mt-1 text-gray-600">{location.address}</p>
                  <a href={`tel:${location.phone.replace(/\s/g, '')}`} className="mt-1 inline-block text-sm font-semibold text-primary-600 hover:text-primary-500">
                    {location.phone}
                  </a>
                </div>
              ))}
              <div>
                <a href={`mailto:${brand.email}`} className="text-primary-500 hover:underline">{brand.email}</a>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'banner') {
    return (
      <section {...blockAttrs('contact-info')} className="border-y bg-gray-50 py-6" aria-labelledby="locations-heading">
        <div className="container-width">
          <h2 id="locations-heading" className="sr-only">{data.headline}</h2>
          <div className="flex flex-wrap items-center justify-center">
            {brand.locations.map((location, index) => (
              <div key={location.label} className={`px-8 ${index < brand.locations.length - 1 ? 'border-r border-gray-300' : ''}`}>
                <p className="font-bold text-gray-900">{location.label}</p>
                <p className="text-sm text-gray-600">{location.address}</p>
                <a href={`tel:${location.phone.replace(/\s/g, '')}`} className="text-sm font-semibold text-primary-600 hover:text-primary-500">
                  {location.phone}
                </a>
              </div>
            ))}
            <div className="px-8">
              <a href={`mailto:${brand.email}`} className="text-sm font-semibold text-primary-500 hover:underline">{brand.email}</a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <section {...blockAttrs('contact-info')} className="bg-gray-50 section-padding" aria-labelledby="locations-heading">
        <div className="container-width">
          <h2 id="locations-heading" className="text-center text-3xl font-bold text-gray-900">
            {data.headline}
          </h2>
          <div className="mx-auto mt-10 max-w-2xl divide-y divide-gray-200 rounded-xl bg-white shadow-sm">
            {brand.locations.map((location) => (
              <div key={location.label} className="flex items-center justify-between px-8 py-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{location.label}</h3>
                  <p className="mt-1 text-sm text-gray-600">{location.address}</p>
                </div>
                <a href={`tel:${location.phone.replace(/\s/g, '')}`} className="text-sm font-semibold text-primary-600 hover:text-primary-500">
                  {location.phone}
                </a>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-gray-600">
            <a href={`mailto:${brand.email}`} className="text-primary-500 hover:underline">{brand.email}</a>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('contact-info')} className="section-padding" aria-labelledby="locations-heading">
      <div className="container-width">
        <h2 id="locations-heading" className="text-center text-3xl font-bold text-gray-900">
          {data.headline}
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {brand.locations.map((location) => (
            <div key={location.label} className="rounded-xl border border-gray-200 p-8 text-center">
              <h3 className="text-xl font-semibold text-gray-900">{location.label}</h3>
              <p className="mt-2 text-gray-600">{location.address}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <p className="text-gray-600">
            {brand.locations.map((location, i) => (
              <span key={location.label}>
                {i > 0 && <> &nbsp;|&nbsp; </>}
                <strong>{location.label.replace(' Office', '')}:</strong> {location.phone}
              </span>
            ))}
          </p>
          <p className="mt-2 text-gray-600">
            <a href={`mailto:${brand.email}`} className="text-primary-500 hover:underline">{brand.email}</a>
          </p>
        </div>
      </div>
    </section>
  );
}
