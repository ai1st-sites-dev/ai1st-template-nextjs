import type { SiteData } from '@template/lib/types/config';
import { getSeo, getServices, getInLanguage, getBrandName, localeUrl } from '@template/lib/config';
import type { BlogPostConfig } from '@template/lib/types/config';
import type { BlockConfig, DynamicPageConfig } from '@template/lib/types/config';
import { faqItems } from '@blocks/faq/Section';
import { hoursSegments } from '../../scripts/lib/local-business-facts.js';
import { mainLocation, mainLocationFacts, withLocationIds } from '../../scripts/lib/locations.js';
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
//   · 营业时间：主地点的 `hours`（多段，AI 转写 + 脚本核过，§hoursSegments；#1976 起按地点存，老站 seo.json 里那份派生时搬过来）
//     —— 没有 ⟹ 没有 `openingHoursSpecification`；
//   · 地址的 `streetAddress` / `postalCode`、`geo`：主地点（`brand.locations[0]`，`locations.js` §mainLocation），建站时那一次 Nominatim 回答里取（`scripts/lib/geocode.js`）；
//   · `sameAs`：`brand.socialLinks`（建站时从 payload 原样写进去的社交链接）；
//   · `aggregateRating`：主地点的 `rating`（#1976，同上），只在抓到真实平台评分时才有（`local-business-facts.js` §ratingFrom）。
export function LocalBusinessJsonLd({ site, locale }: { site: SiteData; locale: string }) {
  const { brand } = site;
  if (Array.isArray(brand.locations) && brand.locations.length >= 2) return <LocationsJsonLd site={site} locale={locale} />;
  const seo = getSeo(site, locale);
  const services = getServices(site, locale);
  const loc = mainLocation(brand);
  // 派生已经把老站 seo.json 里那份搬进了主地点；没有地点的站搬不了，那份还留在 seo.json —— 跟 contact 那一行、check-jsonld 同一条规则读。
  const facts = mainLocationFacts(brand, seo);
  const segments = hoursSegments(facts.hours);
  const sameAs = socialUrls(brand.socialLinks);
  const rating = facts.rating;
  const geo = loc?.geo && Number.isFinite(loc.geo.lat) && Number.isFinite(loc.geo.lng) ? loc.geo : null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    inLanguage: getInLanguage(site, locale),
    name: getBrandName(site, locale),
    description: seo.siteDescription,
    url: seo.domain,
    telephone: loc?.phone,
    email: brand.email,
    // #1596 —— 代码拼的站级计划（站级那一通失败时）只写老板给过的：没给地点 ⟹ areaServed / addresses 是空的，整项不出。
    ...(seo.schema.areaServed.length ? {
      areaServed: seo.schema.areaServed.map((area) => ({
        '@type': area.type,
        name: area.name,
      })),
    } : {}),
    // 街道 / 邮编只有一份（第一个地点的），挂在第一个地址上。
    ...(seo.schema.addresses.length ? {
      address: seo.schema.addresses.map((addr, i) => ({
        '@type': 'PostalAddress',
        ...(i === 0 && loc?.streetAddress ? { streetAddress: loc.streetAddress } : {}),
        addressLocality: addr.locality,
        addressRegion: addr.region,
        ...(i === 0 && loc?.postalCode ? { postalCode: loc.postalCode } : {}),
        addressCountry: addr.country,
      })),
    } : {}),
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
    ...(seo.schema.priceRange ? { priceRange: seo.schema.priceRange } : {}),
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

/** 地点名里已经含品牌名（不分大小写）⟹ 地点名；否则「品牌名 – 地点名」；地点没有名字 ⟹ 品牌名。 */
function locationBusinessName(brandName: string, label: string | undefined): string {
  const l = (label || '').trim();
  if (!l) return brandName;
  return brandName && !l.toLowerCase().includes(brandName.toLowerCase()) ? `${brandName} – ${l}` : l;
}

/** 这一家的地点页（页面 JSON 顶层 `locationPage: {kind: "location", id}`，同 contact 块 §locationPageHref）的完整地址；没有 ⟹ 网站地址。 */
function locationUrl(site: SiteData, locale: string, domain: string, id: string): string {
  const pages = (site.pagesByLocale && site.pagesByLocale[locale]) || [];
  const page = pages.find((p) => p.locationPage && p.locationPage.kind === 'location' && p.locationPage.id === id);
  return page ? `${(domain || '').replace(/\/+$/, '')}${localeUrl(site, page.slug, locale)}` : domain;
}

// #1981（Epic:MultiLocation T6）—— 两个及以上地点：每个地点一份 LocalBusiness，各带这一家的地址 / 电话 / 营业时间 / 坐标 / 评分。
//   · `@id` = 这一家地点页地址（没有地点页就是网站地址）+ `#business-<地点 id>`，`url` = 前半；
//   · `telephone` 这一家没有就用主地点的；`address` 一份：街道 / 城市 / 邮编是这一家的，省 / 国家取 `seo.schema.addresses[0]`，哪一项没有就不出；
//   · 营业时间 / 评分：第一家经 §mainLocationFacts（老站 seo.json 里那份算它的，同单地点那一份），其余读这一家自己的；规则同单地点；
//   · `sameAs` / `priceRange` / `areaServed` / `hasOfferCatalog` 每份都带，同单地点。
//   一个地点 ⟹ 不走这里，上面那份原样（输出逐字节不变）。
function LocationsJsonLd({ site, locale }: { site: SiteData; locale: string }) {
  const { brand } = site;
  const seo = getSeo(site, locale);
  const services = getServices(site, locale);
  const brandName = getBrandName(site, locale);
  const sameAs = socialUrls(brand.socialLinks);
  const main = mainLocation(brand);
  const mainFacts = mainLocationFacts(brand, seo);
  const region = seo.schema.addresses[0];
  const locations = withLocationIds(brand.locations);
  const schemas = locations.map((loc, i) => {
    const facts = i === 0 ? mainFacts : { hours: loc.hours, rating: loc.rating };
    const segments = hoursSegments(facts.hours);
    const rating = facts.rating;
    const geo = loc.geo && Number.isFinite(loc.geo.lat) && Number.isFinite(loc.geo.lng) ? loc.geo : null;
    const url = locationUrl(site, locale, seo.domain, loc.id as string);
    const address = {
      ...(loc.streetAddress ? { streetAddress: loc.streetAddress } : {}),
      ...(loc.city ? { addressLocality: loc.city } : {}),
      ...(region && region.region ? { addressRegion: region.region } : {}),
      ...(loc.postalCode ? { postalCode: loc.postalCode } : {}),
      ...(region && region.country ? { addressCountry: region.country } : {}),
    };
    return {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': `${url}#business-${loc.id}`,
      inLanguage: getInLanguage(site, locale),
      name: locationBusinessName(brandName, loc.label),
      description: seo.siteDescription,
      url,
      telephone: loc.phone || main?.phone,
      email: loc.email || brand.email,
      ...(seo.schema.areaServed.length ? {
        areaServed: seo.schema.areaServed.map((area) => ({ '@type': area.type, name: area.name })),
      } : {}),
      ...(Object.keys(address).length ? { address: { '@type': 'PostalAddress', ...address } } : {}),
      ...(geo ? { geo: { '@type': 'GeoCoordinates', latitude: geo.lat, longitude: geo.lng } } : {}),
      ...(sameAs.length ? { sameAs } : {}),
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: seo.schema.offerCatalogName,
        itemListElement: services.map((service) => ({
          '@type': 'Offer',
          itemOffered: { '@type': 'Service', name: service.name, description: service.shortDescription },
        })),
      },
      ...(seo.schema.priceRange ? { priceRange: seo.schema.priceRange } : {}),
      ...(segments.length ? {
        openingHoursSpecification: segments.map((seg) => ({
          '@type': 'OpeningHoursSpecification', dayOfWeek: seg.days, opens: seg.opens, closes: seg.closes,
        })),
      } : {}),
      ...(rating && rating.ratingValue > 0 && rating.reviewCount > 0 ? {
        aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.ratingValue, reviewCount: rating.reviewCount },
      } : {}),
    };
  });
  return (
    <>
      {schemas.map((schema) => (
        <script key={schema['@id']} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(schema) }} />
      ))}
    </>
  );
}

