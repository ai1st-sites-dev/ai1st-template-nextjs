'use client';

import { useState } from 'react';
import Link from 'next/link';

interface AnnouncementBarSectionProps {
  data: {
    message: string;
    link?: { label: string; href: string };
    variant?: 'solid' | 'bordered' | 'dismissible' | 'floating';
  };
}

export default function AnnouncementBarSection({ data }: AnnouncementBarSectionProps) {
  const variant = data.variant || 'solid';
  const [hidden, setHidden] = useState(false);

  if (variant === 'dismissible') {
    if (hidden) return null;

    return (
      <div className="bg-accent-500 py-3" role="banner" aria-label="Announcement">
        <div className="container-width flex items-center justify-center">
          <p className="flex-1 text-center text-sm font-medium text-white">
            {data.message}
            {data.link && (
              <>
                {' '}
                <Link href={data.link.href} className="underline text-white hover:text-white/80">
                  {data.link.label}
                </Link>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="ml-4 shrink-0 text-white/80 hover:text-white"
            aria-label="Dismiss announcement"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'floating') {
    return (
      <div className="py-3" role="banner" aria-label="Announcement">
        <div className="mx-auto max-w-2xl rounded-full bg-white px-6 py-3 shadow-lg">
          <div className="flex items-center justify-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
            <p className="flex-1 text-sm font-medium text-gray-900">
              {data.message}
            </p>
            {data.link && (
              <Link
                href={data.link.href}
                className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-primary-500 text-white transition-colors hover:bg-primary-600"
                aria-label={data.link.label}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'bordered') {
    return (
      <div className="border-b-2 border-accent-500 bg-white py-3" role="banner" aria-label="Announcement">
        <div className="container-width text-center">
          <p className="text-sm font-medium text-gray-900">
            {data.message}
            {data.link && (
              <>
                {' '}
                <Link href={data.link.href} className="font-medium text-accent-600 hover:text-accent-700">
                  {data.link.label}
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Default: solid
  return (
    <div className="bg-accent-500 py-3" role="banner" aria-label="Announcement">
      <div className="container-width text-center">
        <p className="text-sm font-medium text-white">
          {data.message}
          {data.link && (
            <>
              {' '}
              <Link href={data.link.href} className="underline text-white hover:text-white/80">
                {data.link.label}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
