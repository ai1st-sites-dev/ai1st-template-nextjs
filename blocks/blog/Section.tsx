// ══════════════════════════════════════════════════════════════════════════════════════════════════
// blog —— 块头（intro）+ 这个站最新几篇博客文章（posts），Webpixels / Bootstrap 那一套（#1497，总纲 #1422 的 T2.14）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **文章从站点博客读，块不存副本**：`getBlogPosts(locale)`（sync-config 聚合 `blog/*.json`，已按 publishedAt 倒序）
//    取前 `postCount` 篇。块数据里只有块头与 postCount —— 老板改一篇文章，所有用这个块的地方跟着变。
//    站里一篇文章都没有 ⟹ 整块不渲染（return null），不画一个空壳。
//
// 🔴 **一份 markup，六个旋钮**：introPosition / introAlign · itemsLayout / itemsColumns · itemStyle / itemImage，
//    五个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个覆盖
//    （`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上，
//    `block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **藏东西一律是不渲染**：没有摘要（excerpt 为空）⟹ 没有摘要节点；没有作者 ⟹ 没有作者行；没有封面 ⟹
//    一块主色 10% 底 + 分类名的占位（不是空白、不是坏图）。块头四样都空 ⟹ 块头那一列整个不渲染。
//
// 🔴 **图片的键**：封面 `coverImage.imageUrl`、头像 `authorAvatarUrl`，都在 `blog/{slug}.json` 里 ——
//    AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键（`scripts/lib/image-urls.js`）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg，同 milestones / cta）。

import Link from 'next/link';
import { getBlogPosts, localeUrl } from '@/lib/config';
import BlockSection from '@/components/BlockSection';
import type { BgValue } from '../../scripts/lib/contrast.js';
import type { BlockConfig, BlogPostConfig, SiteData } from '@/lib/types/config';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import Button from '@/components/Button';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface BlogNewButton { label?: string; href?: string; style?: BtnStyle }
export interface BlogNewOptions {
  introPosition?: string; introAlign?: string;
  itemsLayout?: string; itemsColumns?: string; itemStyle?: string; itemImage?: string;
}
export interface BlogNewData {
  options?: BlogNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  introCta?: BlogNewButton;
  postCount?: string | number;
  bg?: BgValue;
}

interface Props {
  data: BlogNewData;
  locale?: string;
  block?: BlockConfig;
  /** #1665 —— 这个站的内容（SectionRenderer 递下来）。 */
  site: SiteData;
}

// postCount 2–6、默认 3（manifest `slots.postCount.intRange`，validateSite 拦超出的；这里再夹一次，写歪的老数据也不炸）。
const [MIN_POSTS, MAX_POSTS] = manifest.slots.postCount.intRange as [number, number];
const DEFAULT_POSTS = 3;
/** 阅读时长：正文字数 ÷ 每分钟 220 词，向上取整，至少 1 分钟。 */
const WORDS_PER_MINUTE = 220;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function postCountOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? Math.min(MAX_POSTS, Math.max(MIN_POSTS, n)) : DEFAULT_POSTS;
}

export function readMinutes(html: unknown): number {
  const words = str(html).replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** `2026-09-18` → `Sep 18, 2026`（按 UTC 读，服务端与浏览器同一个字）。站的 locale 不是合法语言标签时用 en-US。 */
function formatDate(iso: string, locale: string | undefined): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' };
  try { return new Intl.DateTimeFormat(locale || 'en-US', opts).format(d); } catch { return new Intl.DateTimeFormat('en-US', opts).format(d); }
}

