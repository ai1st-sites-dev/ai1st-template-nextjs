import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBlogPosts, getBrandName, isValidLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';

// #1426（T4）—— Tailwind 退场，按 Webpixels 的 `section-blog-1`（`docs/reference/webpixels/components.json`）重写：
// 块头 + 一行三列的卡片。颜色只走两条路：跟着深浅换的 Bootstrap 类（`text-heading` / `text-body-secondary` / `card`），
// 和主题那一层的 `--color-primary-*` / `--color-accent-*`（博客专用的几条规则在 globals.css §博客两页）。
// 封面没有图，是一块渐变：六种配色轮着用，每一种就是原来那两档 token（原来写成 Tailwind 的 `from-*-N to-*-N`）。
const COVERS: Array<[string, string]> = [
  ['var(--color-primary-100)', 'var(--color-primary-200)'],
  ['var(--color-accent-100)', 'var(--color-accent-200)'],
  ['var(--color-primary-50)', 'var(--color-accent-100)'],
  ['#f3f4f6', '#e5e7eb'],
  ['var(--color-accent-50)', 'var(--color-primary-100)'],
  ['var(--color-primary-200)', 'var(--color-primary-100)'],
];

export default function BlogIndexPage({ locale }: { locale: string }) {
  if (!isValidLocale(locale)) notFound();
  const blogPosts = getBlogPosts(locale);
  const labels = getLabels(locale);

  return (
    <>
      <section className="py-16 py-lg-24">
        <div className="container">
          <div className="text-center mb-12">
            <h1 className="display-5 ls-tight fw-bolder text-heading">{labels.blog}</h1>
            <p className="lead text-body-secondary mt-4 mb-0 mx-auto mw-read">
              {labels.latestArticlesFrom} {getBrandName(locale)}
            </p>
          </div>

          {blogPosts.length === 0 ? (
            <p className="text-center text-body-secondary">{labels.noArticlesYet}</p>
          ) : (
            <div className="row g-8">
              {blogPosts.map((post, index) => {
                const [from, to] = COVERS[index % COVERS.length];
                return (
                  <div key={post.slug} className="col-12 col-md-6 col-lg-4 d-flex">
                    <Link
                      href={localeUrl(post.slug, locale, 'blogPost')}
                      className="blog-card card w-100 border-0 shadow-sm overflow-hidden text-reset text-decoration-none"
                    >
                      <div className="blog-card-cover" style={{ background: `linear-gradient(to bottom right, ${from}, ${to})` }} />
                      <div className="card-body p-6">
                        <div className="d-flex align-items-center gap-3">
                          {post.category && <span className="badge rounded-pill fw-medium blog-tag">{post.category}</span>}
                          <span className="text-xs text-body-secondary">{post.publishedAt}</span>
                        </div>
                        <h2 className="h5 fw-semibold mt-3 mb-2 blog-card-title">{post.title}</h2>
                        <p className="text-sm text-body-secondary mb-0 blog-card-excerpt">{post.excerpt}</p>
                        <div className="text-sm fw-semibold mt-4 blog-accent">{labels.readMore} &rarr;</div>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
