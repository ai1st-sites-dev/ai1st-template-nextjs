import SectionRenderer from '@/components/SectionRenderer';
import { FaqPageJsonLd, KeywordServiceJsonLd, ServiceJsonLd } from '@/components/JsonLd';
import type { SiteData } from '@/lib/types/config';
import { getSeo, getServices, getPage, localeUrl } from '@/lib/config';
import { iconTablesFor } from '../../../scripts/lib/icons.js';
import { blocksUseSource, itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';

// #1802 —— 「这一页不存在 ⟹ 404」挪到调用方：Next 那边是 `[...slug]/page.tsx`（#1552：真 404，不跳回首页），
// `render/` 只为存在的页出 HTML。这个组件从此不 import Next。
export default function SubPage({ site, locale, slug }: { site: SiteData; locale: string; slug: string }) {
  const page = getPage(site, slug, locale)!;

  const seo = getSeo(site, locale);
  const services = getServices(site, locale);

  // #1505 —— 服务的结构化数据：页面上有块把服务目录引用进来（`items: {source: "services"}`）。
  //    📌 #1425（T3）：原来前半句还认旧块 `services-list`，它随旧库删了。
  const hasServicesList = blocksUseSource(page.blocks, 'services');
  // 写成引用的列表槽先展开，再查图标表（展开出来的 `icon` 也要进表）。
  const blocks = resolveItemSources(page.blocks, itemSourceContext(site, locale, slug));

  // #1550 —— 恰好一段 `services/<id>` 才是服务详情页；`services/<id>/<词>` 是挂在它下面的关键词页。
  const isServiceDetail = /^services\/[^/]+$/.test(slug);
  const matchedService = isServiceDetail
    ? services.find((s) => s.id === slug.replace('services/', ''))
    : null;

  return (
    <>
      {/* #1551 —— 这一页的 faq 块 → FAQPage（没有问答就什么都不出）。 */}
      <FaqPageJsonLd blocks={blocks} />
      {hasServicesList &&
        services.map((service) => (
          <ServiceJsonLd
            site={site}
            key={service.id}
            locale={locale}
            serviceName={service.name}
            serviceDescription={service.fullDescription}
            serviceUrl={`${seo.domain}${localeUrl(site, slug, locale)}#${service.id}`}
          />
        ))}
      {matchedService && (
        <ServiceJsonLd
          site={site}
          locale={locale}
          serviceName={matchedService.name}
          serviceDescription={matchedService.fullDescription}
          serviceUrl={`${seo.domain}${localeUrl(site, slug, locale)}`}
        />
      )}
      {/* #1551 —— 关键词页的 Service（这一页有目标词才出，§KeywordServiceJsonLd）。 */}
      <KeywordServiceJsonLd site={site} locale={locale} page={page} pageUrl={`${seo.domain}${localeUrl(site, slug, locale)}`} />
      {/* #1475 —— 画内联 SVG 图标的块要一张服务端查好的图标表（§iconTablesFor；别的块不挂）。 */}
      <SectionRenderer site={site} blocks={blocks} locale={locale} iconTables={iconTablesFor(blocks)} pageSlug={slug} />
    </>
  );
}
