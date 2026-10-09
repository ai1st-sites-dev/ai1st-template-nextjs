import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArticleJsonLd } from '@/components/JsonLd';
import type { SiteData } from '@/lib/types/config';
import { getBlogPosts, isValidLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';

// #1426（T4）—— Tailwind 退场，按 Webpixels 的 `blog-content-1`（`docs/reference/webpixels/components.json`）重写。
// 正文是 AI 写的裸 HTML（下面的 dangerouslySetInnerHTML，一个 class 都没有）：原来靠 Tailwind 的 `prose`，现在交给
// Bootstrap reboot（标题阶梯、列表符号、段距本来就有，设计文档 §1.3 / B8）+ Webpixels 自带的 `.article`（那个组件
// 本身就这么写：行高、h2 间距、blockquote、code）。行宽 `mw-read` = 65ch。链接色接主题那一档（globals.css §博客两页）。
export default function BlogPostPage({ site, locale, slug }: { site: SiteData; locale: string; slug: string }) {
  if (!isValidLocale(site, locale)) notFound();
  const post = getBlogPosts(site, locale).find((p) => p.slug === slug);
  if (!post) redirect(localeUrl(site, '', locale, 'blogIndex'));

  const labels = getLabels(locale);

  return (
    <>
      <ArticleJsonLd site={site} locale={locale} post={post} />

      <article className="py-12 py-lg-16">
        <div className="container">
          <div className="mw-read mx-auto">
            <Link href={localeUrl(site, '', locale, 'blogIndex')} className="text-sm text-decoration-none blog-accent">
              &larr; {labels.backToBlog}
            </Link>

            <header className="mt-6">
              <div className="d-flex align-items-center gap-3">
                <span className="badge rounded-pill fw-medium blog-tag">{post.category}</span>
                <time className="text-sm text-body-secondary" dateTime={post.publishedAt}>
                  {post.publishedAt}
                </time>
              </div>
              <h1 className="display-5 lh-sm ls-tighter fw-bolder text-heading mt-4 mb-0">{post.title}</h1>
              <p className="text-lg text-body-secondary mt-4 mb-0">{post.excerpt}</p>
              <div className="text-sm text-body-secondary mt-4">By {post.author}</div>
            </header>

            <div className="article text-md mt-10 blog-body" dangerouslySetInnerHTML={{ __html: post.content }} />

            {post.tags.length > 0 && (
              <div className="d-flex flex-wrap gap-2 border-top mt-10 pt-6">
                {post.tags.map((tag) => (
                  <span key={tag} className="badge rounded-pill bg-body-secondary text-body-secondary fw-normal">
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
