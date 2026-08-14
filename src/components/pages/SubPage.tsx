import { notFound, redirect } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { BreadcrumbJsonLd, ServiceJsonLd } from '@/components/JsonLd';
import { getSeo, getServices, getPage, isValidLocale, localeUrl } from '@/lib/config';

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

  const slugParts = slug.split('/');
  let breadcrumbItems: { name: string; url: string }[];

  if (slugParts.length > 1) {
    const serviceDetailSlug = `services/${slugParts[0]}`;
    const serviceDetailPage = getPage(serviceDetailSlug, locale);
    const middleBreadcrumb = serviceDetailPage
      ? { name: serviceDetailPage.title, url: `${seo.domain}${localeUrl(serviceDetailSlug, locale)}` }
      : { name: slugParts[0].replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), url: `${seo.domain}${localeUrl(slugParts[0], locale)}` };

    breadcrumbItems = [
      { name: 'Home', url: `${seo.domain}${localeUrl('home', locale)}` },
      middleBreadcrumb,
      { name: page.title, url: `${seo.domain}${localeUrl(slug, locale)}` },
    ];
  } else {
    breadcrumbItems = [
      { name: 'Home', url: `${seo.domain}${localeUrl('home', locale)}` },
      { name: page.title, url: `${seo.domain}${localeUrl(slug, locale)}` },
    ];
  }

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
      <SectionRenderer blocks={page.blocks} locale={locale} />
    </>
  );
}
