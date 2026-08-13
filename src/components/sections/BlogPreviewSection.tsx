import Link from 'next/link';
import { getBlogPosts, localeUrl } from '@/lib/config';
import type { BlogPostConfig } from '@/lib/types/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface BlogPost {
  title: string;
  excerpt: string;
  category?: string;
  date?: string;
}

interface BlogPreviewSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    posts: BlogPost[];
    variant?: 'cards' | 'list' | 'featured';
    fromBlog?: boolean;
    maxPosts?: number;
  };
  locale: string;
}

export default function BlogPreviewSection({ data, locale }: BlogPreviewSectionProps) {
  const variant = data.variant || 'cards';
  const blogPosts = getBlogPosts(locale);

  const displayPosts: BlogPost[] = data.fromBlog && blogPosts.length > 0
    ? blogPosts.slice(0, data.maxPosts || 6).map((p: BlogPostConfig) => ({
        title: p.title,
        excerpt: p.excerpt,
        category: p.category,
        date: p.publishedAt,
        slug: p.slug,
      }))
    : data.posts;

  const getSlug = (index: number): string | undefined => {
    if (data.fromBlog && blogPosts.length > 0) {
      return blogPosts[index]?.slug;
    }
    return undefined;
  };

  const colors = [
    'from-primary-100 to-primary-200',
    'from-accent-100 to-accent-200',
    'from-primary-50 to-accent-100',
    'from-gray-100 to-gray-200',
    'from-accent-50 to-primary-100',
    'from-primary-200 to-primary-100',
  ];

  function PostCard({ post, index, className }: { post: BlogPost; index: number; className?: string }) {
    const content = (
      <div className={className || "overflow-hidden rounded-xl bg-white shadow-sm transition-shadow hover:shadow-md"}>
        <div className={`bg-gradient-to-br ${colors[index % colors.length]} h-40`} />
        <div className="p-6">
          <div className="flex items-center gap-3">
            {post.category && (
              <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                {post.category}
              </span>
            )}
            {post.date && (
              <span className="text-xs text-gray-400">{post.date}</span>
            )}
          </div>
          <h3 className="mt-2 text-lg font-semibold text-gray-900">{post.title}</h3>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-600">{post.excerpt}</p>
        </div>
      </div>
    );

    const slug = getSlug(index);
    if (slug) {
      return <Link key={index} href={localeUrl(slug, locale, "blogPost")} className="group">{content}</Link>;
    }
    return <div key={index}>{content}</div>;
  }

  if (variant === 'list') {
    return (
      <section {...blockAttrs('blog-preview')} className="section-padding" aria-labelledby="blog-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="blog-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mx-auto mt-12 max-w-3xl">
            {displayPosts.map((post, index) => {
              const inner = (
                <div
                  className={`flex gap-5 py-6 ${index < displayPosts.length - 1 ? 'border-b border-gray-200' : ''}`}
                >
                  <div className={`h-20 w-20 shrink-0 rounded-lg bg-gradient-to-br ${colors[index % colors.length]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      {post.category && (
                        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                          {post.category}
                        </span>
                      )}
                      {post.date && (
                        <span className="text-xs text-gray-400">{post.date}</span>
                      )}
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-gray-900">{post.title}</h3>
                    <p className="mt-1 truncate text-sm leading-relaxed text-gray-600">{post.excerpt}</p>
                  </div>
                </div>
              );
              const slug = getSlug(index);
              return slug
                ? <Link key={index} href={localeUrl(slug, locale, "blogPost")}>{inner}</Link>
                : <div key={index}>{inner}</div>;
            })}
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'featured') {
    const [featured, ...rest] = displayPosts;
    return (
      <section {...blockAttrs('blog-preview')} className="section-padding" aria-labelledby="blog-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="blog-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
            {data.subheadline && (
              <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
            )}
          </div>
          <div className="mt-12">
            {/* Featured post */}
            {(() => {
              const featuredContent = (
                <div className={`relative h-64 overflow-hidden rounded-2xl bg-gradient-to-br ${colors[0]}`}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-0 p-8">
                    <div className="flex items-center gap-3">
                      {featured.category && (
                        <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white">
                          {featured.category}
                        </span>
                      )}
                      {featured.date && (
                        <span className="text-xs text-white/70">{featured.date}</span>
                      )}
                    </div>
                    <h3 className="mt-3 text-2xl font-bold text-white">{featured.title}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">{featured.excerpt}</p>
                  </div>
                </div>
              );
              const slug = getSlug(0);
              return slug
                ? <Link href={localeUrl(slug, locale, "blogPost")}>{featuredContent}</Link>
                : featuredContent;
            })()}
            {/* Remaining posts */}
            {rest.length > 0 && (
              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                {rest.map((post, index) => (
                  <PostCard key={index} post={post} index={index + 1} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('blog-preview')} className="section-padding" aria-labelledby="blog-heading">
      <div className="container-width">
        <div className="text-center">
          <h2 id="blog-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          {data.subheadline && (
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{data.subheadline}</p>
          )}
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {displayPosts.map((post, index) => (
            <PostCard key={index} post={post} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
