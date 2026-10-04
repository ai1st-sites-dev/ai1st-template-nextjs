import { brand, getSeo, getServices, getInLanguage, getBrandName, localeUrl } from '@/lib/config';
import type { BlogPostConfig } from '@/lib/types/config';
import type { BlockConfig, DynamicPageConfig } from '@/lib/types/config';
import { faqItems } from '@blocks/faq/Section';
import { hoursSegments } from '../../scripts/lib/local-business-facts.js';
import { keywordServiceFor } from '../../scripts/lib/keyword-service.js';
// #1551 r3 —— 每一个 JSON-LD 标签都经这一个函数（`<` 写成 \u003c，挡 `</script>` 跳出标签）；不许再直接写 JSON.stringify。
import { jsonLdHtml } from '../../scripts/lib/json-ld-html.js';

/** brand.socialLinks 的两种老形状（数组 `{platform, url}` / 对象 `{平台: url}`）→ 一组 URL。 */
function socialUrls(links: unknown): string[] {
  const raw = Array.isArray(links)
    ? links.map((l) => (l && typeof l === 'object' ? (l as { url?: unknown }).url : undefined))
    : links && typeof links === 'object' ? Object.values(links as Record<string, unknown>) : [];
  return raw.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim());
}

// #1551 —— LocalBusiness 的每一项都来自老板给的料（建站表格 / 抓到的商家资料），没有料的那一项**整项不出**，不出空壳、不编：
//   · 营业时间：`seo.schema.openingHours`（多段，AI 转写 + 脚本核过，§hoursSegments）—— 没有 ⟹ 没有 `openingHoursSpecification`；
//   · 地址的 `streetAddress` / `postalCode`、`geo`：`brand.locations[0]`，建站时那一次 Nominatim 回答里取（`scripts/lib/geocode.js`）；
//   · `sameAs`：`brand.socialLinks`（建站时从 payload 原样写进去的社交链接）；
//   · `aggregateRating`：`seo.schema.aggregateRating`，只在抓到真实平台评分时才有（`local-business-facts.js` §ratingFrom）。
export function LocalBusinessJsonLd({ locale }: { locale: string }) {
  const seo = getSeo(locale);
  const services = getServices(locale);
  const loc = brand.locations[0];
  const segments = hoursSegments(seo.schema.openingHours);
  const sameAs = socialUrls(brand.socialLinks);
  const rating = seo.schema.aggregateRating;
  const geo = loc?.geo && Number.isFinite(loc.geo.lat) && Number.isFinite(loc.geo.lng) ? loc.geo : null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    inLanguage: getInLanguage(locale),
    name: getBrandName(locale),
    description: seo.siteDescription,
    url: seo.domain,
    telephone: loc?.phone,
    email: brand.email,
    areaServed: seo.schema.areaServed.map((area) => ({
      '@type': area.type,
      name: area.name,
    })),
    // 街道 / 邮编只有一份（第一个地点的），挂在第一个地址上。
    address: seo.schema.addresses.map((addr, i) => ({
      '@type': 'PostalAddress',
      ...(i === 0 && loc?.streetAddress ? { streetAddress: loc.streetAddress } : {}),
      addressLocality: addr.locality,
      addressRegion: addr.region,
      ...(i === 0 && loc?.postalCode ? { postalCode: loc.postalCode } : {}),
      addressCountry: addr.country,
    })),
    ...(geo ? { geo: { '@type': 'GeoCoordinates', latitude: geo.lat, longitude: geo.lng } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
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
    ...(segments.length ? {
      openingHoursSpecification: segments.map((seg) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: seg.days,
        opens: seg.opens,
        closes: seg.closes,
      })),
    } : {}),
    ...(rating && rating.ratingValue > 0 && rating.reviewCount > 0 ? {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.ratingValue, reviewCount: rating.reviewCount },
    } : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
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
    // #1551 —— 这里原来挂着一个「站内搜索」动作，可站上根本没有搜索、target 里也没有 {search_term_string}，是无效标记，删了。
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
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
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
    />
  );
}

/**
 * #1551 —— 关键词页的 Service：`name` = 这一页的目标词（首字母大写）、`areaServed` = 词里的地名（没有就是站的地区）、
 * `provider` = 本站 LocalBusiness。算法全在 `scripts/lib/keyword-service.js`；不是关键词页 / 没有目标词 ⟹ 什么都不出。
 * 📌 目标词是 T4 #1548 写进页面数据的 `seo.targetKeyword` —— 它落地之前，真实站点上这里一条都不出。
 */
export function KeywordServiceJsonLd({ locale, page, pageUrl }: { locale: string; page: DynamicPageConfig; pageUrl: string }) {
  const seo = getSeo(locale);
  const svc = keywordServiceFor(page, { seo, brand });
  if (!svc) return null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    inLanguage: getInLanguage(locale),
    name: svc.name,
    serviceType: svc.name,
    ...(page.description ? { description: page.description } : {}),
    url: pageUrl,
    provider: {
      '@type': 'LocalBusiness',
      name: getBrandName(locale),
      ...(brand.locations[0]?.phone ? { telephone: brand.locations[0].phone } : {}),
      ...(seo.domain ? { url: seo.domain } : {}),
    },
    ...(svc.areaServed.length ? { areaServed: svc.areaServed.map((a) => ({ '@type': a.type, name: a.name })) } : {}),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
    />
  );
}

// #1552 —— `url` 可缺：不存在的那一层（没有服务详情页时的中间层）只出名字、不出 `item`，不指向一个 404。
export function BreadcrumbJsonLd({ items }: { items: { name: string; url?: string }[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
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
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
    />
  );
}

/**
 * #1551 —— 这一页的 faq 块 → 一份 FAQPage（同一页有几个 faq 块就并成一份：Google 不认同一页上的多份 FAQPage）。
 * 只收问题和答案都有的那几条（没有答案的问题不是一条问答，FAQPage 也不收）；条目过滤跟块自己是同一个函数（§faqItems）。
 * 这一页没有一条问答 ⟹ 什么都不出。
 */
export function FaqPageJsonLd({ blocks }: { blocks: BlockConfig[] }) {
  const qa = blocks
    .filter((b) => b && b.type === 'faq')
    .flatMap((b) => faqItems(b.data))
    .filter((it) => typeof it.answer === 'string' && it.answer.trim() !== '');
  if (!qa.length) return null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }}
    />
  );
}
