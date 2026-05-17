interface Step {
  title: string;
  description: string;
}

interface ProcessStepsSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    steps: Step[];
    variant?: 'horizontal' | 'vertical' | 'cards' | 'zigzag' | 'icon-strip';
  };
}

export default function ProcessStepsSection({ data }: ProcessStepsSectionProps) {
  const variant = data.variant || 'horizontal';

  if (variant === 'cards') {
    return (
      <section className="section-padding" aria-labelledby="process-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="process-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {data.steps?.map((step, index) => (
              <div key={index} className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-8">
                <span className="absolute right-4 top-2 text-7xl font-extrabold text-primary-100">
                  {index + 1}
                </span>
                <div className="relative">
                  <h3 className="text-lg font-semibold text-gray-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'zigzag') {
    return (
      <section className="section-padding" aria-labelledby="process-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="process-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="relative mx-auto mt-16 max-w-3xl">
            {/* Vertical center line */}
            <div className="absolute left-1/2 top-0 h-full w-px bg-primary-200" />
            {data.steps?.map((step, index) => (
              <div
                key={index}
                className={`relative flex items-center gap-6 py-8 ${index % 2 === 1 ? 'flex-row-reverse' : ''}`}
              >
                <div className={`flex-1 ${index % 2 === 1 ? 'text-left' : 'text-right'}`}>
                  <h3 className="text-xl font-semibold text-gray-900">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-gray-600">{step.description}</p>
                </div>
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-500 text-lg font-bold text-white">
                  {index + 1}
                </div>
                <div className="flex-1" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'icon-strip') {
    return (
      <section className="section-padding" aria-labelledby="process-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="process-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-16 flex items-center justify-between">
            {data.steps?.map((step, index) => (
              <div key={index} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <span className="mt-2 text-sm font-semibold text-gray-900">{step.title}</span>
                </div>
                {index < (data.steps?.length ?? 0) - 1 && (
                  <div className="mx-3 h-0.5 flex-1 bg-primary-200" style={{ minWidth: '2rem' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'vertical') {
    return (
      <section className="section-padding" aria-labelledby="process-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="process-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-16 max-w-2xl">
            {data.steps?.map((step, index) => (
              <div key={index} className="relative flex gap-6 pb-12 last:pb-0">
                {/* Vertical line */}
                {index < (data.steps?.length ?? 0) - 1 && (
                  <div className="absolute left-6 top-12 h-full w-px bg-primary-200" />
                )}
                {/* Step number */}
                <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-500 text-lg font-bold text-white">
                  {index + 1}
                </div>
                <div className="pt-1">
                  <h3 className="text-xl font-semibold text-gray-900">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-gray-600">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gray-50 section-padding" aria-labelledby="process-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="process-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {data.steps?.map((step, index) => (
            <div key={index} className="relative text-center">
              {/* Connector line */}
              {index < (data.steps?.length ?? 0) - 1 && (
                <div className="absolute left-1/2 top-6 hidden h-px w-full bg-primary-200 lg:block" />
              )}
              <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-500 text-lg font-bold text-white">
                {index + 1}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
