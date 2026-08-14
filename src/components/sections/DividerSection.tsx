import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface DividerSectionProps {
  data: {
    label?: string;
    variant?: 'line' | 'wave' | 'gradient-bar' | 'icon';
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

export default function DividerSection({ data, block }: DividerSectionProps) {
  const variant = data.variant || 'line';

  if (variant === 'wave') {
    return (
      <div {...blockAttrs('divider', block)} className="w-full leading-none" aria-hidden="true">
        <svg
          className="block w-full"
          viewBox="0 0 1440 60"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ height: '60px' }}
        >
          <path
            d="M0,30 C240,60 480,0 720,30 C960,60 1200,0 1440,30 L1440,60 L0,60 Z"
            className="fill-primary-100"
          />
        </svg>
      </div>
    );
  }

  if (variant === 'gradient-bar') {
    return (
      <div {...blockAttrs('divider', block)} className="w-full" role="separator">
        {data.label && (
          <p className="mb-2 text-center text-sm text-gray-500">{data.label}</p>
        )}
        <div className="h-1 w-full bg-gradient-to-r from-primary-500 to-accent-500" aria-hidden="true" />
      </div>
    );
  }

  if (variant === 'icon') {
    return (
      <div {...blockAttrs('divider', block)} className="flex items-center py-8" role="separator" aria-label={data.label || 'Section divider'}>
        <div className="flex-1 border-t border-gray-300" aria-hidden="true" />
        <div className="mx-4 h-3 w-3 rounded-full bg-primary-500" aria-hidden="true" />
        <div className="flex-1 border-t border-gray-300" aria-hidden="true" />
      </div>
    );
  }

  // Default: line
  return (
    <div {...blockAttrs('divider', block)} className="relative py-8" role="separator" aria-label={data.label || 'Section divider'}>
      <div className="border-t border-gray-300" aria-hidden="true" />
      {data.label && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="bg-white px-4 text-sm text-gray-500">{data.label}</span>
        </div>
      )}
    </div>
  );
}
