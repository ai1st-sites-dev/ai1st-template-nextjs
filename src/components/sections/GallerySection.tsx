import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface GalleryItem {
  title: string;
  description?: string;
  category?: string;
  imageUrl?: string;
}

interface GallerySectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: GalleryItem[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1036 — 一份中性 markup，别的什么都没有。阶段 2 批 G 里线上最少见的一块（1 个实例 / 1 个站）。
//
// 四支走了：`grid`（三列卡片，默认）、`masonry`（瀑布流，线上那 1 个实例用的就是它）、
// `overlay`（图上压字）、`carousel`（横向滚动 + 两个箭头按钮）。四支读的字段完全相同
// （`headline` · 可选 `subheadline` · `items[].title / .description / .category / .imageUrl`），
// 差别是 Tailwind 类 —— 除了 carousel 那两个按钮。
//
// 🔴 `carousel` 那两个箭头按钮删掉了（连同 `useRef` 和 `scrollBy`）。这一块的四条内容今天本来就全在
// DOM 里，所以这里**不涉及内容得失** —— 丢的只是两个按钮，而原生的横向滚动和触摸滑动接手同一件事。
// 主题自己画得出那条能滑的横条：实测契约放行 `display:flex` · `overflow:auto` · `gap` · `flex-shrink` ·
// `min-width`，五个属性合起来就是它。所以「轮播」搬完之后是主题的一种长相，不是站要选的形态。
// 📌 不加 `scroll-snap-*`（契约本来就拒它，PM 2026-08-16 也裁定不在结构层无条件加）：线上横向滚动的
//    实例今天是 0 个。旧 carousel 那一支自己带着 `snap-x snap-mandatory`，随那一支一起走。
//
// 🔴 没有图时那块占位的**渐变配色轮换**没了，主题表补不回来，写在明处。旧代码按 `index % 6` 从一张
// 六色表里挑一个（`masonry` 还额外按 `index % 6` 轮换六个高度）—— 契约拒绝 `:nth-child()` 这类结构
// 伪类，所以主题选不到「第 3 张」。占位现在是一个 `.gallery__placeholder`，主题给它**一种**长相。
// 同理 `masonry` 那六个轮换高度：主题用 `aspect-ratio` 或 `min-height` 给一个统一值。
//
// 🔴 `overlay` / `masonry` 那两层压在图上的黑色渐变 `<div>` 也没了 —— 空的覆盖 div 不留，主题用
// `.gallery__item::before` 画同一层（同 #1018 cta-banner 删掉 `dark` 那层覆盖 div 的理由）。
//
// 🔴 `<img>` 保留成 `.gallery__image`，因为它是**数据**（`item.imageUrl`），不是长相。有图就画图、
// 没图画占位，这个二选一是内容结构，留在 markup 里。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// —— 同 hero / cta-banner 那个有意的状态（#1008 AC5 / #1018）。`'use client'` 和 `useRef` 一起没了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('gallery', block)`（#998 的 `data-block-layout`；
// `tsc` 看不见它，#1008 r1 因此被打回）。
export default function GallerySection({ data, block }: GallerySectionProps) {
  return (
    <section {...blockAttrs('gallery', block)} className="gallery" aria-labelledby="gallery-heading">
      <h2 id="gallery-heading" className="gallery__headline">
        {data.headline}
      </h2>
      {data.subheadline && (
        <p className="gallery__sub">{data.subheadline}</p>
      )}
      {data.items?.map((item, index) => (
        <figure key={index} className="gallery__item">
          {item.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- output: 'export' 没有图片优化服务，
               全站都用裸 <img>（旧代码这四支也是）。本票不改这件事。 */
            <img src={item.imageUrl} alt={item.title} className="gallery__image" />
          ) : (
            <span className="gallery__placeholder" aria-hidden="true" />
          )}
          <figcaption className="gallery__caption">
            {item.category && <span className="gallery__category">{item.category}</span>}
            <span className="gallery__title">{item.title}</span>
            {item.description && <span className="gallery__desc">{item.description}</span>}
          </figcaption>
        </figure>
      ))}
    </section>
  );
}
