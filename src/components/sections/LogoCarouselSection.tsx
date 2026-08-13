import { blockAttrs } from '@/lib/sections/blockAttrs';

interface LogoCarouselSectionProps {
  data: {
    headline?: string;
    logos: string[];
    variant?: 'scroll' | 'grid' | 'bordered' | 'dark';
  };
}

export default function LogoCarouselSection({ data }: LogoCarouselSectionProps) {
  const variant = data.variant || 'scroll';

  if (variant === 'bordered') {
    return (
      <section {...blockAttrs('logo-carousel')} className="section-padding" aria-label="Partners and certifications">
        <div className="container-width">
          {data.headline && (
            <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 sm:text-3xl">
              {data.headline}
            </h2>
          )}
          <div className="flex flex-wrap items-center justify-center gap-8">
            {data.logos?.map((logo, index) => (
              <div key={index} className="rounded-lg border-b-2 border-accent-500 bg-white p-6">
                <span className="text-sm font-bold text-gray-400">{logo}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'dark') {
    return (
      <section {...blockAttrs('logo-carousel')} className="border-y border-primary-800 bg-primary-900 py-8" aria-label="Partners and certifications">
        <div className="container-width">
          {data.headline && (
            <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-primary-400">
              {data.headline}
            </p>
          )}
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.logos?.map((logo, index) => (
              <div key={index} className="flex items-center justify-center px-6 py-8">
                <span className="text-center text-sm font-bold text-primary-300">{logo}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'grid') {
    return (
      <section {...blockAttrs('logo-carousel')} className="section-padding" aria-label="Partners and certifications">
        <div className="container-width">
          {data.headline && (
            <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 sm:text-3xl">
              {data.headline}
            </h2>
          )}
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {data.logos?.map((logo, index) => (
              <div key={index} className="flex items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-8">
                <span className="text-center text-sm font-bold text-gray-400">{logo}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Scrolling marquee variant
  return (
    <section {...blockAttrs('logo-carousel')} className="overflow-hidden border-y bg-white py-8" aria-label="Partners and certifications">
      <div className="container-width">
        {data.headline && (
          <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-gray-500">
            {data.headline}
          </p>
        )}
      </div>
      <div className="relative flex">
        <div className="flex shrink-0 animate-[scroll_20s_linear_infinite] gap-12 px-6">
          {[...(data.logos ?? []), ...(data.logos ?? [])].map((logo, index) => (
            <span key={index} className="whitespace-nowrap text-lg font-bold text-gray-400">
              {logo}
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