export function WebSiteJsonLd({ site, locale }: { site: SiteData; locale: string }) {
  const seo = getSeo(site, locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    inLanguage: getInLanguage(site, locale),
    name: getBrandName(site, locale),
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

export function ServiceJsonLd({ site, locale, serviceName, serviceDescription, serviceUrl }: { site: SiteData; locale: string; serviceName: string; serviceDescription: string; serviceUrl: string }) {
  const { brand } = site;
  const seo = getSeo(site, locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    inLanguage: getInLanguage(site, locale),
    serviceType: serviceName,
    provider: {
      '@type': 'LocalBusiness',
      name: getBrandName(site, locale),
      telephone: mainLocation(brand)?.phone,
    },
    name: serviceName,
    description: serviceDescription,
    url: serviceUrl,
    ...(seo.schema.areaServed.length ? {
      areaServed: seo.schema.areaServed.slice(0, 2).map((area) => ({
        '@type': area.type,
        name: area.name,
      })),
    } : {}),
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
export function KeywordServiceJsonLd({ site, locale, page, pageUrl }: { site: SiteData; locale: string; page: DynamicPageConfig; pageUrl: string }) {
  const { brand } = site;
  const seo = getSeo(site, locale);
  const svc = keywordServiceFor(page, { seo, brand });
  if (!svc) return null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    inLanguage: getInLanguage(site, locale),
    name: svc.name,
    serviceType: svc.name,
    ...(page.description ? { description: page.description } : {}),
    url: pageUrl,
    provider: {
      '@type': 'LocalBusiness',
      name: getBrandName(site, locale),
      ...(mainLocation(brand)?.phone ? { telephone: mainLocation(brand)?.phone } : {}),
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

export function ArticleJsonLd({ site, locale, post }: { site: SiteData; locale: string; post: BlogPostConfig }) {
  const seo = getSeo(site, locale);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    inLanguage: getInLanguage(site, locale),
    headline: post.title,
    description: post.seo.metaDescription,
    author: {
      '@type': 'Person',
      name: post.author,
    },
    publisher: {
      '@type': 'Organization',
      name: getBrandName(site, locale),
      url: seo.domain,
    },
    datePublished: post.publishedAt,
    url: `${seo.domain}${localeUrl(site, post.slug, locale, 'blogPost')}`,
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
