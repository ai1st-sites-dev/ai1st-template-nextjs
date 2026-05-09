// TICKET-129: default-locale blog post alias.
//   /blog/<post-slug>  → renders default-locale post (PM补完)
import type { Metadata } from 'next';
import LocaleBlogPost, {
  generateStaticParams as localeGenerate,
  generateMetadata as localeMetadata,
} from '../../[locale]/blog/[slug]/page';
import SiteShell from '@/components/SiteShell';
import { defaultLocale } from '@/lib/config';

export async function generateStaticParams() {
  const localeParams = await localeGenerate();
  return localeParams
    .filter((p) => p.locale === defaultLocale)
    .map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return localeMetadata({ params: Promise.resolve({ locale: defaultLocale, slug }) });
}

export default async function RootBlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <SiteShell locale={defaultLocale}>
      <LocaleBlogPost params={Promise.resolve({ locale: defaultLocale, slug })} />
    </SiteShell>
  );
}
