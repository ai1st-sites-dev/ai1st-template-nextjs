import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { BreadcrumbJsonLd, ServiceJsonLd } from '@/components/JsonLd';
import { brand, getSeo, getServices, getNonHomePages, getPage, isValidLocale, locales } from '@/lib/config';

const RESERVED_SLUGS = ['blog', '_next'];

export async function generateStaticParams() {
  const params: { locale: string; slug: string[] }[] = [];
  for (const locale of locales) {
    const pages = getNonHomePages(locale).filter(
      (p) => !RESERVED_SLUGS.some((r) => p.slug === r || p.slug.startsWith(r + '/'))
    );
    if (pages.length === 0) {
      params.push({ locale, slug: ['_'] });
    } else {
      for (const p of pages) {
        params.push({ locale, slug: p.slug.split('/') });
      }
    }
  }
  return params;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string[] }> }): Promise<Metadata> {
  const { locale, slug: slugArray } = await params;
  if (!isValidLocale(locale)) return {};
  const slug = slugArray.join('/');
  const page = getPage(slug, locale);
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: `/${locale}/${page.slug}`,
    },
    openGraph: {
      title: `${page.title} | ${brand.name}`,
      description: page.description,
      url: `/${locale}/${page.slug}`,
    },
  };
}

export default async function DynamicPage({ params }: { params: Promise<{ locale: string; slug: string[] }> }) {
  const { locale, slug: slugArray } = await params;
  if (!isValidLocale(locale)) notFound();
  const slug = slugArray.join('/');
  const page = getPage(slug, locale);
  if (!page) redirect(`/${locale}`);

  const seo = getSeo(locale);
  const services = getServices(locale);

  const hasServicesList = page.sections.some(
    (s) => s.type === 'services-list'
  );

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
      ? { name: serviceDetailPage.title, url: `${seo.domain}/${locale}/${serviceDetailSlug}` }
      : { name: slugParts[0].replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), url: `${seo.domain}/${locale}/${slugParts[0]}` };

    breadcrumbItems = [
      { name: 'Home', url: `${seo.domain}/${locale}` },
      middleBreadcrumb,
      { name: page.title, url: `${seo.domain}/${locale}/${slug}` },
    ];
  } else {
    breadcrumbItems = [
      { name: 'Home', url: `${seo.domain}/${locale}` },
      { name: page.title, url: `${seo.domain}/${locale}/${slug}` },
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
            serviceUrl={`${seo.domain}/${locale}/${slug}#${service.id}`}
          />
        ))}
      {matchedService && (
        <ServiceJsonLd
          locale={locale}
          serviceName={matchedService.name}
          serviceDescription={matchedService.fullDescription}
          serviceUrl={`${seo.domain}/${locale}/${slug}`}
        />
      )}
      <SectionRenderer sections={page.sections} locale={locale} />
    </>
  );
}
