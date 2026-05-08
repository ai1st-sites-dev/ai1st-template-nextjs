import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArticleJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import { brand, getSeo, getBlogPosts, getAlternateLanguages, getXDefaultHref, isValidLocale, locales } from '@/lib/config';

export async function generateStaticParams() {
  const params: { locale: string; slug: string }[] = [];
  for (const locale of locales) {
    const posts = getBlogPosts(locale);
    if (posts.length === 0) {
      params.push({ locale, slug: '_' });
    } else {
      for (const post of posts) {
        params.push({ locale, slug: post.slug });
      }
    }
  }
  return params;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isValidLocale(locale)) return {};
  const post = getBlogPosts(locale).find((p) => p.slug === slug);
  if (!post) return {};
  const seo = getSeo(locale);
  const altLanguages = getAlternateLanguages(post.slug, seo.domain, 'blogPost');

  return {
    title: post.seo.metaTitle,
    description: post.seo.metaDescription,
    alternates: {
      canonical: `/${locale}/blog/${post.slug}`,
      ...(Object.keys(altLanguages).length > 0 ? {
        languages: { ...altLanguages, 'x-default': getXDefaultHref(post.slug, seo.domain, 'blogPost') },
      } : {}),
    },
    openGraph: {
      title: post.seo.metaTitle,
      description: post.seo.metaDescription,
      url: `/${locale}/blog/${post.slug}`,
      type: 'article',
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isValidLocale(locale)) notFound();
  const post = getBlogPosts(locale).find((p) => p.slug === slug);
  if (!post) redirect(`/${locale}/blog`);

  const seo = getSeo(locale);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: `${seo.domain}/${locale}` },
          { name: 'Blog', url: `${seo.domain}/${locale}/blog` },
          { name: post.title, url: `${seo.domain}/${locale}/blog/${post.slug}` },
        ]}
      />
      <ArticleJsonLd locale={locale} post={post} />

      <article className="section-padding">
        <div className="container-width">
          <div className="mx-auto max-w-3xl">
            <Link
              href={`/${locale}/blog`}
              className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700"
            >
              &larr; Back to Blog
            </Link>

            <header className="mt-6">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                  {post.category}
                </span>
                <time className="text-sm text-gray-500" dateTime={post.publishedAt}>
                  {post.publishedAt}
                </time>
              </div>
              <h1 className="mt-4 text-3xl font-bold text-gray-900 sm:text-4xl">
                {post.title}
              </h1>
              <p className="mt-4 text-lg text-gray-600">{post.excerpt}</p>
              <div className="mt-4 text-sm text-gray-500">
                By {post.author}
              </div>
            </header>

            <div
              className="prose prose-lg prose-gray mt-10 max-w-none prose-headings:text-gray-900 prose-a:text-primary-600"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {post.tags.length > 0 && (
              <div className="mt-10 flex flex-wrap gap-2 border-t border-gray-200 pt-6">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </article>
    </>
  );
}
