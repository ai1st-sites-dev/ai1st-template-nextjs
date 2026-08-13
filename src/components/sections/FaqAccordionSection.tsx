'use client';

import { useState } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: FaqItem[];
    variant?: 'centered' | 'two-column' | 'cards' | 'numbered';
  };
}

export default function FaqAccordionSection({ data }: FaqAccordionSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const variant = data.variant || 'centered';

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const faqList = (
    <div className="divide-y divide-gray-200 rounded-xl border border-gray-200">
      {data.items?.map((item, index) => (
        <div key={index}>
          <button
            onClick={() => toggle(index)}
            className="flex w-full items-center justify-between px-6 py-5 text-left transition-colors hover:bg-gray-50"
            aria-expanded={openIndex === index}
          >
            <span className="pr-4 text-lg font-semibold text-gray-900">{item.question}</span>
            <svg
              className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${openIndex === index ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {openIndex === index && (
            <div className="px-6 pb-5">
              <p className="leading-relaxed text-gray-600">{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  if (variant === 'cards') {
    return (
      <section {...blockAttrs('faq-accordion')} className="section-padding" aria-labelledby="faq-heading">
        <div className="container-width">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <h2 id="faq-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
                {data.headline}
              </h2>
              {data.subheadline && (
                <p className="mt-4 text-lg text-gray-600">{data.subheadline}</p>
              )}
            </div>
            <div className="mt-12">
              {data.items?.map((item, index) => (
                <div
                  key={index}
                  className={`mb-4 rounded-xl border shadow-sm transition-all ${openIndex === index ? 'border-primary-300 shadow-md' : 'border-gray-200'}`}
                >
                  <button
                    onClick={() => toggle(index)}
                    className="flex w-full items-center justify-between px-6 py-5 text-left transition-colors hover:bg-gray-50"
                    aria-expanded={openIndex === index}
                  >
                    <span className="pr-4 text-lg font-semibold text-gray-900">{item.question}</span>
                    <svg
                      className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${openIndex === index ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {openIndex === index && (
                    <div className="px-6 pb-5">
                      <p className="leading-relaxed text-gray-600">{item.answer}</p>
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

  if (variant === 'numbered') {
    return (
      <section {...blockAttrs('faq-accordion')} className="section-padding" aria-labelledby="faq-heading">
        <div className="container-width">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <h2 id="faq-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
                {data.headline}
              </h2>
              {data.subheadline && (
                <p className="mt-4 text-lg text-gray-600">{data.subheadline}</p>
              )}
            </div>
            <div className="mt-12">
              {data.items?.map((item, index) => (
                <div key={index} className="border-b border-gray-200">
                  <button
                    onClick={() => toggle(index)}
                    className="flex w-full items-center gap-4 py-5 text-left transition-colors hover:bg-gray-50"
                    aria-expanded={openIndex === index}
                  >
                    <span className="shrink-0 text-lg font-bold text-accent-600">
                      {String(index + 1).padStart(2, '0')}.
                    </span>
                    <span className="flex-1 pr-4 text-lg font-semibold text-gray-900">{item.question}</span>
                    <svg
                      className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${openIndex === index ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {openIndex === index && (
                    <div className="pb-5 pl-12">
                      <p className="leading-relaxed text-gray-600">{item.answer}</p>
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

  if (variant === 'two-column') {
    return (
      <section {...blockAttrs('faq-accordion')} className="section-padding" aria-labelledby="faq-heading">
        <div className="container-width">
          <div className="grid gap-12 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <h2 id="faq-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
                {data.headline}
              </h2>
              {data.subheadline && (
                <p className="mt-4 text-lg text-gray-600">{data.subheadline}</p>
              )}
            </div>
            <div className="lg:col-span-3">
              {faqList}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('faq-accordion')} className="section-padding" aria-labelledby="faq-heading">
      <div className="container-width">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <h2 id="faq-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mt-4 text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12">
            {faqList}
          </div>
        </div>
      </div>
    </section>
  );
}
