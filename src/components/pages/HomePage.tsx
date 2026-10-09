import { notFound } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { FaqPageJsonLd } from '@/components/JsonLd';
import type { SiteData } from '@/lib/types/config';
import { getHomePage, isValidLocale } from '@/lib/config';
import { iconTablesFor } from '../../../scripts/lib/icons.js';
import { itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';

export default function HomePage({ site, locale }: { site: SiteData; locale: string }) {
  if (!isValidLocale(site, locale)) notFound();
  // #1505 —— 写成引用的列表槽（`items: {source: "services"}`）先展开，再查图标表：展开出来的 `icon` 也要进表。
  const blocks = resolveItemSources(getHomePage(site, locale).blocks, itemSourceContext(site, locale));
  // #1475 —— 画内联 SVG 图标的块（features …）要一张服务端查好的图标表（§iconTablesFor；别的块不挂）。
  return (
    <>
      {/* #1551 —— 这一页的 faq 块 → FAQPage（没有问答就什么都不出）。 */}
      <FaqPageJsonLd blocks={blocks} />
      <SectionRenderer site={site} blocks={blocks} locale={locale} iconTables={iconTablesFor(blocks)} />
    </>
  );
}
