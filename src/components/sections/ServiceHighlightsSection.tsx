'use client';

import { useState } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface Highlight {
  title: string;
  description: string;
  features?: string[];
}

interface ServiceHighlightsSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    highlights: Highlight[];
    variant?: 'tabs' | 'accordion' | 'cards-large' | 'split';
  };
}

export default function ServiceHighlightsSection({ data }: ServiceHighlightsSectionProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const variant = data.variant || 'cards-large';

  const toggleAccordion = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  if (variant === 'tabs') {
    return (
      <section {...blockAttrs('service-highlights')} className="section-padding" aria-labelledby="highlights-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="highlights-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-3xl">
            {/* Tab bar */}
            <div className="flex gap-0 border-b border-gray-200">
              {data.highlights?.map((highlight, index) => (
                <button
                  key={index}
                  onClick={() => setActiveTab(index)}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === index
                      ? 'border-b-2 border-primary-500 font-semibold text-primary-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {highlight.title}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="min-h-[200px] py-8">
              <p className="leading-relaxed text-gray-600">{data.highlights[activeTab].description}</p>
              {data.highlights[activeTab].features && data.highlights[activeTab].features!.length > 0 && (
                <ul className="mt-6 space-y-3">
                  {data.highlights[activeTab].features!.map((feature, fIndex) => (
                    <li key={fIndex} className="flex items-start gap-3">
                      <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-gray-700">{feature}</span>
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

  if (variant === 'accordion') {
    return (
      <section {...blockAttrs('service-highlights')} className="section-padding" aria-labelledby="highlights-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="highlights-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-3xl">
            <div className="divide-y divide-gray-200 rounded-xl border border-gray-200">
              {data.highlights?.map((highlight, index) => (
                <div key={index}>
                  <button
                    onClick={() => toggleAccordion(index)}
                    className="flex w-full items-center justify-between px-6 py-5 text-left transition-colors hover:bg-gray-50"
                    aria-expanded={openIndex === index}
                  >
                    <span className="pr-4 text-lg font-semibold text-gray-900">{highlight.title}</span>
                    <svg
                      className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${openIndex === index ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {openIndex === index && (
                    <div className="px-6 pb-6">
                      <p className="leading-relaxed text-gray-600">{highlight.description}</p>
                      {highlight.features && highlight.features.length > 0 && (
                        <ul className="mt-4 space-y-3">
                          {highlight.features.map((feature, fIndex) => (
                            <li key={fIndex} className="flex items-start gap-3">
                              <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                              </svg>
                              <span className="text-gray-700">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'split') {
    return (
      <section {...blockAttrs('service-highlights')} className="section-padding" aria-labelledby="highlights-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="highlights-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12">
            {data.highlights?.map((highlight, index) => (
              <div
                key={index}
                className={`grid items-start gap-12 py-12 lg:grid-cols-2 ${index < (data.highlights?.length ?? 0) - 1 ? 'border-b border-gray-200' : ''}`}
              >
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">{highlight.title}</h3>
                  <p className="mt-4 leading-relaxed text-gray-600">{highlight.description}</p>
                </div>
                {highlight.features && highlight.features.length > 0 && (
                  <div className="rounded-xl bg-gray-50 p-8">
                    <ul className="space-y-3">
                      {highlight.features.map((feature, fIndex) => (
                        <li key={fIndex} className="flex items-start gap-3">
                          <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          <span className="text-gray-700">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Default: cards-large
  const gridCols =
    data.highlights?.length === 1
      ? ''
      : data.highlights?.length === 2
        ? 'md:grid-cols-2'
        : 'md:grid-cols-3';

  return (
    <section {...blockAttrs('service-highlights')} className="section-padding" aria-labelledby="highlights-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="highlights-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className={`mt-12 grid gap-8 ${gridCols}`}>
          {data.highlights?.map((highlight, index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-gray-200 p-10">
              {/* Gradient accent strip */}
              <div className="-mx-10 -mt-10 mb-8 h-1 bg-gradient-to-r from-primary-500 to-accent-500" />
              <h3 className="text-2xl font-bold text-gray-900">{highlight.title}</h3>
              <p className="mt-4 leading-relaxed text-gray-600">{highlight.description}</p>
              {highlight.features && highlight.features.length > 0 && (
                <ul className="mt-6 space-y-3">
                  {highlight.features.map((feature, fIndex) => (
                    <li key={fIndex} className="flex items-start gap-3">
                      <svg className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
