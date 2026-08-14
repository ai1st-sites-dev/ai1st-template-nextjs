import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TrustedBrandsSectionProps {
  data: {
    headline: string;
    brands: string[];
    variant?: 'default' | 'pill' | 'dark';
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

export default function TrustedBrandsSection({ data, block }: TrustedBrandsSectionProps) {
  const variant = data.variant || 'default';

  if (variant === 'pill') {
    return (
      <section {...blockAttrs('trusted-brands', block)} className="border-b bg-gray-50 py-10" aria-label="Trusted brands">
        <div className="container-width px-4 sm:px-6 lg:px-8">
          <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-gray-500">
            {data.headline}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {data.brands?.map((brand) => (
              <span key={brand} className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600">
                {brand}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'dark') {
    return (
      <section {...blockAttrs('trusted-brands', block)} className="border-b bg-primary-900 py-10" aria-label="Trusted brands">
        <div className="container-width px-4 sm:px-6 lg:px-8">
          <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-primary-400">
            {data.headline}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
            {data.brands?.map((brand) => (
              <span key={brand} className="text-lg font-bold text-primary-300 transition-colors hover:text-primary-100">
                {brand}
              </span>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('trusted-brands', block)} className="border-b bg-gray-50 py-10" aria-label="Trusted brands">
      <div className="container-width px-4 sm:px-6 lg:px-8">
        <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-gray-500">
          {data.headline}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
          {data.brands?.map((brand) => (
            <span key={brand} className="text-lg font-bold text-gray-400 transition-colors hover:text-gray-600">
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
