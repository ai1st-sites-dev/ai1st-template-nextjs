// ══════════════════════════════════════════════════════════════════════════════════════════════════
// testimonials —— 块头（intro，可带一组平台评分 summary）+ 一组评价（items），摊开或轮播（#1488，总纲 #1422 的 T2.10；
//                     summary 改成一组平台 + summaryStyle 是 #1500 / T2.10B）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，八个旋钮**：intro*（introPosition / introAlign）· summaryStyle（#1500）· items*（itemsLayout / itemsColumns）·
//    item*（itemStyle / quoteSize / itemAlign），五个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-item-align` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **轮播是 Bootstrap Carousel，也是服务端渲染**（#1494，Chris 2026-09-30：轮播 / 弹窗一律用 Bootstrap 自带的，不手写）：
//    服务端按 `itemsColumns` 把评价分组，一组一张 `.carousel-item`（里面一个 `.tn-slide` 网格）；每张 slide、每条评价
//    （`<figure>` + `<blockquote>` + `<figcaption>`）、圆点（`.carousel-indicators`，每张 slide 一个）、前 / 后按钮全在 HTML 里，
//    搜索和 AI 读得到每一条。唯一的客户端部分是外壳 `Carousel.tsx`：挂载后按需引 Carousel 模块。不自动播放。
//    以前那条手写轨道（横向滚动 + 自己算位置的圆点）已删。
//
// 🔴 **summary 是一组平台（#1500）**，每个 `{source, rating, count, href?, logoUrl?}`，两处摆法按 `summaryStyle` 只出一处：
//    `inline` = 块头正文下面一排小条；`cards` = 评价那一列最上面一排平台卡（Webpixels reviews-1）。
//    logo 取哪一档（上传的 `logoUrl` → 内置品牌图标 → 平台名）不在这里写：`scripts/lib/review-platforms.js` §platformLogo，
//    reviews 用的是同一份。
//    🔴 字段叫 `logoUrl` 而不是 `imageUrl` 是**承重的**：`block-manifest.js` §imageSlotsOf 只把 shape 里有 `imageUrl` 的
//    list 槽当内容图槽，所以建站不会给平台编一张 logo；改名成 `imageUrl` 的那一刻建站就开始造假 logo
//    （`testimonials-render.test.js` 有一格两向守它）。
//    旧形状（#1488 的单个对象）由 validateSite 读入时包成一项数组（`block-manifest.js` §validateSite），这里不认对象。
//
// 🔴 **藏东西一律是不渲染**：`summary` 一个有效平台都没有 ⟹ 两处都没有；某条没 `photo` ⟹ 画名字首字母圆、没有 `<img>`；
//    某条没 `rating` ⟹ 没有星级节点（来源照常）；块头只看 `headline` / `body`，两个都空 ⟹ 块头那一列整个不渲染。
//
// 🔴 **每条的顺序（Chris 2026-09-29）**：引言 → 人（头像 + 名字 + 身份）→ 星级 + 来源在最底下（card 等高时贴卡底）。
//
// 🔴 **图片的键叫 `imageUrl`**（`items[].photo`）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键（`scripts/lib/image-urls.js`）。
//
// 🔴 **图标是内联 SVG**：星（`star-fill` / `star`）、前后箭头（`chevron-left` / `chevron-right`）和平台品牌图标（#1500，名字住在
//    `review-platforms.js` 那张表里）登记在 `scripts/lib/icons.js` 的 `BLOCK_ICONS['testimonials']`；`iconTable` 由服务端查好传进来，这里用
//    `InlineIcon` 画。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），这里不自己算亮度、不自己拼渐变。

import type { ReactNode } from 'react';
import { slotImg, ratingStars } from '@/lib/sections/blockMedia';
import { emptyListHidesBlock, sourcedOf } from '@/lib/sections/emptyList';
import BlockSection from '@/components/BlockSection';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import manifest from './manifest.json';
import TestimonialsCarousel from './Carousel';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { type BgValue } from '../../scripts/lib/contrast.js';
import { platformLogo } from '../../scripts/lib/review-platforms.js';

export interface TestimonialsNewImage { imageUrl?: string; alt?: string }
export interface TestimonialsNewItem {
  quote?: string;
  name?: string;
  role?: string;
  photo?: TestimonialsNewImage;
  rating?: number;
  source?: string;
}
export interface TestimonialsNewPlatform { source?: string; rating?: number | string; count?: number | string; href?: string; logoUrl?: string }
export interface TestimonialsNewOptions {
  introPosition?: string; introAlign?: string; summaryStyle?: string;
  itemsLayout?: string; itemsColumns?: string;
  itemStyle?: string; quoteSize?: string; itemAlign?: string;
}
export interface TestimonialsNewData {
  options?: TestimonialsNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  summary?: TestimonialsNewPlatform[];
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

// 评价 1–12 条、平台 1–4 个（manifest 的 `maxItems`，validateSite 拦超出的）。
const MAX_ITEMS = manifest.slots.items.maxItems;
const MAX_PLATFORMS = manifest.slots.summary.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const imgOf = (v: unknown): TestimonialsNewImage | null => (isObj(v) && str((v as TestimonialsNewImage).imageUrl) ? (v as TestimonialsNewImage) : null);
// 每条的星级：1–5 的整数才画（validateSite 拦别的值）。
const itemRating = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : 0);
// 平台的数：编辑器（Puck）里改过的是字符串，照样认。
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);

