interface Award {
  title: string;
  description?: string;
  year?: string;
}

interface AwardsCertificationsSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    awards: Award[];
    variant?: 'grid' | 'banner' | 'detailed';
  };
}

export default function AwardsCertificationsSection({ data }: AwardsCertificationsSectionProps) {
  const variant = data.variant || 'grid';

  if (variant === 'banner') {
    return (
      <section className="bg-gray-50 border-y border-gray-200 py-8" aria-labelledby="awards-heading">
        <div className="container-width">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-0">
            <h2 id="awards-heading" className="shrink-0 text-sm font-semibold uppercase tracking-wider text-gray-500 sm:mr-8">
              {data.headline}
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-y-4">
              {data.awards.map((award, index) => (
                <div key={index} className="flex items-center gap-2 px-6">
                  {index > 0 && (
                    <div className="hidden h-8 w-px bg-gray-300 sm:block" aria-hidden="true" />
                  )}
                  <svg className="ml-2 h-5 w-5 shrink-0 text-accent-500" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">{award.title}</span>
                  {award.year && (
                    <span className="text-xs text-gray-400">{award.year}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'detailed') {
    return (
      <section className="section-padding" aria-labelledby="awards-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="awards-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {data.awards.map((award, index) => (
              <div key={index} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="h-1 bg-gradient-to-r from-primary-500 to-accent-500" />
                <div className="p-8">
                  {award.year && (
                    <p className="text-5xl font-extrabold text-gray-100">{award.year}</p>
                  )}
                  <h3 className="mt-2 text-xl font-bold text-gray-900">{award.title}</h3>
                  {award.description && (
                    <p className="mt-3 leading-relaxed text-gray-600">{award.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section-padding" aria-labelledby="awards-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="awards-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.awards.map((award, index) => (
            <div key={index} className="rounded-xl border border-gray-200 bg-white p-6 text-center transition-all hover:border-primary-300 hover:shadow-md">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-50">
                <svg className="h-7 w-7 text-accent-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 1l3.09 6.26L22 8.27l-5 4.87 1.18 6.88L12 16.77l-6.18 3.25L7 13.14 2 8.27l6.91-1.01L12 1z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-bold text-gray-900">{award.title}</h3>
              {award.year && (
                <span className="mt-2 inline-block rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                  {award.year}
                </span>
              )}
              {award.description && (
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{award.description}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
