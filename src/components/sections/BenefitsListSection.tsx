import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface BenefitsListSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: { title: string; description: string }[];
    variant?: 'alternating' | 'icon-large' | 'numbered-large' | 'cards-horizontal';
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

const gradientCycles = [
  'bg-gradient-to-br from-primary-100 to-accent-100',
  'bg-gradient-to-br from-accent-100 to-primary-100',
  'bg-gradient-to-br from-primary-50 to-accent-50',
  'bg-gradient-to-br from-accent-50 to-primary-50',
];

export default function BenefitsListSection({ data, block }: BenefitsListSectionProps) {
  const variant = data.variant || 'alternating';

  if (variant === 'icon-large') {
    return (
      <section {...blockAttrs('benefits-list', block)} className="section-padding" aria-labelledby="benefits-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="benefits-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {data.subheadline}
              </p>
            )}
          </div>
          <div className="mt-16">
            {data.items?.map((item, index) => (
              <div
                key={index}
                className={`flex items-start gap-6 py-8 ${
                  index < (data.items?.length ?? 0) - 1 ? 'border-b border-gray-200' : ''
                }`}
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-100" aria-hidden="true">
                  <svg className="h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{item.title}</h3>
                  <p className="mt-2 leading-relaxed text-gray-600">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'numbered-large') {
    return (
      <section {...blockAttrs('benefits-list', block)} className="section-padding" aria-labelledby="benefits-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="benefits-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {data.subheadline}
              </p>
            )}
          </div>
          <div className="mt-16 space-y-16">
            {data.items?.map((item, index) => (
              <div key={index} className="relative">
                <span
                  className="absolute -top-4 left-0 select-none text-7xl font-extrabold text-primary-100"
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="relative pl-2 pt-10">
                  <h3 className="text-xl font-bold text-gray-900">{item.title}</h3>
                  <p className="mt-2 max-w-2xl leading-relaxed text-gray-600">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'cards-horizontal') {
    return (
      <section {...blockAttrs('benefits-list', block)} className="section-padding" aria-labelledby="benefits-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="benefits-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {data.subheadline}
              </p>
            )}
          </div>
          <div className="relative mt-16">
            <div className="flex gap-6 overflow-x-auto pb-4" role="list">
              {data.items?.map((item, index) => (
                <div
                  key={index}
                  role="listitem"
                  className="min-w-[300px] shrink-0 rounded-xl border border-gray-200 p-6"
                >
                  <h3 className="font-bold text-gray-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{item.description}</p>
                </div>
              ))}
            </div>
            {/* Scroll hint gradient on right edge */}
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent" aria-hidden="true" />
          </div>
        </div>
      </section>
    );
  }

  // Default: alternating
  return (
    <section {...blockAttrs('benefits-list', block)} className="section-padding" aria-labelledby="benefits-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="benefits-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          )}
        </div>
        <div className="mt-16 space-y-12">
          {data.items?.map((item, index) => (
            <div key={index} className="grid items-center gap-8 lg:grid-cols-2">
              {index % 2 === 0 ? (
                <>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">{item.title}</h3>
                    <p className="mt-3 leading-relaxed text-gray-600">{item.description}</p>
                  </div>
                  <div>
                    <div
                      className={`h-48 rounded-2xl ${gradientCycles[index % gradientCycles.length]}`}
                      aria-hidden="true"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="lg:order-2">
                    <h3 className="text-2xl font-bold text-gray-900">{item.title}</h3>
                    <p className="mt-3 leading-relaxed text-gray-600">{item.description}</p>
                  </div>
                  <div className="lg:order-1">
                    <div
                      className={`h-48 rounded-2xl ${gradientCycles[index % gradientCycles.length]}`}
                      aria-hidden="true"
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
