import { blockAttrs } from '@/lib/sections/blockAttrs';

interface Stat {
  value: string;
  label: string;
}

interface StatsCounterSectionProps {
  data: {
    headline?: string;
    stats: Stat[];
    variant?: 'bar' | 'cards' | 'gradient' | 'icon' | 'inline' | 'dark';
  };
}

const gradientClasses = [
  'from-primary-500 to-primary-600',
  'from-accent-400 to-accent-500',
  'from-primary-600 to-accent-500',
  'from-primary-400 to-primary-600',
];

const statIcons = [
  // trending-up
  <svg key="trending" className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
  </svg>,
  // users
  <svg key="users" className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>,
  // clock
  <svg key="clock" className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>,
  // award
  <svg key="award" className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.27.308 6.023 6.023 0 01-2.27-.308" />
  </svg>,
];

export default function StatsCounterSection({ data }: StatsCounterSectionProps) {
  const variant = data.variant || 'bar';

  if (variant === 'cards') {
    return (
      <section {...blockAttrs('stats-counter')} className="section-padding" aria-label="Statistics">
        <div className="container-width">
          {data.headline && (
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {data.stats?.map((stat, index) => (
              <div key={index} className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                <p className="text-4xl font-extrabold text-primary-600">{stat.value}</p>
                <p className="mt-2 text-sm font-medium text-gray-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'gradient') {
    return (
      <section {...blockAttrs('stats-counter')} className="section-padding" aria-label="Statistics">
        <div className="container-width">
          {data.headline && (
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {data.stats?.map((stat, index) => (
              <div
                key={index}
                className={`rounded-xl bg-gradient-to-br ${gradientClasses[index % gradientClasses.length]} p-8 text-center text-white`}
              >
                <p className="text-4xl font-extrabold">{stat.value}</p>
                <p className="mt-2 text-sm font-medium text-white/80">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'icon') {
    return (
      <section {...blockAttrs('stats-counter')} className="section-padding" aria-label="Statistics">
        <div className="container-width">
          {data.headline && (
            <h2 className="mb-12 text-center text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {data.stats?.map((stat, index) => (
              <div key={index} className="rounded-xl bg-gray-50 p-8 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-500">
                  {statIcons[index % statIcons.length]}
                </div>
                <p className="text-4xl font-extrabold text-primary-600">{stat.value}</p>
                <p className="mt-2 text-sm font-medium text-gray-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'dark') {
    return (
      <section {...blockAttrs('stats-counter')} className="bg-primary-900 py-16" aria-label="Statistics">
        <div className="container-width">
          {data.headline && (
            <h2 className="mb-12 text-center text-3xl font-bold text-white sm:text-4xl">
              {data.headline}
            </h2>
          )}
          <div className="flex flex-wrap items-center justify-center">
            {data.stats?.map((stat, index) => (
              <div
                key={index}
                className={`px-10 py-4 text-center ${
                  index < (data.stats?.length ?? 0) - 1 ? 'border-r border-primary-700' : ''
                }`}
              >
                <p className="text-5xl font-extrabold text-white">{stat.value}</p>
                <p className="mt-2 text-sm font-medium text-primary-300">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'inline') {
    return (
      <section {...blockAttrs('stats-counter')} className="border-y border-gray-200 py-8" aria-label="Statistics">
        <div className="container-width">
          {data.headline && (
            <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-gray-500">
              {data.headline}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center divide-x divide-gray-300">
            {data.stats?.map((stat, index) => (
              <div key={index} className="px-8 py-2 text-center">
                <p className="text-3xl font-extrabold text-gray-900">{stat.value}</p>
                <p className="mt-1 text-sm font-medium text-gray-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('stats-counter')} className="border-y bg-primary-900 py-12" aria-label="Statistics">
      <div className="container-width">
        {data.headline && (
          <p className="mb-8 text-center text-sm font-semibold uppercase tracking-wider text-primary-300">
            {data.headline}
          </p>
        )}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {data.stats?.map((stat, index) => (
            <div key={index} className="text-center">
              <p className="text-3xl font-extrabold text-white sm:text-4xl">{stat.value}</p>
              <p className="mt-1 text-sm font-medium text-primary-300">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
