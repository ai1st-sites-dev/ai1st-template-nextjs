import { notFound } from 'next/navigation';
import SectionRenderer from '@/components/SectionRenderer';
import { getHomePage, isValidLocale } from '@/lib/config';

export default function HomePage({ locale }: { locale: string }) {
  if (!isValidLocale(locale)) notFound();
  return <SectionRenderer blocks={getHomePage(locale).blocks} locale={locale} />;
}
