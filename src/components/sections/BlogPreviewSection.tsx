import Link from 'next/link';
import { getBlogPosts, localeUrl } from '@/lib/config';
import type { BlogPostConfig } from '@/lib/types/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

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
    fromBlog?: boolean;
    maxPosts?: number;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1029 — 一份中性 markup，别的什么都没有。阶段 2 批 D。
//
// 三支走了：`cards`（默认，三列卡片，每张顶上一块渐变色）、`list`（单列，缩略色块在左、文字在右、
// 条间分隔线）、`featured`（第一篇占一整块 256px 高的渐变图 + 白字压图，其余两列）。
// 三支读的都是 `data.headline`、可选的 `data.subheadline`，以及每篇的 `title` / `excerpt` /
// `category` / `date`，一个字段不多一个不少。
//
// 🔴 本块正文点名要量的那件事（#1029 第 6 条）：**三支画的篇数相同，`featured` 不少画。**
// `slice(0, data.maxPosts || 6)` 在三支【之上】、只算一次，三支拿到的是同一个 `displayPosts`；
// `featured` 把它拆成 `const [featured, ...rest]` 之后**两半都画**（1 + rest.length）。
// 交付里贴了同一份夹具上三支各画几条的实测读数 —— 三个数相同。所以这里没有「代价落在谁头上」
// 这一问，`maxPosts` 的取舍是搬迁之前就有的、跟本票无关。
//
// 🔴 每张卡顶上那块渐变色没了，主题表能补回来。它原来是一个按 `index % colors.length` 轮换的空
// `<div>`（`featured` 那支还多一层 `from-black/60` 的压暗层）—— 那是 markup 在决定长相。
// 主题用 `.blog-preview__post::before { content: "" }` + `background` 就能画一块，**但轮换那圈颜色
// 回不来**：`::before` 选不到「第几篇」（契约 §1 拒 `nth-child`）。同族的还有 `list` 那支的缩略色块。
//
// 🔴 一篇文章是【一个元素】，链接与非链接两种情形都是它。老代码在有 slug 时把卡片外面再包一层
// `<Link className="group">`，于是同一篇在两种情形下 DOM 层数不同，主题的 `>` 选择器会时灵时不灵。
// 现在两种情形都只有一层：有 slug 就是 `<a class="blog-preview__post">`，没有就是
// `<div class="blog-preview__post">`。主题选 `.blog-preview__post` 两种都选得到。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
// `fromBlog` / `maxPosts` 留着 —— 它们不是长相，是「这个块画哪些文章」。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('blog-preview', block)`（#998 的 `data-block-layout`）。
export default function BlogPreviewSection({ data, locale, block }: BlogPreviewSectionProps) {
  const blogPosts = getBlogPosts(locale);
  const fromBlog = data.fromBlog && blogPosts.length > 0;

  const displayPosts: BlogPost[] = fromBlog
    ? blogPosts.slice(0, data.maxPosts || 6).map((p: BlogPostConfig) => ({
        title: p.title,
        excerpt: p.excerpt,
        category: p.category,
        date: p.publishedAt,
      }))
    : data.posts;

  return (
    <section {...blockAttrs('blog-preview', block)} className="blog-preview" aria-labelledby="blog-heading">
      <h2 id="blog-heading" className="blog-preview__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="blog-preview__sub">{data.subheadline}</p>}
      {displayPosts?.map((post, index) => {
        const slug = fromBlog ? blogPosts[index]?.slug : undefined;
        const parts = (
          <>
            {post.category && <span className="blog-preview__category">{post.category}</span>}
            {post.date && <span className="blog-preview__date">{post.date}</span>}
            <span className="blog-preview__title">{post.title}</span>
            <span className="blog-preview__excerpt">{post.excerpt}</span>
          </>
        );
        return slug ? (
          <Link key={index} href={localeUrl(slug, locale, 'blogPost')} className="blog-preview__post">
            {parts}
          </Link>
        ) : (
          <div key={index} className="blog-preview__post">
            {parts}
          </div>
        );
      })}
    </section>
  );
}
