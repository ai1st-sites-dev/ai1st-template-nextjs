import { getLabels } from '@/lib/component-labels';

interface FeatureComparisonSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    comparisons: { feature: string; us: boolean; them: boolean }[];
    usLabel?: string;
    themLabel?: string;
    variant?: 'table' | 'cards' | 'columns' | 'stacked';
  };
  locale: string;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-5 w-5 text-green-500'} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-5 w-5 text-red-500'} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function FeatureComparisonSection({ data, locale }: FeatureComparisonSectionProps) {
  const variant = data.variant || 'table';
  const usLabel = data.usLabel || 'Us';
  const themLabel = data.themLabel || 'Them';
  const labels = getLabels(locale);

  if (variant === 'cards') {
    return (
      <section className="section-padding" aria-labelledby="comparison-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="comparison-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {data.subheadline}
              </p>
            )}
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2">
            <div className="rounded-xl bg-gray-100 p-8">
              <h3 className="text-xl font-bold text-gray-900">{themLabel}</h3>
              <ul className="mt-6 space-y-4" role="list">
                {data.comparisons?.map((comparison, index) => (
                  <li key={index} className="flex items-center gap-3">
                    {comparison.them ? (
                      <CheckIcon className="h-5 w-5 shrink-0 text-green-500" />
                    ) : (
                      <XIcon className="h-5 w-5 shrink-0 text-red-500" />
                    )}
                    <span className="text-gray-700">{comparison.feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border-2 border-primary-500 bg-primary-50 p-8">
              <h3 className="text-xl font-bold text-primary-900">{usLabel}</h3>
              <ul className="mt-6 space-y-4" role="list">
                {data.comparisons?.map((comparison, index) => (
                  <li key={index} className="flex items-center gap-3">
                    {comparison.us ? (
                      <CheckIcon className="h-5 w-5 shrink-0 text-green-500" />
                    ) : (
                      <XIcon className="h-5 w-5 shrink-0 text-red-500" />
                    )}
                    <span className="text-gray-700">{comparison.feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'columns') {
    return (
      <section className="section-padding" aria-labelledby="comparison-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="comparison-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {data.subheadline}
              </p>
            )}
          </div>
          <div className="mx-auto mt-16 max-w-3xl">
            <div className="grid grid-cols-3 gap-4">
              {/* Header row */}
              <div className="py-3 font-bold text-gray-900">{labels.feature}</div>
              <div className="py-3 text-center font-bold text-gray-500">{themLabel}</div>
              <div className="py-3 text-center font-bold text-primary-600">{usLabel}</div>
              {/* Data rows */}
              {data.comparisons?.map((comparison, index) => (
                <div key={index} className="contents">
                  <div className={`flex items-center py-3 ${index % 2 === 0 ? 'bg-gray-50' : ''} rounded-l-lg pl-3`}>
                    <span className="text-gray-700">{comparison.feature}</span>
                  </div>
                  <div className={`flex items-center justify-center py-3 ${index % 2 === 0 ? 'bg-gray-50' : ''}`}>
                    {comparison.them ? <CheckIcon /> : <XIcon />}
                  </div>
                  <div className={`flex items-center justify-center py-3 ${index % 2 === 0 ? 'bg-gray-50' : ''} rounded-r-lg`}>
                    {comparison.us ? <CheckIcon /> : <XIcon />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'stacked') {
    return (
      <section className="section-padding" aria-labelledby="comparison-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="comparison-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
                {data.subheadline}
              </p>
            )}
          </div>
          <div className="mx-auto mt-16 max-w-2xl space-y-6">
            {data.comparisons?.map((comparison, index) => (
              <div key={index} className="rounded-xl border border-gray-200 bg-white p-6 text-center">
                <p className="font-semibold text-gray-900">{comparison.feature}</p>
                <div className="mt-4 flex items-center justify-center gap-4">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                    comparison.us
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}>
                    {usLabel} {comparison.us ? '\u2713' : '\u2717'}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                    comparison.them
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}>
                    {themLabel} {comparison.them ? '\u2713' : '\u2717'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Default: table
  return (
    <section className="section-padding" aria-labelledby="comparison-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="comparison-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          )}
        </div>
        <div className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full" role="table">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900" scope="col">{labels.feature}</th>
                <th className="px-6 py-4 text-center text-sm font-semibold text-primary-600" scope="col">{usLabel}</th>
                <th className="px-6 py-4 text-center text-sm font-semibold text-gray-500" scope="col">{themLabel}</th>
              </tr>
            </thead>
            <tbody>
              {data.comparisons?.map((comparison, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-6 py-4 text-sm text-gray-700">{comparison.feature}</td>
                  <td className="px-6 py-4">
                    <div className="flex justify-center">
                      {comparison.us ? <CheckIcon /> : <XIcon />}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-center">
                      {comparison.them ? <CheckIcon /> : <XIcon />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
