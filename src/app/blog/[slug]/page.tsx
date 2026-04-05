import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArticleJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd';
import { brand, seo, blogPosts } from '@/lib/config';

export async function generateStaticParams() {
  if (blogPosts.length === 0) {
    // Next.js static export requires at least one param for dynamic routes.
    // Return a placeholder that redirects to /blog in the component.
    return [{ slug: '_' }];
  }
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) return {};

  return {
    title: post.seo.metaTitle,
    description: post.seo.metaDescription,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: post.seo.metaTitle,
      description: post.seo.metaDescription,
      url: `/blog/${post.slug}`,
      type: 'article',
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = blogPosts.find((p) => p.slug === slug);
  if (!post) redirect('/blog');

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: seo.domain },
          { name: 'Blog', url: `${seo.domain}/blog` },
          { name: post.title, url: `${seo.domain}/blog/${post.slug}` },
        ]}
      />
      <ArticleJsonLd post={post} />

      <article className="section-padding">
        <div className="container-width">
          <div className="mx-auto max-w-3xl">
            {/* Back link */}
            <Link
              href="/blog"
              className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700"
            >
              &larr; Back to Blog
            </Link>

            {/* Header */}
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

            {/* Content */}
            <div
              className="prose prose-lg prose-gray mt-10 max-w-none prose-headings:text-gray-900 prose-a:text-primary-600"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {/* Tags */}
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
