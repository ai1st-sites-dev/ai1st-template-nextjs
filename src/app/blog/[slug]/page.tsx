// TICKET-129b: default-locale blog post. Uses shared BlogPostPage component
// since app/[locale]/* is deleted.
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import BlogPostPage from '@/components/pages/BlogPostPage';
import { blogPostMetadata } from '@/lib/metadata';
import { defaultLocale, getBlogPosts } from '@/lib/config';

export async function generateStaticParams() {
  const posts = getBlogPosts(defaultLocale);
  if (posts.length === 0) return [{ slug: '_' }];
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return blogPostMetadata(defaultLocale, slug);
}

export default async function RootBlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <SiteShell locale={defaultLocale}>
      <BlogPostPage locale={defaultLocale} slug={slug} />
    </SiteShell>
  );
}
