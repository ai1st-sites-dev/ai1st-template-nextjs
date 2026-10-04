import { notFound } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { BreadcrumbJsonLd, ServiceJsonLd } from '@/components/JsonLd';
import { getSeo, getServices, getPage, isValidLocale, localeUrl } from '@/lib/config';
import { breadcrumbJsonLdItems } from '@/lib/breadcrumbs';
import { iconTablesFor } from '../../../scripts/lib/icons.js';
import { blocksUseSource, itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';

export default function SubPage({ locale, slug }: { locale: string; slug: string }) {
  if (!isValidLocale(locale)) notFound();
  const page = getPage(slug, locale);
  // #1552 —— 不存在的页是真 404（`app/not-found.tsx`），不再跳回首页（Google 把那种跳转当 soft-404）。
  if (!page) notFound();

  const seo = getSeo(locale);
  const services = getServices(locale);

  // #1505 —— 服务的结构化数据：页面上有块把服务目录引用进来（`items: {source: "services"}`）。
  //    📌 #1425（T3）：原来前半句还认旧块 `services-list`，它随旧库删了。
  const hasServicesList = blocksUseSource(page.blocks, 'services');
  // 写成引用的列表槽先展开，再查图标表（展开出来的 `icon` 也要进表）。
  const blocks = resolveItemSources(page.blocks, itemSourceContext(locale));

  const isServiceDetail = slug.startsWith('services/') && slug !== 'services';
  const matchedService = isServiceDetail
    ? services.find((s) => s.id === slug.replace('services/', ''))
    : null;

  const breadcrumbItems = breadcrumbJsonLdItems(slug, locale);

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
      <SectionRenderer blocks={blocks} locale={locale} iconTables={iconTablesFor(blocks)} pageSlug={slug} />
    </>
  );
}
