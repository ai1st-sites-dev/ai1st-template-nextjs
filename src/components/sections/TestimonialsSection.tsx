'use client';

import { useState } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface Testimonial {
  id: string;
  name: string;
  role: string;
  location: string;
  quote: string;
  rating: number;
  service: string;
}

interface TestimonialsSectionProps {
  data: {
    headline: string;
    subheadline: string;
    items: Testimonial[];
    variant?: 'grid' | 'featured' | 'carousel' | 'quote-wall' | 'minimal';
  };
}

export default function TestimonialsSection({ data }: TestimonialsSectionProps) {
  const variant = data.variant || 'grid';
  const [activeIndex, setActiveIndex] = useState(0);

  if (variant === 'carousel') {
    const current = data.items[activeIndex];
    return (
      <section {...blockAttrs('testimonials')} className="section-padding" aria-labelledby="testimonials-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="testimonials-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className="mx-auto mt-16 max-w-3xl text-center">
            <span className="text-6xl font-serif text-primary-200" aria-hidden="true">&ldquo;</span>
            <blockquote className="mt-2 text-xl leading-relaxed text-gray-700">
              {current.quote}
            </blockquote>
            <div className="mt-8 flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                <span className="text-lg font-bold">{current.name.charAt(0)}</span>
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900">{current.name}</p>
                <p className="text-sm text-gray-500">{current.role} &middot; {current.location}</p>
              </div>
            </div>
            <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Testimonial navigation">
              {data.items?.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setActiveIndex(index)}
                  className={`h-3 w-3 rounded-full transition-colors ${
                    index === activeIndex ? 'bg-primary-600' : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                  aria-label={`Show testimonial ${index + 1}`}
                  aria-current={index === activeIndex ? 'true' : undefined}
                />
              ))}
            </nav>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'quote-wall') {
    return (
      <section {...blockAttrs('testimonials')} className="bg-primary-900 section-padding" aria-labelledby="testimonials-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="testimonials-heading" className="text-3xl font-bold text-white sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-300">
              {data.subheadline}
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {data.items?.map((testimonial) => (
              <div
                key={testimonial.id}
                className="rounded-xl bg-primary-800 p-8"
              >
                <span className="text-4xl font-serif text-primary-600" aria-hidden="true">&ldquo;</span>
                <blockquote className="mt-2 leading-relaxed text-white">
                  {testimonial.quote}
                </blockquote>
                <div className="mt-6">
                  <p className="font-semibold text-white">{testimonial.name}</p>
                  <p className="text-sm text-gray-400">{testimonial.role} &middot; {testimonial.location}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'minimal') {
    return (
      <section {...blockAttrs('testimonials')} className="section-padding" aria-labelledby="testimonials-heading">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 id="testimonials-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className="mt-16 space-y-0 divide-y divide-gray-200">
            {data.items?.map((testimonial) => (
              <div key={testimonial.id} className="py-10 first:pt-0 last:pb-0">
                <blockquote>
                  <span className="text-4xl font-serif text-primary-200" aria-hidden="true">&ldquo;</span>
                  <p className="mt-1 text-lg italic leading-relaxed text-gray-700">
                    {testimonial.quote}
                  </p>
                </blockquote>
                <p className="mt-4 text-sm text-gray-500">
                  &mdash; {testimonial.name}, {testimonial.role}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'featured') {
    // Large featured testimonial + smaller side cards
    const [featured, ...rest] = data.items;
    return (
      <section {...blockAttrs('testimonials')} className="bg-gray-50 section-padding" aria-labelledby="testimonials-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="testimonials-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              {data.subheadline}
            </p>
          </div>
          <div className="mt-16 grid gap-8 lg:grid-cols-5">
            {/* Featured large card */}
            <div className="flex flex-col rounded-2xl border border-primary-200 bg-white p-10 shadow-sm lg:col-span-3">
              <div className="mb-4 flex gap-1">
                {Array.from({ length: featured.rating }).map((_, i) => (
                  <svg key={i} className="h-6 w-6 text-accent-500" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <blockquote className="flex-1 text-lg leading-relaxed text-gray-700">
                &ldquo;{featured.quote}&rdquo;
              </blockquote>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                  <span className="text-lg font-bold">{featured.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="text-lg font-semibold text-gray-900">{featured.name}</p>
                  <p className="text-sm text-gray-500">{featured.role} · {featured.location}</p>
                </div>
              </div>
            </div>
            {/* Side cards */}
            <div className="flex flex-col gap-6 lg:col-span-2">
              {rest.slice(0, 3).map((testimonial) => (
                <div
                  key={testimonial.id}
                  className="flex flex-col rounded-xl bg-white p-6 shadow-sm"
                >
                  <div className="mb-2 flex gap-1">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <svg key={i} className="h-4 w-4 text-accent-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  <blockquote className="flex-1 text-sm leading-relaxed text-gray-700">
                    &ldquo;{testimonial.quote}&rdquo;
                  </blockquote>
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-gray-900">{testimonial.name}</p>
                    <p className="text-xs text-gray-500">{testimonial.role} · {testimonial.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('testimonials')} className="section-padding" aria-labelledby="testimonials-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="testimonials-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            {data.subheadline}
          </p>
        </div>
        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {data.items?.map((testimonial) => (
            <div
              key={testimonial.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-8 transition-all hover:border-primary-300 hover:shadow-lg"
            >
              <div className="mb-4 flex gap-1">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <svg key={i} className="h-5 w-5 text-accent-500" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                ))}
              </div>
              <blockquote className="flex-1 text-gray-700 leading-relaxed">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <div className="mt-6 flex items-center gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                  <span className="text-sm font-bold">{testimonial.name.charAt(0)}</span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{testimonial.name}</p>
                  <p className="text-sm text-gray-500">{testimonial.role} · {testimonial.location}</p>
                </div>
              </div>
              <div className="mt-4">
                <span className="inline-block rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                  {testimonial.service}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