export default function BlogNewSection({ data, locale, block, site }: Props) {
  const d: BlogNewData = isObj(data) ? data : {};
  const loc = locale || 'en';
  const posts: BlogPostConfig[] = getBlogPosts(site, loc).slice(0, postCountOf(d.postCount));
  if (!posts.length) return null;

  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: BlogNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<BlogNewOptions>;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 milestones / features：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const showEyebrow = !!eyebrow && eyebrowStyle !== 'none';
  // #1553：按钮要 label 和 href 都有才渲染（内容有值才渲染）。原来 href 空时落回 '/blog'，站里没有 /blog 页就是一条死链，
  // 而发布前的死链检查现在会拦发布。
  const ctaHref = isObj(d.introCta) ? str(d.introCta.href) : '';
  const cta = isObj(d.introCta) && str(d.introCta.label) && ctaHref ? d.introCta : null;
  const hasIntro = showEyebrow || !!str(d.headline) || !!str(d.body) || !!cta;

  return (
    <BlockSection
      type="blog"
      block={block}
      attrs={{
        'data-intro-position': k.introPosition,
        'data-intro-align': k.introAlign,
        'data-items-layout': k.itemsLayout,
        'data-items-columns': k.itemsColumns,
        'data-item-style': k.itemStyle,
        'data-item-image': k.itemImage,
      }}
      bg={d.bg}
    >
      <div className="row bl-frame gy-10 gx-lg-16">
        {hasIntro ? (
          <div className="col-12 bl-introcol" data-part="intro">
            <div className="bl-intro-text" data-part="intro-text">
              {showEyebrow ? (
                <div className="mb-4" data-part="eyebrow">
                  <Eyebrow style={eyebrowStyle} text={eyebrow!.text} slot="introEyebrow.text" />
                </div>
              ) : null}
              {d.headline ? <h2 className="bl-title-h display-5 fw-bold lh-1 ls-tight mb-4" data-slot="headline">{d.headline}</h2> : null}
              {d.body ? <p className="fs-5 text-muted mb-0 bl-body" data-slot="body">{d.body}</p> : null}
              {cta ? (
                <div className="bl-cta-row" data-part="cta">
                  <Button href={ctaHref} style={cta.style} fallback="outline" defaultSize="sm" flush>
                    <span data-slot="introCta.label">{cta.label}</span>
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="col-12 bl-itemscol" data-part="posts">
          <div className="bl-grid">
            {posts.map((p, i) => {
              const href = localeUrl(site, p.slug, loc, 'blogPost');
              // featured 的大篇封面固定在上（正文 + AC4），旁边的小篇跟 itemImage 走 —— 这件事写在每篇文章自己身上，
              // block.css 的封面规则按它命中，而不是按根元素的旋钮（否则 background 那几条会把大篇也铺满）。
              const image = k.itemsLayout === 'featured' && i === 0 ? 'top' : k.itemImage;
              const cover = isObj(p.coverImage) && str(p.coverImage.imageUrl) ? p.coverImage : null;
              const excerpt = str(p.excerpt);
              const author = str(p.author);
              return (
                <article key={p.slug} className="bl-post" data-part="post" data-post={p.slug} data-image={image}>
                  <div className="bl-inner h-100">
                    {cover ? (
                      <Link className="bl-img" href={href} tabIndex={-1} aria-hidden="true" data-part="cover">
                        <img src={cover.imageUrl} alt={cover.alt || ''} />
                      </Link>
                    ) : (
                      <Link className="bl-img bl-ph" href={href} tabIndex={-1} aria-hidden="true" data-part="cover-placeholder">
                        <span className="bl-ph-label fw-semibold">{p.category || 'Blog'}</span>
                      </Link>
                    )}
                    <div className="bl-text">
                      <div className="bl-meta text-xs text-muted" data-part="meta">
                        {p.category ? <><span className="bl-cat text-primary fw-semibold">{p.category}</span> · </> : null}
                        <time dateTime={p.publishedAt}>{formatDate(p.publishedAt, loc)}</time>
                        {' · '}<span data-part="read-time">{readMinutes(p.content)} min read</span>
                      </div>
                      <h3 className="bl-title h5 fw-semibold mt-2 mb-2">
                        <Link className="text-reset text-decoration-none" href={href}>{p.title}</Link>
                      </h3>
                      {excerpt ? <p className="bl-ex text-sm text-muted mb-0" data-part="excerpt">{excerpt}</p> : null}
                      {author ? (
                        <div className="bl-author d-flex align-items-center gap-2 mt-4" data-part="author">
                          {str(p.authorAvatarUrl) ? <img src={p.authorAvatarUrl} alt="" /> : null}
                          <span className="text-sm fw-semibold">{author}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </BlockSection>
  );
}