interface Platform { index: number; source: string; rating: number; count: number; href: string; logoUrl: string }
// 一个平台要有名字、0–5 的评分、正的条数才画；缺哪样都整项不画（不画一个「0 reviews」的空条）。
function platformOf(v: unknown, index: number): Platform | null {
  if (!isObj(v)) return null;
  const p = v as TestimonialsNewPlatform;
  const rating = num(p.rating);
  const count = num(p.count);
  if (!str(p.source).trim() || !Number.isFinite(rating) || rating < 0 || rating > 5 || !Number.isFinite(count) || count <= 0) return null;
  return { index, source: str(p.source).trim(), rating, count: Math.round(count), href: str(p.href).trim(), logoUrl: str(p.logoUrl).trim() };
}
const fmt = (n: number): string => n.toFixed(1);
const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function TestimonialsNewSection({ data, block, iconTable = {} }: Props) {
  const d: TestimonialsNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: TestimonialsNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof TestimonialsNewOptions]: string }>;
  const carousel = k.itemsLayout === 'carousel';

  const icon = (name: string) => <InlineIcon name={name} icons={iconTable} />;
  // 星级：n 颗实心、剩下空心，一共 5 颗。平台评分是小数（4.9），先四舍五入成整数颗（#1500：4.5 → 5、4.4 → 4，不画半颗）。
  const stars = (n: number, slot?: string) => ratingStars(n, iconTable, {
    root: (full, label) => ({ className: 'tn-stars d-inline-flex gap-1 text-warning', 'data-part': 'stars', 'data-rating': full, 'aria-label': label, role: 'img', ...(slot ? { 'data-for': slot } : {}) }),
    fillEmpty: true,
    wrap: (s) => ({ className: 'tn-star d-inline-flex', 'data-star': s, 'aria-hidden': 'true' }),
  });
  // 平台 logo 三档（`review-platforms.js` §platformLogo）。`data-slot` 挂在写平台名的那个节点上（编辑器据它原地改字）：
  // 图 / 图标两档是 visually-hidden 那一段，名字那一档是名字本身 —— 每一档 DOM 里都有文字平台名（读屏 / 搜索 / AI）。
  const logo = (p: Platform) => {
    const l = platformLogo(p.source, p.logoUrl);
    const slot = `summary.${p.index}.source`;
    const hidden = <span className="visually-hidden" data-slot={slot}>{p.source}</span>;
    if (l.kind === 'image') {
      return (
        <span className="tn-logo tn-logo-img d-inline-flex align-items-center" data-part="logo" data-logo="image">
          <img src={l.logoUrl} alt={p.source} loading="lazy" />
          {hidden}
        </span>
      );
    }
    if (l.kind === 'icon') {
      return (
        <span className="tn-logo tn-logo-icon d-inline-flex align-items-center" data-part="logo" data-logo="icon" style={{ ['--tn-brand' as string]: l.color }}>
          {icon(l.icon)}
          {hidden}
        </span>
      );
    }
    return <span className="tn-logo tn-logo-name fw-bold" data-part="logo" data-logo="name" data-slot={slot}>{p.source}</span>;
  };
  // 一个平台：有 `href` ⟹ 整个小条 / 整张卡是链接（新窗口），没有就是 div。
  const platformBox = (p: Platform, cls: string, inner: ReactNode) => (p.href ? (
    <a key={p.index} className={`${cls} text-reset text-decoration-none`} data-part="platform" data-source={p.source} href={p.href} target="_blank" rel="noopener">{inner}</a>
  ) : (
    <div key={p.index} className={cls} data-part="platform" data-source={p.source}>{inner}</div>
  ));
  const countLine = (p: Platform, pre: string) => (
    <span className="tn-platform-count text-xs text-muted">{pre}<span data-slot={`summary.${p.index}.count`}>{p.count}</span> reviews</span>
  );

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero / features：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const platforms = (Array.isArray(d.summary) ? d.summary : []).map((v, i) => platformOf(v, i)).filter((p): p is Platform => !!p).slice(0, MAX_PLATFORMS);
  const summaryInline = platforms.length > 0 && k.summaryStyle === 'inline';
  const summaryCards = platforms.length > 0 && k.summaryStyle === 'cards';
  const hasIntro = !!(str(d.headline) || str(d.body));
  const items = (Array.isArray(d.items) ? d.items : []).filter((it): it is TestimonialsNewItem => isObj(it) && !!str(it.quote)).slice(0, MAX_ITEMS);
  // 写了条目却一条都不合格 ⟹ 整块不画；手写 0 条照画块头（#1536，判据在 src/lib/sections/emptyList.ts）。
  if (emptyListHidesBlock(d.items, items.length, sourcedOf(d, 'items'))) return null;
  // carousel：一张 slide 放 itemsColumns 条（服务端分好组；<768 时 block.css 让一张里的条目竖着叠）。
  const perSlide = Math.max(1, Number(k.itemsColumns) || 1);
  const slides = carousel ? Array.from({ length: Math.ceil(items.length / perSlide) }, (_, s) => items.slice(s * perSlide, (s + 1) * perSlide)) : [];
  const carId = `tn-carousel${block && typeof block.id === 'string' && block.id ? `-${block.id.replace(/[^A-Za-z0-9_-]/g, '')}` : ''}`;
  const renderItem = (it: TestimonialsNewItem, i: number) => {
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
              slotImg(photo, { before: { className: 'tn-avatar', 'data-part': 'photo' } })
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
  };

  return (
    <BlockSection
      type="testimonials"
      block={block}
      attrs={{
        'data-intro-position': k.introPosition,
        'data-intro-align': k.introAlign,
        'data-summary-style': k.summaryStyle,
        'data-items-layout': k.itemsLayout,
        'data-items-columns': k.itemsColumns,
        'data-item-style': k.itemStyle,
        'data-quote-size': k.quoteSize,
        'data-item-align': k.itemAlign,
      }}
      bg={d.bg}
    >
      <div className="row tn-frame gy-10 gx-lg-16">
        {hasIntro ? (
          <div className="col-12 tn-introcol" data-part="intro">
            <div className="tn-intro-text" data-part="intro-text">
              {eyebrow && eyebrowStyle !== 'none' ? (
                <div className="mb-4" data-part="eyebrow">
                  <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
                </div>
              ) : null}
              {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 tn-title" data-slot="headline">{d.headline}</h2> : null}
              {d.body ? <p className="fs-5 text-muted mb-0 tn-body" data-slot="body">{d.body}</p> : null}
              {summaryInline ? (
                <div className="tn-summary d-flex flex-wrap mt-6" data-part="summary">
                  {platforms.map((p) => platformBox(p, 'tn-platform tn-platform-inline d-inline-flex align-items-center gap-3 px-4 py-3 rounded-4', (
                    <>
                      {logo(p)}
                      <span className="fs-3 fw-bold lh-1 tn-platform-rating" data-slot={`summary.${p.index}.rating`}>{fmt(p.rating)}</span>
                      <span className="d-flex flex-column gap-1">
                        {stars(p.rating, 'summary')}
                        {countLine(p, '')}
                      </span>
                    </>
                  )))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="col-12 tn-itemscol" data-part="items">
          {summaryCards ? (
            <div className="tn-summary tn-summary-cards" data-part="summary">
              {platforms.map((p) => platformBox(p, 'tn-platform tn-platform-card rounded-4', (
                <>
                  <span className="tn-pc-logo">{logo(p)}</span>
                  <span className="tn-pc-stars">{stars(p.rating, 'summary')}</span>
                  <span className="tn-pc-score text-sm fw-semibold"><span data-slot={`summary.${p.index}.rating`}>{fmt(p.rating)}</span> out of 5</span>
                  <span className="tn-pc-count">{countLine(p, 'from ')}</span>
                </>
              )))}
            </div>
          ) : null}
          {carousel ? (
            slides.length ? (
              <TestimonialsCarousel id={carId} label="Customer reviews">
                <div className="carousel-inner">
                  {slides.map((g, si) => (
                    <div key={si} className={si === 0 ? 'carousel-item active' : 'carousel-item'} data-part="slide">
                      <div className="tn-slide">{g.map((it) => renderItem(it, items.indexOf(it)))}</div>
                    </div>
                  ))}
                </div>
                <div className="tn-pager d-flex align-items-center justify-content-between gap-4 mt-8" data-part="pager">
                  <div className="carousel-indicators tn-dots">
                    {slides.map((_, si) => (
                      <button
                        key={si}
                        type="button"
                        data-bs-target={`#${carId}`}
                        data-bs-slide-to={si}
                        className={si === 0 ? 'active' : undefined}
                        aria-current={si === 0 ? 'true' : undefined}
                        aria-label={`Slide ${si + 1}`}
                      />
                    ))}
                  </div>
                  <div className="tn-arrows d-flex gap-2">
                    <button type="button" className="tn-arrow" data-bs-target={`#${carId}`} data-bs-slide="prev" aria-label="Previous">{icon('chevron-left')}</button>
                    <button type="button" className="tn-arrow" data-bs-target={`#${carId}`} data-bs-slide="next" aria-label="Next">{icon('chevron-right')}</button>
                  </div>
                </div>
              </TestimonialsCarousel>
            ) : null
          ) : (
            <div className="tn-grid" data-part="track">
              {items.map((it, i) => renderItem(it, i))}
            </div>
          )}
        </div>
      </div>
    </BlockSection>
  );
}
