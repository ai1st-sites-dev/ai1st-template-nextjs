import { brand, getSeo, getServices, getInLanguage, getBrandName, localeUrl } from '@/lib/config';
import type { BlogPostConfig } from '@/lib/types/config';

export function LocalBusinessJsonLd({ locale }: { locale: string }) {
  const seo = getSeo(locale);
  const services = getServices(locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    inLanguage: getInLanguage(locale),
    name: getBrandName(locale),
    description: seo.siteDescription,
    url: seo.domain,
    telephone: brand.locations[0]?.phone,
    email: brand.email,
    areaServed: seo.schema.areaServed.map((area) => ({
      '@type': area.type,
      name: area.name,
    })),
    address: seo.schema.addresses.map((addr) => ({
      '@type': 'PostalAddress',
      addressLocality: addr.locality,
      addressRegion: addr.region,
      addressCountry: addr.country,
    })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: seo.schema.offerCatalogName,
      itemListElement: services.map((service) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: service.name,
          description: service.shortDescription,
        },
      })),
    },
    priceRange: seo.schema.priceRange,
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: seo.schema.openingHours.days,
      opens: seo.schema.openingHours.opens,
      closes: seo.schema.openingHours.closes,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function WebSiteJsonLd({ locale }: { locale: string }) {
  const seo = getSeo(locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    inLanguage: getInLanguage(locale),
    name: getBrandName(locale),
    url: seo.domain,
    description: seo.siteDescription,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${seo.domain}${localeUrl('services', locale)}`,
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function ServiceJsonLd({ locale, serviceName, serviceDescription, serviceUrl }: { locale: string; serviceName: string; serviceDescription: string; serviceUrl: string }) {
  const seo = getSeo(locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    inLanguage: getInLanguage(locale),
    serviceType: serviceName,
    provider: {
      '@type': 'LocalBusiness',
      name: getBrandName(locale),
      telephone: brand.locations[0]?.phone,
    },
    name: serviceName,
    description: serviceDescription,
    url: serviceUrl,
    areaServed: seo.schema.areaServed.slice(0, 2).map((area) => ({
      '@type': area.type,
      name: area.name,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function BreadcrumbJsonLd({ items }: { items: { name: string; url: string }[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function ArticleJsonLd({ locale, post }: { locale: string; post: BlogPostConfig }) {
  const seo = getSeo(locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    inLanguage: getInLanguage(locale),
    headline: post.title,
    description: post.seo.metaDescription,
    author: {
      '@type': 'Person',
      name: post.author,
    },
    publisher: {
      '@type': 'Organization',
      name: getBrandName(locale),
      url: seo.domain,
    },
    datePublished: post.publishedAt,
    url: `${seo.domain}${localeUrl(post.slug, locale, 'blogPost')}`,
    keywords: post.tags.join(', '),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
