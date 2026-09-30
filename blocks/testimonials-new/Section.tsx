// ══════════════════════════════════════════════════════════════════════════════════════════════════
// testimonials-new —— 块头（intro，可带总评分 summary）+ 一组评价（items），摊开或轮播（#1488，总纲 #1422 的 T2.10）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，七个旋钮**：intro*（introPosition / introAlign）· items*（itemsLayout / itemsColumns）·
//    item*（itemStyle / quoteSize / itemAlign），四个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-item-align` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **轮播也是服务端渲染**：六条评价全在 HTML 里（每条 `<figure>` + `<blockquote>` + `<figcaption>`），轮播只是
//    `block.css` 把它们横着排、`overflow-x: auto` + scroll-snap 一次露几条 —— 搜索和 AI 读得到每一条，没有一条是
//    `display: none`。圆点和前后按钮是唯一的客户端部分（`Pager.tsx`），只在 `itemsLayout=carousel` 时渲染；不自动播放。
//
// 🔴 **藏东西一律是不渲染**：`summary` 没写总评分 ⟹ 没有那一行；某条没 `photo` ⟹ 画名字首字母圆、没有 `<img>`；
//    某条没 `rating` ⟹ 没有星级节点（来源照常）；块头只看 `headline` / `body`，两个都空 ⟹ 块头那一列整个不渲染。
//
// 🔴 **每条的顺序（Chris 2026-09-29）**：引言 → 人（头像 + 名字 + 身份）→ 星级 + 来源在最底下（card 等高时贴卡底）。
//
// 🔴 **图片的键叫 `imageUrl`**（`items[].photo`）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键（`scripts/lib/image-urls.js`）。
//
// 🔴 **图标是内联 SVG**：星（`star-fill` / `star-half` / `star`）和前后箭头（`chevron-left` / `chevron-right`）是本组件写死的
//    名字，登记在 `scripts/lib/icons.js` 的 `BLOCK_ICONS['testimonials-new']`；`iconTable` 由服务端查好传进来，这里用
//    `InlineIcon` 画。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），这里不自己算亮度、不自己拼渐变。

import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import manifest from './manifest.json';
import Pager from './Pager';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

export interface TestimonialsNewImage { imageUrl?: string; alt?: string }
export interface TestimonialsNewItem {
  quote?: string;
  name?: string;
  role?: string;
  photo?: TestimonialsNewImage;
  rating?: number;
  source?: string;
}
export interface TestimonialsNewSummary { rating?: number | string; count?: number | string; source?: string }
export interface TestimonialsNewOptions {
  introPosition?: string; introAlign?: string;
  itemsLayout?: string; itemsColumns?: string;
  itemStyle?: string; quoteSize?: string; itemAlign?: string;
}
export interface TestimonialsNewData {
  options?: TestimonialsNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  summary?: TestimonialsNewSummary;
  items?: TestimonialsNewItem[];
  bg?: BgValue;
}

interface Props {
  data: TestimonialsNewData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// 评价 1–12 条（manifest `slots.items.maxItems`，validateSite 拦超出的）。
const MAX_ITEMS = manifest.slots.items.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const imgOf = (v: unknown): TestimonialsNewImage | null => (isObj(v) && str((v as TestimonialsNewImage).imageUrl) ? (v as TestimonialsNewImage) : null);
// 每条的星级：1–5 的整数才画（validateSite 拦别的值）；总评分可以是小数（4.9），按 0.5 取整画实心 / 半 / 空心。
const itemRating = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : 0);
const summaryRating = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : 0;
};
const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'tn-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'tn-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'tn-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'tn-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

