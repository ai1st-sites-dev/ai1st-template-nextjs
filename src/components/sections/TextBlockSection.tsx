import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TextBlockSectionProps {
  data: {
    headline?: string;
    content: string;
    background?: 'white' | 'gray';
    centered?: boolean;
    variant?: 'default' | 'two-column' | 'highlight-box' | 'with-list' | 'quote';
    attribution?: string;
    items?: string[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

export default function TextBlockSection({ data, block }: TextBlockSectionProps) {
  const bgClass = data.background === 'gray' ? 'bg-gray-50 ' : '';
  const variant = data.variant || 'default';

  if (variant === 'two-column') {
    return (
      <section {...blockAttrs('text-block', block)} className={`${bgClass}section-padding`} aria-labelledby={data.headline ? 'text-block-heading' : undefined}>
        <div className="container-width">
          <div className="mx-auto max-w-4xl">
            {data.headline && (
              <h2 id="text-block-heading" className="mb-8 text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
            )}
            <div className="columns-2 gap-8 text-lg leading-relaxed text-gray-700">
              {data.content}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'highlight-box') {
    return (
      <section {...blockAttrs('text-block', block)} className={`${bgClass}section-padding`} aria-labelledby={data.headline ? 'text-block-heading' : undefined}>
        <div className="container-width">
          <div className="mx-auto max-w-3xl rounded-r-xl border-l-4 border-primary-500 bg-primary-50 p-8">
            {data.headline && (
              <h2 id="text-block-heading" className="text-3xl font-bold text-primary-800">
                {data.headline}
              </h2>
            )}
            <p className={`${data.headline ? 'mt-6 ' : ''}text-lg leading-relaxed text-gray-700`}>
              {data.content}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'quote') {
    return (
      <section {...blockAttrs('text-block', block)} className={`${bgClass}section-padding`} aria-labelledby={data.headline ? 'text-block-heading' : undefined}>
        <div className="container-width">
          <div className="mx-auto max-w-3xl text-center">
            {data.headline && (
              <h2 id="text-block-heading" className="mb-8 text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
            )}
            <div className="relative">
              <svg className="mx-auto h-12 w-12 text-primary-200" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
              </svg>
              <blockquote className="mt-6">
                <p className="text-xl italic leading-relaxed text-gray-700">
                  {data.content}
                </p>
              </blockquote>
              {data.attribution && (
                <p className="mt-6 text-sm font-semibold text-primary-600">&mdash; {data.attribution}</p>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'with-list') {
    return (
      <section {...blockAttrs('text-block', block)} className={`${bgClass}section-padding`} aria-labelledby={data.headline ? 'text-block-heading' : undefined}>
        <div className="container-width">
          <div className={`mx-auto max-w-3xl ${data.centered ? 'text-center' : ''}`}>
            {data.headline && (
              <h2 id="text-block-heading" className="text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
            )}
            <p className={`${data.headline ? 'mt-6 ' : ''}text-lg leading-relaxed text-gray-700`}>
              {data.content}
            </p>
            {data.items && data.items?.length > 0 && (
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {data.items?.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-1 h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('text-block', block)} className={`${bgClass}section-padding`} aria-labelledby={data.headline ? 'text-block-heading' : undefined}>
      <div className="container-width">
        <div className={`mx-auto max-w-3xl ${data.centered ? 'text-center' : ''}`}>
          {data.headline && (
            <h2 id="text-block-heading" className="text-3xl font-bold text-gray-900">
              {data.headline}
            </h2>
          )}
          <p className={`${data.headline ? 'mt-6 ' : ''}text-lg leading-relaxed text-gray-700`}>
            {data.content}
          </p>
        </div>
      </div>
    </section>
  );
}
