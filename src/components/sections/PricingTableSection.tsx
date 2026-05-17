'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PricingTier {
  name: string;
  price: string;
  description: string;
  features: string[];
  highlighted?: boolean;
}

interface PricingTableSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    tiers: PricingTier[];
    ctaHref?: string;
    variant?: 'cards' | 'comparison' | 'minimal' | 'toggle';
  };
}

export default function PricingTableSection({ data }: PricingTableSectionProps) {
  const ctaHref = data.ctaHref || '/quote';
  const variant = data.variant || 'cards';
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  if (variant === 'minimal') {
    return (
      <section className="section-padding" aria-labelledby="pricing-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="pricing-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-0 md:grid-cols-3">
            {data.tiers?.map((tier, index) => (
              <div
                key={index}
                className={`p-8 ${tier.highlighted ? 'rounded-xl bg-accent-50' : ''} ${index < (data.tiers?.length ?? 0) - 1 ? 'md:border-r md:border-gray-200' : ''}`}
              >
                <h3 className="font-bold text-gray-900">{tier.name}</h3>
                <p className="mt-2 text-3xl font-extrabold text-primary-600">{tier.price}</p>
                <p className="mt-2 text-sm text-gray-600">{tier.description}</p>
                <ul className="mt-6 space-y-3">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <svg className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link href={ctaHref} className="mt-6 inline-block text-sm font-semibold text-primary-600 hover:text-primary-500">
                  Get Started &rarr;
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'toggle') {
    const suffix = billingPeriod === 'monthly' ? '/mo' : '/yr';
    return (
      <section className="bg-gray-50 section-padding" aria-labelledby="pricing-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="pricing-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
            <div className="mt-8 inline-flex rounded-lg border border-gray-200 bg-white p-1">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`rounded-md px-6 py-2 text-sm font-semibold transition-colors ${billingPeriod === 'monthly' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingPeriod('annual')}
                className={`rounded-md px-6 py-2 text-sm font-semibold transition-colors ${billingPeriod === 'annual' ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Annual
              </button>
            </div>
          </div>
          <div className={`mt-12 grid gap-8 ${data.tiers?.length === 2 ? 'mx-auto max-w-3xl md:grid-cols-2' : 'md:grid-cols-3'}`}>
            {data.tiers?.map((tier, index) => (
              <div key={index} className={`relative rounded-2xl p-8 shadow-sm ${tier.highlighted ? 'border-2 border-primary-500 bg-white ring-1 ring-primary-500' : 'border border-gray-200 bg-white'}`}>
                {tier.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary-500 px-4 py-1 text-xs font-semibold text-white">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                <p className="mt-4 text-4xl font-extrabold text-gray-900">
                  {tier.price}<span className="text-lg font-medium text-gray-500">{suffix}</span>
                </p>
                <p className="mt-2 text-gray-600">{tier.description}</p>
                <ul className="mt-8 space-y-4">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3 text-gray-700">
                      <svg className="mt-0.5 h-5 w-5 shrink-0 text-accent-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link href={ctaHref} className={`mt-8 block w-full rounded-lg py-3 text-center font-semibold transition-colors ${tier.highlighted ? 'btn-primary' : 'btn-secondary'}`}>
                  Get Started
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'comparison') {
    return (
      <section className="section-padding" aria-labelledby="pricing-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="pricing-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-xl border border-gray-200">
            <div className="grid grid-cols-1 divide-y divide-gray-200 md:grid-cols-3 md:divide-x md:divide-y-0">
              {data.tiers?.map((tier, index) => (
                <div key={index} className={`p-8 ${tier.highlighted ? 'bg-primary-50' : 'bg-white'}`}>
                  <h3 className="text-lg font-bold text-gray-900">{tier.name}</h3>
                  <p className="mt-2 text-3xl font-extrabold text-primary-600">{tier.price}</p>
                  <p className="mt-2 text-sm text-gray-600">{tier.description}</p>
                  <ul className="mt-6 space-y-3">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link href={ctaHref} className={`mt-8 block w-full rounded-lg py-3 text-center text-sm font-semibold transition-colors ${tier.highlighted ? 'bg-primary-600 text-white hover:bg-primary-700' : 'border border-primary-600 text-primary-600 hover:bg-primary-50'}`}>
                    Get Started
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gray-50 section-padding" aria-labelledby="pricing-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="pricing-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className={`mt-12 grid gap-8 ${(data.tiers?.length ?? 0) === 2 ? 'mx-auto max-w-3xl md:grid-cols-2' : 'md:grid-cols-3'}`}>
          {(data.tiers ?? []).map((tier, index) => (
            <div key={index} className={`relative rounded-2xl p-8 shadow-sm ${tier.highlighted ? 'border-2 border-primary-500 bg-white ring-1 ring-primary-500' : 'border border-gray-200 bg-white'}`}>
              {tier.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary-500 px-4 py-1 text-xs font-semibold text-white">
                  Most Popular
                </span>
              )}
              <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
              <p className="mt-4 text-4xl font-extrabold text-gray-900">{tier.price}</p>
              <p className="mt-2 text-gray-600">{tier.description}</p>
              <ul className="mt-8 space-y-4">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-3 text-gray-700">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-accent-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link href={ctaHref} className={`mt-8 block w-full rounded-lg py-3 text-center font-semibold transition-colors ${tier.highlighted ? 'btn-primary' : 'btn-secondary'}`}>
                Get Started
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
