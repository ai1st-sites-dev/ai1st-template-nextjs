interface TimelineEvent {
  year: string;
  title: string;
  description: string;
}

interface TimelineSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    events: TimelineEvent[];
    variant?: 'vertical' | 'horizontal' | 'compact' | 'milestone';
  };
}

export default function TimelineSection({ data }: TimelineSectionProps) {
  const variant = data.variant || 'vertical';

  if (variant === 'horizontal') {
    return (
      <section className="section-padding" aria-labelledby="timeline-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="timeline-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-16 overflow-x-auto">
            <div className="relative flex items-start gap-0" style={{ minWidth: `${(data.events?.length ?? 0) * 200}px` }}>
              {/* Horizontal connector line */}
              <div className="absolute left-0 right-0 top-5 h-px bg-primary-200" />
              {data.events?.map((event, index) => (
                <div key={index} className="relative flex min-w-[200px] flex-1 flex-col items-center text-center">
                  {/* Year circle badge */}
                  <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
                    {event.year}
                  </div>
                  {/* Vertical connector */}
                  <div className="h-8 w-px bg-primary-200" />
                  {/* Content */}
                  <h3 className="font-bold text-gray-900">{event.title}</h3>
                  <p className="mt-1 px-2 text-sm text-gray-600">{event.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'milestone') {
    return (
      <section className="section-padding" aria-labelledby="timeline-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="timeline-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-16 max-w-3xl space-y-0">
            {data.events?.map((event, index) => (
              <div key={index}>
                <div className="rounded-2xl border border-gray-200 p-8">
                  <p className="text-6xl font-extrabold text-primary-100">{event.year}</p>
                  <h3 className="mt-4 text-xl font-bold text-gray-900">{event.title}</h3>
                  <p className="mt-2 leading-relaxed text-gray-600">{event.description}</p>
                </div>
                {index < (data.events?.length ?? 0) - 1 && (
                  <div className="flex justify-center">
                    <div className="h-8 w-px bg-primary-200" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'compact') {
    return (
      <section className="section-padding" aria-labelledby="timeline-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="timeline-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-3xl">
            {data.events?.map((event, index) => (
              <div
                key={index}
                className={`flex items-start gap-6 py-6 ${index < (data.events?.length ?? 0) - 1 ? 'border-b border-gray-200' : ''}`}
              >
                <span className="w-20 shrink-0 text-2xl font-bold text-accent-500">{event.year}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">{event.title}</h3>
                  <p className="mt-1 text-gray-600">{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Default: vertical
  return (
    <section className="section-padding" aria-labelledby="timeline-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="timeline-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="relative mx-auto mt-16 max-w-3xl">
          {/* Center vertical line */}
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary-200" />
          {data.events?.map((event, index) => (
            <div key={index} className="relative flex items-center py-8">
              {/* Left content (odd events) */}
              <div className={`flex-1 ${index % 2 === 0 ? 'pr-12 text-right' : ''}`}>
                {index % 2 === 0 && (
                  <>
                    <h3 className="font-bold text-gray-900">{event.title}</h3>
                    <p className="mt-1 text-gray-600">{event.description}</p>
                  </>
                )}
              </div>
              {/* Year circle badge on center line */}
              <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white">
                {event.year}
              </div>
              {/* Right content (even events) */}
              <div className={`flex-1 ${index % 2 === 1 ? 'pl-12 text-left' : ''}`}>
                {index % 2 === 1 && (
                  <>
                    <h3 className="font-bold text-gray-900">{event.title}</h3>
                    <p className="mt-1 text-gray-600">{event.description}</p>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
