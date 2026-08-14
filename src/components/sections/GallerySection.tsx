'use client';

import { useRef } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface GalleryItem {
  title: string;
  description?: string;
  category?: string;
  imageUrl?: string;
}

interface GallerySectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: GalleryItem[];
    variant?: 'grid' | 'masonry' | 'carousel' | 'overlay';
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

export default function GallerySection({ data, block }: GallerySectionProps) {
  const variant = data.variant || 'grid';
  const scrollRef = useRef<HTMLDivElement>(null);

  const colors = [
    'from-primary-100 to-primary-200',
    'from-accent-100 to-accent-200',
    'from-primary-50 to-accent-100',
    'from-gray-100 to-gray-200',
    'from-accent-50 to-primary-100',
    'from-primary-200 to-primary-100',
  ];

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const amount = 320;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -amount : amount,
        behavior: 'smooth',
      });
    }
  };

  if (variant === 'carousel') {
    return (
      <section {...blockAttrs('gallery', block)} className="section-padding" aria-labelledby="gallery-heading">
        <div className="container-width">
          <div className="flex items-end justify-between">
            <div>
              <h2 id="gallery-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
                {data.headline}
              </h2>
              {data.subheadline && (
                <p className="mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
              )}
            </div>
            <div className="hidden gap-2 sm:flex">
              <button
                onClick={() => scroll('left')}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-primary-500 hover:text-primary-600"
                aria-label="Scroll gallery left"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                onClick={() => scroll('right')}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-primary-500 hover:text-primary-600"
                aria-label="Scroll gallery right"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
          <div
            ref={scrollRef}
            className="mt-10 flex gap-6 overflow-x-auto snap-x snap-mandatory pb-4 scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {data.items?.map((item, index) => (
              <div
                key={index}
                className="min-w-[300px] flex-shrink-0 snap-center overflow-hidden rounded-xl bg-white shadow-sm"
              >
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.title} className="h-48 w-full object-cover" />
                ) : (
                  <div className={`bg-gradient-to-br ${colors[index % colors.length]} h-48`} />
                )}
                <div className="p-5">
                  {item.category && (
                    <span className="mb-2 inline-block rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                      {item.category}
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-gray-900">{item.title}</h3>
                  {item.description && (
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">{item.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'overlay') {
    return (
      <section {...blockAttrs('gallery', block)} className="section-padding" aria-labelledby="gallery-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="gallery-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.items?.map((item, index) => (
              <div
                key={index}
                className={`relative h-64 overflow-hidden rounded-2xl ${item.imageUrl ? '' : `bg-gradient-to-br ${colors[index % colors.length]}`}`}
              >
                {item.imageUrl && (
                  <img src={item.imageUrl} alt={item.title} className="absolute inset-0 h-full w-full object-cover" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-0 p-6">
                  {item.category && (
                    <span className="mb-2 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white">
                      {item.category}
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                  {item.description && (
                    <p className="mt-1 text-sm leading-relaxed text-white/80">{item.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'masonry') {
    return (
      <section {...blockAttrs('gallery', block)} className="section-padding" aria-labelledby="gallery-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="gallery-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12 columns-1 gap-6 sm:columns-2 lg:columns-3">
            {data.items?.map((item, index) => {
              const heights = ['h-48', 'h-64', 'h-56', 'h-72', 'h-52', 'h-60'];
              return (
                <div key={index} className="mb-6 break-inside-avoid overflow-hidden rounded-xl">
                  <div className={`${item.imageUrl ? '' : `bg-gradient-to-br ${colors[index % colors.length]}`} ${heights[index % heights.length]} relative flex items-end p-6`}>
                    {item.imageUrl && (
                      <>
                        <img src={item.imageUrl} alt={item.title} className="absolute inset-0 h-full w-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                      </>
                    )}
                    <div className="relative">
                      {item.category && (
                        <span className={`mb-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${item.imageUrl ? 'bg-white/20 text-white' : 'bg-white/80 text-gray-700'}`}>
                          {item.category}
                        </span>
                      )}
                      <h3 className={`text-lg font-semibold ${item.imageUrl ? 'text-white' : 'text-gray-900'}`}>{item.title}</h3>
                      {item.description && (
                        <p className={`mt-1 text-sm ${item.imageUrl ? 'text-white/80' : 'text-gray-700'}`}>{item.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('gallery', block)} className="bg-gray-50 section-padding" aria-labelledby="gallery-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="gallery-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.items?.map((item, index) => (
            <div key={index} className="group overflow-hidden rounded-xl bg-white shadow-sm transition-shadow hover:shadow-md">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.title} className="h-48 w-full object-cover" />
              ) : (
                <div className={`bg-gradient-to-br ${colors[index % colors.length]} h-48`} />
              )}
              <div className="p-6">
                {item.category && (
                  <span className="mb-2 inline-block rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                    {item.category}
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{item.title}</h3>
                {item.description && (
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{item.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
