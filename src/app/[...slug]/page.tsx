import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { BreadcrumbJsonLd, ServiceJsonLd } from '@/components/JsonLd';
import { brand, seo, services, getNonHomePages, getPage } from '@/lib/config';

const RESERVED_SLUGS = ['blog', '_next'];

export async function generateStaticParams() {
  const pages = getNonHomePages().filter(
    (p) => !RESERVED_SLUGS.some((r) => p.slug === r || p.slug.startsWith(r + '/'))
  );
  if (pages.length === 0) {
    return [{ slug: ['_'] }];
  }
  return pages.map((p) => ({ slug: p.slug.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const { slug: slugArray } = await params;
  const slug = slugArray.join('/');
  const page = getPage(slug);
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: `/${page.slug}`,
    },
    openGraph: {
      title: `${page.title} | ${brand.name}`,
      description: page.description,
      url: `/${page.slug}`,
    },
  };
}

export default async function DynamicPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: slugArray } = await params;
  const slug = slugArray.join('/');
  const page = getPage(slug);
  if (!page) redirect('/');

  const hasServicesList = page.sections.some(
    (s) => s.type === 'services-list'
  );

  // Service detail page detection
  const isServiceDetail = slug.startsWith('services/') && slug !== 'services';
  const matchedService = isServiceDetail
    ? services.find((s) => s.id === slug.replace('services/', ''))
    : null;

  // Nested slug (e.g. "dog-grooming/dog-grooming-near-me") gets 3-level breadcrumb
  const slugParts = slug.split('/');
  let breadcrumbItems: { name: string; url: string }[];

  if (slugParts.length > 1) {
    // For keyword pages, link middle level to service detail page if it exists
    const serviceDetailSlug = `services/${slugParts[0]}`;
    const serviceDetailPage = getPage(serviceDetailSlug);
    const middleBreadcrumb = serviceDetailPage
      ? { name: serviceDetailPage.title, url: `${seo.domain}/${serviceDetailSlug}` }
      : { name: slugParts[0].replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), url: `${seo.domain}/${slugParts[0]}` };

    breadcrumbItems = [
      { name: 'Home', url: seo.domain },
      middleBreadcrumb,
      { name: page.title, url: `${seo.domain}/${slug}` },
    ];
  } else {
    breadcrumbItems = [
      { name: 'Home', url: seo.domain },
      { name: page.title, url: `${seo.domain}/${slug}` },
    ];
  }

  return (
    <>
      <BreadcrumbJsonLd items={breadcrumbItems} />
      {hasServicesList &&
        services.map((service) => (
          <ServiceJsonLd
            key={service.id}
            serviceName={service.name}
            serviceDescription={service.fullDescription}
            serviceUrl={`${seo.domain}/${slug}#${service.id}`}
          />
        ))}
      {matchedService && (
        <ServiceJsonLd
          serviceName={matchedService.name}
          serviceDescription={matchedService.fullDescription}
          serviceUrl={`${seo.domain}/${slug}`}
        />
      )}
      <SectionRenderer sections={page.sections} />
    </>
  );
}
