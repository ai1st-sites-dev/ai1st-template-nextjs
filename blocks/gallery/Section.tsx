// ══════════════════════════════════════════════════════════════════════════════════════════════════
// gallery —— 块头（intro）+ 一组照片（items），点任一张打开大图（#1495，总纲 #1422 的 T2.12）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，两层旋钮**：intro*（introPosition / introAlign）· items*（itemsLayout / itemsColumns / itemShape /
//    itemCaption），四个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个
//    覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上
//    （`data-intro-position` … `data-item-caption` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//    grid + original = 瀑布流（CSS 多列）；mosaic 必须裁图，original 在 mosaic 里按 landscape —— 这两条都住在
//    `block.css` 的选择器里，markup 一个字不变。
//
// 🔴 **点照片 = 大图**，一律用 Bootstrap 自带的 Modal + Carousel（Chris 2026-09-30，不手写）：每张照片包在
//    `<a href="#<id>-lb" data-bs-toggle="modal" data-gl-index="i">` 里（没有 JS 时链接落回页面，不坏）；Modal 与
//    Carousel 的 markup 在这里服务端渲染，JS 由 `Lightbox.tsx` 按需加载（`src/components/BootstrapJs.tsx`），
//    「从点的那一张开始」的那几行胶水也在那里。Modal 里的大图 `loading="lazy"`：弹窗没打开前它是 display:none，
//    浏览器不去取。
//
// 🔴 **藏东西一律是不渲染**：某张照片没有 `title` / `caption` ⟹ 那一张没有图注节点；块头 `headline` / `body` 都空 ⟹
//    块头那一列整个不渲染。没有 `image.imageUrl` 的项不画（validateSite 拦着，这里只是不让一个空 <img> 出去）。
//
// 🔴 **照片的键叫 `imageUrl`**（`items[].image.imageUrl`）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`）。`alt` 空时用 `title`。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），纯色、brand、渐变都认。
import { slotImg } from '@/lib/sections/blockMedia';
import { emptyListHidesBlock, sourcedOf } from '@/lib/sections/emptyList';

import BlockSection from '@/components/BlockSection';
import type { BlockConfig } from '@/lib/types/config';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import manifest from './manifest.json';
import GalleryLightbox from './Lightbox';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { type BgValue } from '../../scripts/lib/contrast.js';

export interface GalleryImage { imageUrl?: string; alt?: string }
export interface GalleryItem { image?: GalleryImage; title?: string; caption?: string }
export interface GalleryOptions {
  introPosition?: string; introAlign?: string;
  itemsLayout?: string; itemsColumns?: string; itemShape?: string; itemCaption?: string;
}
export interface GalleryData {
  options?: GalleryOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  items?: GalleryItem[];
  bg?: BgValue;
}

interface Props {
  data: GalleryData;
  locale?: string;
  block?: BlockConfig;
}

// items 2–24 张（`slots.items.maxItems`，validateSite 拦超出的）。
const MAX_ITEMS = manifest.slots.items.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 块 id → 可以放进 `id` / `#…` 选择器的一段（同一页两块 gallery 各有各的弹窗）。 */
const safeId = (v: unknown) => (typeof v === 'string' && v ? v : 'gallery').replace(/[^A-Za-z0-9_-]/g, '-');