export default function TestimonialsNewSection({ data, block, iconTable = {} }: Props) {
  const d: TestimonialsNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: TestimonialsNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof TestimonialsNewOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);
  const carousel = k.itemsLayout === 'carousel';

  const icon = (name: string) => <InlineIcon name={name} icons={iconTable} />;
  // 星级：n 颗 = 实心 floor(n)、有 .5 再一颗半星、剩下空心，一共 5 颗。
  const stars = (n: number, slot?: string) => {
    const half = Math.round(n * 2) / 2;
    const full = Math.floor(half);
    const kinds = [...Array(full).fill('fill'), ...(half > full ? ['half'] : []), ...Array(5 - Math.ceil(half)).fill('empty')];
    return (
      <span className="tn-stars d-inline-flex gap-1 text-warning" data-part="stars" data-rating={half} aria-label={`${half} out of 5 stars`} role="img" {...(slot ? { 'data-for': slot } : {})}>
        {kinds.map((s, i) => (
          <span key={i} className="tn-star d-inline-flex" data-star={s} aria-hidden="true">
            {icon(s === 'fill' ? 'star-fill' : s === 'half' ? 'star-half' : 'star')}
          </span>
        ))}
      </span>
    );
  };

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero-new / features-new：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : eyebrow.style in EYEBROW_CLASS ? eyebrow.style : 'none';
  const summary = isObj(d.summary) && summaryRating(d.summary.rating) ? d.summary : null;
  const hasIntro = !!(str(d.headline) || str(d.body));
  const items = (Array.isArray(d.items) ? d.items : []).filter((it): it is TestimonialsNewItem => isObj(it) && !!str(it.quote)).slice(0, MAX_ITEMS);

  return (
    <section
      {...blockAttrs('testimonials-new', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-items-layout={k.itemsLayout}
      data-items-columns={k.itemsColumns}
      data-item-style={k.itemStyle}
      data-quote-size={k.quoteSize}
      data-item-align={k.itemAlign}
      data-tone={tone}
      className="position-relative py-16 py-lg-24"
      style={bgValue ? { background: bgValue } : undefined}
    >
      <div className="container">
        <div className="row tn-frame gy-10 gx-lg-16">
          {hasIntro ? (
            <div className="col-12 tn-introcol" data-part="intro">
              <div className="tn-intro-text" data-part="intro-text">
                {eyebrow && eyebrowStyle !== 'none' ? (
                  <div className="mb-4" data-part="eyebrow">
                    <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="introEyebrow.text">
                      {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                    </span>
                  </div>
                ) : null}
                {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 tn-title" data-slot="headline">{d.headline}</h2> : null}
                {d.body ? <p className="fs-5 text-muted mb-0 tn-body" data-slot="body">{d.body}</p> : null}
                {summary ? (
                  <div className="tn-summary d-inline-flex align-items-center gap-3 mt-6 px-4 py-3 rounded-4" data-part="summary">
                    <span className="fs-3 fw-bold lh-1 tn-summary-rating" data-slot="summary.rating">{str(summary.rating)}</span>
                    <span className="d-flex flex-column gap-1">
                      {stars(summaryRating(summary.rating), 'summary')}
                      {str(summary.count) || str(summary.source) ? (
                        <span className="text-xs text-muted tn-summary-count">
                          {str(summary.count) ? <span data-slot="summary.count">{str(summary.count)}</span> : null}
                          {str(summary.count) && str(summary.source) ? ' ' : null}
                          {str(summary.source) ? <span data-slot="summary.source">{summary.source}</span> : null}
                          {' reviews'}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="col-12 tn-itemscol" data-part="items">
            <div
              className="tn-grid"
              data-part="track"
              {...(carousel ? { tabIndex: 0, 'aria-label': 'Customer reviews' } : {})}
            >
              {items.map((it, i) => {
                const photo = imgOf(it.photo);
                const name = str(it.name);
                const rating = itemRating(it.rating);
                const source = str(it.source);
                return (
                  <div key={i} className="tn-item" data-part="item">
                    <figure className="tn-inner h-100 d-flex flex-column m-0">
                      <blockquote className="tn-quote m-0"><span data-slot={`items.${i}.quote`}>{it.quote}</span></blockquote>
                      <figcaption className="tn-author d-flex align-items-center gap-3">
                        {photo ? (
                          <img className="tn-avatar" data-part="photo" src={photo.imageUrl} alt={photo.alt || ''} />
                        ) : name ? (
                          <span className="tn-avatar tn-initials d-inline-flex align-items-center justify-content-center fw-semibold bg-primary-subtle text-primary" data-part="initials" aria-hidden="true">
                            {initialsOf(name)}
                          </span>
                        ) : null}
                        <span className="d-block min-w-0">
                          {name ? <span className="d-block fw-semibold text-sm tn-name" data-slot={`items.${i}.name`}>{name}</span> : null}
                          {it.role ? <span className="d-block text-xs text-muted tn-role" data-slot={`items.${i}.role`}>{it.role}</span> : null}
                        </span>
                      </figcaption>
                      {rating || source ? (
                        <div className="tn-meta d-flex align-items-center gap-3" data-part="meta">
                          {rating ? stars(rating) : null}
                          {source ? <span className="tn-source text-xs text-muted" data-slot={`items.${i}.source`}>{source}</span> : null}
                        </div>
                      ) : null}
                    </figure>
                  </div>
                );
              })}
            </div>
            {carousel && items.length ? <Pager count={items.length} prevIcon={icon('chevron-left')} nextIcon={icon('chevron-right')} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
