interface Area {
  name: string;
  description?: string;
}

interface MapAreaSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    areas: Area[];
    variant?: 'list' | 'cards' | 'grouped' | 'badge';
  };
}

export default function MapAreaSection({ data }: MapAreaSectionProps) {
  const variant = data.variant || 'list';

  if (variant === 'cards') {
    return (
      <section className="section-padding" aria-labelledby="areas-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="areas-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.areas?.map((area, index) => (
              <div key={index} className="rounded-xl border border-gray-200 p-6 transition-shadow hover:shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                  <h3 className="font-semibold text-gray-900">{area.name}</h3>
                </div>
                {area.description && (
                  <p className="mt-2 text-sm text-gray-600">{area.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'badge') {
    return (
      <section className="section-padding" aria-labelledby="areas-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="areas-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 flex flex-wrap gap-2 justify-center">
            {data.areas?.map((area, index) => (
              <span
                key={index}
                className="rounded-full bg-primary-50 border border-primary-200 px-4 py-2 text-sm font-medium text-primary-700"
              >
                {area.name}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'grouped') {
    const midpoint = Math.ceil((data.areas?.length ?? 0) / 2);
    const leftAreas = data.areas?.slice(0, midpoint);
    const rightAreas = data.areas?.slice(midpoint);

    return (
      <section className="section-padding" aria-labelledby="areas-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="areas-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-12 lg:grid-cols-2">
            <div className="space-y-0 divide-y divide-gray-100">
              {leftAreas.map((area, index) => (
                <div key={index} className="flex items-start gap-3 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                  <div>
                    <span className="font-medium text-gray-900">{area.name}</span>
                    {area.description && (
                      <p className="mt-0.5 text-sm text-gray-600">{area.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-0 divide-y divide-gray-100">
              {rightAreas.map((area, index) => (
                <div key={index} className="flex items-start gap-3 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                  <div>
                    <span className="font-medium text-gray-900">{area.name}</span>
                    {area.description && (
                      <p className="mt-0.5 text-sm text-gray-600">{area.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Default: list
  return (
    <section className="section-padding" aria-labelledby="areas-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="areas-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.areas?.map((area, index) => (
            <div key={index} className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <div>
                <span className="font-medium text-gray-900">{area.name}</span>
                {area.description && (
                  <p className="mt-0.5 text-sm text-gray-600">{area.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
