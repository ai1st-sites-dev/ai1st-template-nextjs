import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ValuesGridSectionProps {
  data: {
    headline: string;
    items: { title: string; description: string }[];
    style?: 'numbered' | 'checkmark' | 'icon' | 'highlight' | 'minimal';
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

const valueIcons = [
  // star
  <svg key="star" className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
  </svg>,
  // heart
  <svg key="heart" className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
  </svg>,
  // globe
  <svg key="globe" className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
  </svg>,
  // users
  <svg key="users" className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>,
  // lightning
  <svg key="lightning" className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
  </svg>,
  // award
  <svg key="award" className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.27.308 6.023 6.023 0 01-2.27-.308" />
  </svg>,
];

export default function ValuesGridSection({ data, block }: ValuesGridSectionProps) {
  const style = data.style || 'checkmark';

  if (style === 'icon') {
    return (
      <section {...blockAttrs('values-grid', block)} className="section-padding" aria-labelledby="values-heading">
        <div className="container-width">
          <h2 id="values-heading" className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {data.items?.map((item, index) => (
              <div key={index} className="rounded-xl border border-gray-200 p-8">
                <div className="mb-4 text-primary-500">
                  {valueIcons[index % valueIcons.length]}
                </div>
                <h3 className="text-xl font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-gray-600">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (style === 'highlight') {
    const [first, ...rest] = data.items;
    return (
      <section {...blockAttrs('values-grid', block)} className="section-padding" aria-labelledby="values-heading">
        <div className="container-width">
          <h2 id="values-heading" className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          <div className="mt-12">
            {first && (
              <div className="rounded-xl bg-primary-50 p-10">
                <h3 className="text-2xl font-semibold text-gray-900">{first.title}</h3>
                <p className="mt-4 text-lg leading-relaxed text-gray-700">{first.description}</p>
              </div>
            )}
            {rest.length > 0 && (
              <div className={`mt-8 grid gap-8 ${rest.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                {rest.map((item, index) => (
                  <div key={index} className="rounded-xl border border-gray-200 p-8">
                    <h3 className="text-xl font-semibold text-gray-900">{item.title}</h3>
                    <p className="mt-3 leading-relaxed text-gray-600">{item.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (style === 'minimal') {
    return (
      <section {...blockAttrs('values-grid', block)} className="section-padding" aria-labelledby="values-heading">
        <div className="container-width">
          <h2 id="values-heading" className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          <div className="mt-16 grid gap-12 md:grid-cols-3">
            {data.items?.map((item, index) => (
              <div key={index}>
                <h3 className="font-bold text-gray-900">{item.title}</h3>
                <div className="mt-3 h-0.5 w-12 bg-accent-500" aria-hidden="true" />
                <p className="mt-4 leading-relaxed text-gray-600">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const isNumbered = style === 'numbered';

  return (
    <section {...blockAttrs('values-grid', block)} className={`${isNumbered ? 'bg-gray-50 ' : ''}section-padding`} aria-labelledby="values-heading">
      <div className="container-width">
        <h2 id="values-heading" className="text-center text-3xl font-bold text-gray-900 sm:text-4xl">
          {data.headline}
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {data.items?.map((item, index) => (
            <div key={index} className={`rounded-xl ${isNumbered ? 'bg-white p-8 shadow-sm' : 'border border-gray-200 p-8'}`}>
              <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${isNumbered ? 'bg-accent-50 text-accent-500' : 'bg-primary-50 text-primary-500'}`}>
                {isNumbered ? (
                  <span className="text-xl font-bold">{index + 1}</span>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              <h3 className="text-xl font-semibold text-gray-900">{item.title}</h3>
              <p className="mt-3 leading-relaxed text-gray-600">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