export default function GalleryNewSection({ data, block }: Props) {
  const d: GalleryData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: GalleryOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof GalleryOptions]: string }>;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 features / milestones：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const hasIntro = !!(str(d.headline) || str(d.body));
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter((it): it is GalleryItem => isObj(it) && isObj(it.image) && !!str(it.image.imageUrl))
    .slice(0, MAX_ITEMS);
  // 写了条目却一条都不合格 ⟹ 整块不画；手写 0 条照画块头（#1536，判据在 src/lib/sections/emptyList.ts）。
  if (emptyListHidesBlock(d.items, items.length, sourcedOf(d, 'items'))) return null;
  const id = safeId(block && block.id);
  const lbId = `${id}-lb`;
  const carId = `${id}-car`;
  const altOf = (it: GalleryItem) => str(it.image && it.image.alt) || str(it.title);

  return (
    <BlockSection
      type="gallery"
      block={block}
      attrs={{
        'data-intro-position': k.introPosition,
        'data-intro-align': k.introAlign,
        'data-items-layout': k.itemsLayout,
        'data-items-columns': k.itemsColumns,
        'data-item-shape': k.itemShape,
        'data-item-caption': k.itemCaption,
      }}
      bg={d.bg}
      after={items.length ? (
        <div className="modal fade gl-modal" id={lbId} tabIndex={-1} aria-label="Photo viewer" aria-hidden="true" data-part="lightbox">
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content">
              <button type="button" className="btn-close btn-close-white gl-lb-close" data-bs-dismiss="modal" aria-label="Close" />
              <div id={carId} className="carousel slide" tabIndex={-1} data-bs-ride="false" data-bs-interval="false" data-bs-touch="true" data-bs-keyboard="true">
                <div className="carousel-inner">
                  {items.map((it, i) => (
                    <div key={i} className={`carousel-item${i === 0 ? ' active' : ''}`}>
                      {slotImg(it.image!, { between: { className: 'd-block mx-auto' }, alt: altOf(it), after: { loading: 'lazy' } })}
                      {it.title || it.caption ? (
                        <div className="gl-lb-cap">{it.title}{it.caption ? <span>{it.caption}</span> : null}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button className="carousel-control-prev" type="button" data-bs-target={`#${carId}`} data-bs-slide="prev">
                  <span className="carousel-control-prev-icon" aria-hidden="true" />
                  <span className="visually-hidden">Previous</span>
                </button>
                <button className="carousel-control-next" type="button" data-bs-target={`#${carId}`} data-bs-slide="next">
                  <span className="carousel-control-next-icon" aria-hidden="true" />
                  <span className="visually-hidden">Next</span>
                </button>
                <div className="carousel-indicators">
                  {items.map((_, i) => (
                    <button key={i} type="button" data-bs-target={`#${carId}`} data-bs-slide-to={i}
                      className={i === 0 ? 'active' : undefined} aria-current={i === 0 ? 'true' : undefined} aria-label={`Photo ${i + 1}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <GalleryLightbox modalId={lbId} />
        </div>
      ) : null}
    >
      <div className="row gl-frame gy-10 gx-lg-16">
        {hasIntro ? (
          <div className="col-12 gl-introcol" data-part="intro">
            <div className="gl-intro-text" data-part="intro-text">
              {eyebrow && eyebrowStyle !== 'none' ? (
                <div className="mb-4" data-part="eyebrow">
                  <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
                </div>
              ) : null}
              {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 gl-title" data-slot="headline">{d.headline}</h2> : null}
              {d.body ? <p className="fs-5 text-muted mb-0" data-slot="body">{d.body}</p> : null}
            </div>
          </div>
        ) : null}
        <div className="col-12 gl-itemscol" data-part="items">
          <div className="gl-grid">
            {items.map((it, i) => (
              <figure key={i} className="gl-item" data-part="item">
                <a className="gl-img d-block" href={`#${lbId}`} data-bs-toggle="modal" data-gl-index={i}
                  aria-label={`Open photo${it.title ? `: ${it.title}` : ` ${i + 1}`}`}>
                  {slotImg(it.image!, { alt: altOf(it), slot: `items.${i}.image` })}
                </a>
                {it.title || it.caption ? (
                  <figcaption className="gl-cap" data-part="caption">
                    {it.title ? <span className="fw-semibold" data-slot={`items.${i}.title`}>{it.title}</span> : null}
                    {it.caption ? <span className="gl-cap-s text-xs" data-slot={`items.${i}.caption`}>{it.caption}</span> : null}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </div>
      </div>
    </BlockSection>
  );
}
