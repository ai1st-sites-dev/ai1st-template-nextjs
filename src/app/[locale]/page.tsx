import SectionRenderer from '@/components/SectionRenderer';
import { getHomePage, isValidLocale } from '@/lib/config';
import { notFound } from 'next/navigation';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();
  return <SectionRenderer sections={getHomePage(locale).sections} locale={locale} />;
}
