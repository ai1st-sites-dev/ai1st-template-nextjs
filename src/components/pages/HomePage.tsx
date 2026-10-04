import { notFound } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { FaqPageJsonLd } from '@/components/JsonLd';
import { getHomePage, isValidLocale } from '@/lib/config';
import { iconTablesFor } from '../../../scripts/lib/icons.js';
import { itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';

export default function HomePage({ locale }: { locale: string }) {
  if (!isValidLocale(locale)) notFound();
  // #1505 —— 写成引用的列表槽（`items: {source: "services"}`）先展开，再查图标表：展开出来的 `icon` 也要进表。
  const blocks = resolveItemSources(getHomePage(locale).blocks, itemSourceContext(locale));
  // #1475 —— 画内联 SVG 图标的块（features …）要一张服务端查好的图标表（§iconTablesFor；别的块不挂）。
  return (
    <>
      {/* #1551 —— 这一页的 faq 块 → FAQPage（没有问答就什么都不出）。 */}
      <FaqPageJsonLd blocks={blocks} />
      <SectionRenderer blocks={blocks} locale={locale} iconTables={iconTablesFor(blocks)} />
    </>
  );
}
