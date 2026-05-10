import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArticleJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import { getSeo, getBlogPosts, isValidLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';

export default function BlogPostPage({ locale, slug }: { locale: string; slug: string }) {
  if (!isValidLocale(locale)) notFound();
  const post = getBlogPosts(locale).find((p) => p.slug === slug);
  if (!post) redirect(localeUrl('', locale, 'blogIndex'));

  const seo = getSeo(locale);
  const labels = getLabels(locale);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: `${seo.domain}${localeUrl('home', locale)}` },
          { name: labels.blog, url: `${seo.domain}${localeUrl('', locale, 'blogIndex')}` },
          { name: post.title, url: `${seo.domain}${localeUrl(post.slug, locale, 'blogPost')}` },
        ]}
      />
      <ArticleJsonLd locale={locale} post={post} />

      <article className="section-padding">
        <div className="container-width">
          <div className="mx-auto max-w-3xl">
            <Link
              href={localeUrl('', locale, 'blogIndex')}
              className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700"
            >
              &larr; {labels.backToBlog}
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
