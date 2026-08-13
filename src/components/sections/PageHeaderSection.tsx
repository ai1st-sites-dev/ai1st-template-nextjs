import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderSectionProps {
  data: {
    title: string;
    subtitle?: string;
    breadcrumbs?: Breadcrumb[];
    variant?: 'default' | 'minimal' | 'centered' | 'with-description';
  };
}

export default function PageHeaderSection({ data }: PageHeaderSectionProps) {
  const variant = data.variant || 'default';

  if (variant === 'minimal') {
    return (
      <section {...blockAttrs('page-header')} className="bg-white">
        <div className="container-width px-4 py-16 sm:px-6 md:py-20 lg:px-8">
          {data.breadcrumbs && (
            <nav aria-label="Breadcrumb" className="mb-4">
              <ol className="flex items-center gap-2 text-sm text-gray-500">
                {data.breadcrumbs?.map((crumb, i) => (
                  <li key={i}>
                    {i > 0 && <span aria-hidden="true" className="mr-2">/</span>}
                    {crumb.href ? (
                      <Link href={crumb.href} className="hover:text-primary-600">{crumb.label}</Link>
                    ) : (
                      <span className="text-gray-700">{crumb.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <h1 className="inline border-b-4 border-primary-500 pb-2 text-3xl font-bold text-gray-900 sm:text-4xl lg:text-5xl">
            {data.title}
          </h1>
          {data.subtitle && (
            <p className="mt-6 max-w-2xl text-lg text-gray-600">
              {data.subtitle}
            </p>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'centered') {
    return (
      <section {...blockAttrs('page-header')} className="bg-gradient-to-br from-primary-900 to-primary-700 text-white">
        <div className="container-width px-4 py-24 text-center sm:px-6 lg:px-8">
          {data.breadcrumbs && (
            <nav aria-label="Breadcrumb" className="mb-4">
              <ol className="flex items-center justify-center gap-2 text-sm text-primary-200">
                {data.breadcrumbs?.map((crumb, i) => (
                  <li key={i}>
                    {i > 0 && <span aria-hidden="true" className="mr-2">/</span>}
                    {crumb.href ? (
                      <Link href={crumb.href} className="hover:text-white">{crumb.label}</Link>
                    ) : (
                      <span className="text-white">{crumb.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <h1 className="text-3xl font-bold sm:text-4xl lg:text-5xl">
            {data.title}
          </h1>
          {data.subtitle && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-100">
              {data.subtitle}
            </p>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'with-description') {
    return (
      <section {...blockAttrs('page-header')} className="bg-gradient-to-br from-primary-900 to-primary-700 text-white">
        <div className="container-width px-4 py-16 sm:px-6 md:py-20 lg:px-8">
          <div className="grid items-end gap-8 lg:grid-cols-2">
            <div>
              {data.breadcrumbs && (
                <nav aria-label="Breadcrumb" className="mb-4">
                  <ol className="flex items-center gap-2 text-sm text-primary-200">
                    {data.breadcrumbs?.map((crumb, i) => (
                      <li key={i}>
                        {i > 0 && <span aria-hidden="true" className="mr-2">/</span>}
                        {crumb.href ? (
                          <Link href={crumb.href} className="hover:text-white">{crumb.label}</Link>
                        ) : (
                          <span className="text-white">{crumb.label}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <h1 className="text-3xl font-bold sm:text-4xl lg:text-5xl">
                {data.title}
              </h1>
            </div>
            {data.subtitle && (
              <div>
                <p className="text-lg leading-relaxed text-primary-100">
                  {data.subtitle}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('page-header')} className="bg-gradient-to-br from-primary-900 to-primary-700 text-white">
      <div className="container-width px-4 py-16 sm:px-6 md:py-20 lg:px-8">
        {data.breadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex items-center gap-2 text-sm text-primary-200">
              {data.breadcrumbs?.map((crumb, i) => (
                <li key={i}>
                  {i > 0 && <span aria-hidden="true" className="mr-2">/</span>}
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-white">{crumb.label}</Link>
                  ) : (
                    <span className="text-white">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-3xl font-bold sm:text-4xl lg:text-5xl">
          {data.title}
        </h1>
        {data.subtitle && (
          <p className="mt-4 max-w-2xl text-lg text-primary-100">
            {data.subtitle}
          </p>
        )}
      </div>
    </section>
  );
}
