import { notFound } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { getHomePage, isValidLocale } from '@/lib/config';
import { iconTablesFor } from '../../../scripts/lib/icons.js';

export default function HomePage({ locale }: { locale: string }) {
  if (!isValidLocale(locale)) notFound();
  const blocks = getHomePage(locale).blocks;
  // #1475 —— 画内联 SVG 图标的块（features-new …）要一张服务端查好的图标表（§iconTablesFor；别的块不挂）。
  return <SectionRenderer blocks={blocks} locale={locale} iconTables={iconTablesFor(blocks)} />;
}
