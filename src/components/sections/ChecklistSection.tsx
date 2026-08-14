import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ChecklistSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: string[];
    variant?: 'two-column' | 'cards' | 'numbered-steps' | 'icon-grid';
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

export default function ChecklistSection({ data, block }: ChecklistSectionProps) {
  const variant = data.variant || 'two-column';

  if (variant === 'cards') {
    return (
      <section {...blockAttrs('checklist', block)} className="section-padding" aria-labelledby="checklist-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="checklist-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items?.map((item, index) => (
              <div key={index} className="flex items-center gap-3 rounded-lg border border-gray-200 p-4 transition-colors hover:border-primary-300">
                <svg className="h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-gray-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'icon-grid') {
    return (
      <section {...blockAttrs('checklist', block)} className="section-padding" aria-labelledby="checklist-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="checklist-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
            {data.items?.map((item, index) => (
              <div key={index} className="flex flex-col items-center text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-primary-50">
                  <svg className="h-10 w-10 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <span className="mt-3 text-sm font-medium text-gray-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'numbered-steps') {
    return (
      <section {...blockAttrs('checklist', block)} className="section-padding" aria-labelledby="checklist-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="checklist-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-2xl">
            {data.items?.map((item, index) => (
              <div
                key={index}
                className={`flex items-center gap-4 py-4 ${index < (data.items?.length ?? 0) - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <span className="text-gray-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Default: two-column
  return (
    <section {...blockAttrs('checklist', block)} className="section-padding" aria-labelledby="checklist-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="checklist-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {data.items?.map((item, index) => (
            <div key={index} className="flex items-center gap-4">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </span>
              <span className="text-gray-700">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
