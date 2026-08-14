import { getServices } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

export default function ServicesNavSection({ locale, block }: { locale: string; block?: BlockConfig }) {
  const services = getServices(locale);
  return (
    <section {...blockAttrs('services-nav', block)} className="sticky top-[73px] z-40 border-b bg-white shadow-sm" aria-label="Service quick navigation">
      <div className="container-width overflow-x-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-1 py-2">
          {services.map((service) => (
            <a
              key={service.id}
              href={`#${service.id}`}
              className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-primary-50 hover:text-primary-600"
            >
              {service.name}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
