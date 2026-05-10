import { getLabels } from '@/lib/component-labels';

interface ContentSplitSectionProps {
  data: {
    headline: string;
    content: string;
    bullets?: string[];
    stats?: { value: string; label: string }[];
    variant?: 'text-left' | 'text-right' | 'text-left-stats' | 'text-right-list' | 'centered-overlay' | 'cards-row';
    imageUrl?: string;
  };
  locale: string;
}

export default function ContentSplitSection({ data, locale }: ContentSplitSectionProps) {
  const variant = data.variant || 'text-left';
  const labels = getLabels(locale);

  if (variant === 'text-right') {
    return (
      <section className="section-padding" aria-labelledby="content-split-heading">
        <div className="container-width">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="lg:order-2">
              <h2 id="content-split-heading" className="text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
              <p className="mt-4 leading-relaxed text-gray-600">
                {data.content}
              </p>
              <p className="mt-6">
                <span className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700">
                  {labels.learnMore}
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </span>
              </p>
            </div>
            <div className="lg:order-1">
              {data.imageUrl ? (
                <img src={data.imageUrl} alt={data.headline} className="h-80 w-full rounded-2xl object-cover" />
              ) : (
                <div className="h-80 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100" aria-hidden="true" />
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'text-left-stats') {
    return (
      <section className="section-padding" aria-labelledby="content-split-heading">
        <div className="container-width">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 id="content-split-heading" className="text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
              <p className="mt-4 leading-relaxed text-gray-600">
                {data.content}
              </p>
            </div>
            <div className="rounded-2xl bg-primary-50 p-8">
              {data.stats && data.stats.length > 0 && (
                <div className="grid grid-cols-2 gap-6">
                  {data.stats.map((stat, index) => (
                    <div key={index} className="text-center">
                      <p className="text-2xl font-bold text-primary-600">{stat.value}</p>
                      <p className="mt-1 text-sm text-gray-600">{stat.label}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'text-right-list') {
    return (
      <section className="section-padding" aria-labelledby="content-split-heading">
        <div className="container-width">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              {data.imageUrl ? (
                <img src={data.imageUrl} alt={data.headline} className="h-80 w-full rounded-2xl object-cover" />
              ) : (
                <div className="h-80 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2 id="content-split-heading" className="text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
              <p className="mt-4 leading-relaxed text-gray-600">
                {data.content}
              </p>
              {data.bullets && data.bullets.length > 0 && (
                <ul className="mt-6 space-y-3" role="list">
                  {data.bullets.map((bullet, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <svg className="mt-0.5 h-5 w-5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-gray-700">{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'cards-row') {
    const cards = data.bullets && data.bullets.length > 0 ? data.bullets.slice(0, 3) : [];
    return (
      <section className="section-padding" aria-labelledby="content-split-heading">
        <div className="container-width">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="content-split-heading" className="text-3xl font-bold text-gray-900">
              {data.headline}
            </h2>
            <p className="mt-4 leading-relaxed text-gray-600">
              {data.content}
            </p>
          </div>
          {cards.length > 0 && (
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, index) => (
                <div key={index} className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="h-2 bg-gradient-to-r from-primary-500 to-accent-500" aria-hidden="true" />
                  <div className="p-6">
                    <h3 className="font-semibold text-gray-900">{card}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                      Learn more about how this helps your business grow and succeed.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'centered-overlay') {
    return (
      <section className="bg-gradient-to-br from-primary-100 to-accent-50 section-padding" aria-labelledby="content-split-heading">
        <div className="container-width flex justify-center">
          <div className="max-w-3xl rounded-2xl bg-white/90 p-12 shadow-lg">
            <h2 id="content-split-heading" className="text-center text-3xl font-bold text-gray-900">
              {data.headline}
            </h2>
            <p className="mt-4 text-center leading-relaxed text-gray-600">
              {data.content}
            </p>
            {data.bullets && data.bullets.length > 0 && (
              <ul className="mt-6 space-y-3" role="list">
                {data.bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span className="text-gray-700">{bullet}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Default: text-left
  return (
    <section className="section-padding" aria-labelledby="content-split-heading">
      <div className="container-width">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 id="content-split-heading" className="text-3xl font-bold text-gray-900">
              {data.headline}
            </h2>
            <p className="mt-4 leading-relaxed text-gray-600">
              {data.content}
            </p>
            <p className="mt-6">
              <span className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-700">
                {labels.learnMore}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </p>
          </div>
          <div>
            {data.imageUrl ? (
              <img src={data.imageUrl} alt={data.headline} className="h-80 w-full rounded-2xl object-cover" />
            ) : (
              <div className="h-80 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
