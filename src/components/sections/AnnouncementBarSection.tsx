'use client';

import { useState } from 'react';
import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface AnnouncementBarSectionProps {
  data: {
    message: string;
    link?: { label: string; href: string };
    variant?: 'solid' | 'bordered' | 'dismissible' | 'floating';
  };
  // #1000 — 同一个组件有两种身份：页面里的**内容块**（默认，带 `data-block` / `data-role`），
  // 和 page layout 库里 `with-topbar` 那个**外壳区**（`asRegion`，带 `data-region-layout`）。
  // 为什么外壳那身不带块属性，三个理由写在 `TopbarRegion.tsx` 的头注里（主题的块选择器 / #992 按
  // `[data-role]` 找的那套不变量 / #1002 枚举 `[data-block]` 的那份基线）——都是能查的，不是偏好。
  asRegion?: boolean;
}

export default function AnnouncementBarSection({ data, asRegion = false }: AnnouncementBarSectionProps) {
  const variant = data.variant || 'solid';
  const [hidden, setHidden] = useState(false);
  // 一个块只带一种身份的属性：要么是块，要么是区。
  const idAttrs = asRegion
    ? { 'data-region-layout': variant }
    : blockAttrs('announcement-bar');

  if (variant === 'dismissible') {
    if (hidden) return null;

    return (
      <div {...idAttrs} className="bg-accent-500 py-3" role="banner" aria-label="Announcement">
        <div className="container-width flex items-center justify-center">
          <p className="flex-1 text-center text-sm font-medium text-white">
            {data.message}
            {data.link && (
              <>
                {' '}
                <Link href={data.link?.href ?? "#"} className="underline text-white hover:text-white/80">
                  {data.link?.label}
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
      <div {...idAttrs} className="py-3" role="banner" aria-label="Announcement">
        <div className="mx-auto max-w-2xl rounded-full bg-white px-6 py-3 shadow-lg">
          <div className="flex items-center justify-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
            <p className="flex-1 text-sm font-medium text-gray-900">
              {data.message}
            </p>
            {data.link && (
              <Link
                href={data.link?.href ?? "#"}
                className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-primary-500 text-white transition-colors hover:bg-primary-600"
                aria-label={data.link?.label}
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
      <div {...idAttrs} className="border-b-2 border-accent-500 bg-white py-3" role="banner" aria-label="Announcement">
        <div className="container-width text-center">
          <p className="text-sm font-medium text-gray-900">
            {data.message}
            {data.link && (
              <>
                {' '}
                <Link href={data.link?.href ?? "#"} className="font-medium text-accent-600 hover:underline">
                  {data.link?.label}
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
    <div {...idAttrs} className="bg-accent-500 py-3" role="banner" aria-label="Announcement">
      <div className="container-width text-center">
        <p className="text-sm font-medium text-white">
          {data.message}
          {data.link && (
            <>
              {' '}
              <Link href={data.link?.href ?? "#"} className="underline text-white hover:text-white/80">
                {data.link?.label}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
