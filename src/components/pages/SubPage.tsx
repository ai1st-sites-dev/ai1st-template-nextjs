import { notFound, redirect } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { BreadcrumbJsonLd, ServiceJsonLd } from '@/components/JsonLd';
import { getSeo, getServices, getPage, isValidLocale, localeUrl } from '@/lib/config';
import { breadcrumbsFor } from '@/lib/breadcrumbs';
import { iconTablesFor } from '../../../scripts/lib/icons.js';

export default function SubPage({ locale, slug }: { locale: string; slug: string }) {
  if (!isValidLocale(locale)) notFound();
  const page = getPage(slug, locale);
  if (!page) redirect(localeUrl('home', locale));

  const seo = getSeo(locale);
  const services = getServices(locale);

  const hasServicesList = page.blocks.some((b) => b.type === 'services-list');

  const isServiceDetail = slug.startsWith('services/') && slug !== 'services';
  const matchedService = isServiceDetail
    ? services.find((s) => s.id === slug.replace('services/', ''))
    : null;

  const breadcrumbItems = breadcrumbsFor(slug, locale).map((c) => ({ name: c.label, url: c.url }));

  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbItems} />
      {hasServicesList &&
        services.map((service) => (
          <ServiceJsonLd
            key={service.id}
            locale={locale}
            serviceName={service.name}
            serviceDescription={service.fullDescription}
            serviceUrl={`${seo.domain}${localeUrl(slug, locale)}#${service.id}`}
          />
        ))}
      {matchedService && (
        <ServiceJsonLd
          locale={locale}
          serviceName={matchedService.name}
          serviceDescription={matchedService.fullDescription}
          serviceUrl={`${seo.domain}${localeUrl(slug, locale)}`}
        />
      )}
      {/* #1475 —— 画内联 SVG 图标的块要一张服务端查好的图标表（§iconTablesFor；别的块不挂）。 */}
      <SectionRenderer blocks={page.blocks} locale={locale} iconTables={iconTablesFor(page.blocks)} pageSlug={slug} />
    </>
  );
}
