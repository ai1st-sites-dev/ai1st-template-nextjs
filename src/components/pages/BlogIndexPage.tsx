import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BreadcrumbJsonLd } from '@/components/JsonLd';
import { brand, getSeo, getBlogPosts, getBrandName, isValidLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';

const colors = [
  'from-primary-100 to-primary-200',
  'from-accent-100 to-accent-200',
  'from-primary-50 to-accent-100',
  'from-gray-100 to-gray-200',
  'from-accent-50 to-primary-100',
  'from-primary-200 to-primary-100',
];

export default function BlogIndexPage({ locale }: { locale: string }) {
  if (!isValidLocale(locale)) notFound();
  const seo = getSeo(locale);
  const blogPosts = getBlogPosts(locale);
  const labels = getLabels(locale);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: `${seo.domain}${localeUrl('home', locale)}` },
          { name: labels.blog, url: `${seo.domain}${localeUrl('', locale, 'blogIndex')}` },
        ]}
      />
      <section className="section-padding">
        <div className="container-width">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 sm:text-5xl">{labels.blog}</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-300">
              {labels.latestArticlesFrom} {getBrandName(locale)}
            </p>
          </div>

          {blogPosts.length === 0 ? (
            <p className="mt-12 text-center text-gray-500 dark:text-gray-400">{labels.noArticlesYet}</p>
          ) : (
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {/* #1472 —— 卡片白底写成 `bg-[#fff]` 而不是 `bg-white`：Bootstrap 也有一个 `.bg-white`，而且带 `!important`，
                  深色站上 `dark:bg-gray-800` 压不过它（白卡片 + 浅字 = 1.1:1）。同一个白色，浅色站逐像素不变。 */}
              {blogPosts.map((post, index) => (
                <Link
                  key={post.slug}
                  href={localeUrl(post.slug, locale, 'blogPost')}
                  className="group overflow-hidden rounded-xl bg-[#fff] dark:bg-gray-800 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className={`bg-gradient-to-br ${colors[index % colors.length]} h-48 transition-transform group-hover:scale-105`} />
                  <div className="p-6">
                    <div className="flex items-center gap-3">
                      {post.category && (
                        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                          {post.category}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-300">{post.publishedAt}</span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-300">
                      {post.title}
                    </h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                      {post.excerpt}
                    </p>
                    <div className="mt-4 text-sm font-medium text-primary-600 dark:text-primary-300">
                      {labels.readMore} &rarr;
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
