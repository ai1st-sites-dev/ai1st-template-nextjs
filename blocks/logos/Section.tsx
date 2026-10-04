// ══════════════════════════════════════════════════════════════════════════════════════════════════
// logos —— 块头（intro，可带一个链接）+ 一组 logo 图（items），Webpixels / Bootstrap 那一套（#1496，总纲 #1422 的 T2.13）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，七个旋钮**：intro*（introPosition / introAlign / introSize）· items*（itemsLayout / itemsColumns）·
//    item* / logo*（itemStyle / logoColor），四个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-logo-color` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//    `itemsColumns` 只管 grid：row 时它照样写在根上，但没有一条规则认它（不起作用，不报错）。
//
// 🔴 **藏东西一律是不渲染**，不靠 CSS 藏：眉标、标题、正文、链接没有数据就没有节点；三样文字都空 ⟹ 块头那一列整个不渲染。
//    `introSize=sm` 只缩字号，正文照样画（Chris 2026-09-30）。没有 `imageUrl` 的那一项不画（没有纯文字兜底：没有 logo 图就不放这个块）。
//
// 🔴 **图片的键叫 `imageUrl`**（同 hero 的 `logos.items`）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`）。某项带 `href` ⟹ 那一格整个是新窗口打开的链接（`rel="noopener"`）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），纯色、brand、渐变都认；
//    这里不自己算亮度、不自己拼渐变。深底 + mono 的 logo 反白写在 `block.css`（按 `data-tone`）。

import Link from 'next/link';
import { slotImg } from '@/lib/sections/blockMedia';
import BlockSection from '@/components/BlockSection';
import SiteLink from '@/components/SiteLink';
import type { BlockConfig } from '@/lib/types/config';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface LogosNewButton { label?: string; href?: string; style?: BtnStyle }
export interface LogosNewItem { imageUrl?: string; alt?: string; href?: string }
export interface LogosNewOptions {
  introPosition?: string; introAlign?: string; introSize?: string;
  itemsLayout?: string; itemsColumns?: string;
  itemStyle?: string; logoColor?: string;
}
export interface LogosNewData {
  options?: LogosNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  introCta?: LogosNewButton;
  items?: LogosNewItem[];
  bg?: BgValue;
}

interface Props {
  data: LogosNewData;
  locale?: string;
  block?: BlockConfig;
}

// items 3–12 个（manifest `slots.items.minItems` / `maxItems`，validateSite 拦超出的）；多出来的在这里截掉。
const MAX_ITEMS = manifest.slots.items.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
// 块头链接没写 style ⟹ link（图册那一行是文字链接「See the brands we install →」）。
function ctaClass(style: BtnStyle): string {
  if (style === 'solid') return 'btn btn-primary btn-sm d-inline-flex align-items-center text-nowrap';
  if (style === 'outline') return 'btn btn-outline-primary btn-sm d-inline-flex align-items-center text-nowrap';
  return 'btn btn-link px-0 fw-semibold text-sm d-inline-flex align-items-center';
}

export default function LogosNewSection({ data, block }: Props) {
  const d: LogosNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: LogosNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof LogosNewOptions]: string }>;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero / cta / features / milestones：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const cta = isObj(d.introCta) && str(d.introCta.label) ? d.introCta : null;
  const ctaStyle: BtnStyle = cta && (cta.style === 'solid' || cta.style === 'outline') ? cta.style : 'link';
  const hasIntro = !!(str(d.headline) || str(d.body) || cta || (eyebrow && eyebrowStyle !== 'none'));
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter((it): it is LogosNewItem => isObj(it) && !!str(it.imageUrl))
    .slice(0, MAX_ITEMS);

  return (
    <BlockSection
      type="logos"
      block={block}
      attrs={{
        'data-intro-position': k.introPosition,
        'data-intro-align': k.introAlign,
        'data-intro-size': k.introSize,
        'data-items-layout': k.itemsLayout,
        'data-items-columns': k.itemsColumns,
        'data-item-style': k.itemStyle,
        'data-logo-color': k.logoColor,
      }}
      bg={d.bg}
      className="position-relative py-12 py-lg-16"
    >
      <div className="row lo-frame gy-8 gx-lg-16 align-items-center">
        {hasIntro ? (
          <div className="col-12 lo-introcol" data-part="intro">
            <div className="lo-intro-text" data-part="intro-text">
              {eyebrow && eyebrowStyle !== 'none' ? (
                <div className="lo-eyebrow-wrap mb-4" data-part="eyebrow">
                  <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
                </div>
              ) : null}
              {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 lo-title" data-slot="headline">{d.headline}</h2> : null}
              {d.body ? <p className="fs-5 text-muted mb-0 lo-body" data-slot="body">{d.body}</p> : null}
              {cta ? (
                <div className="lo-cta" data-part="cta">
                  <Link href={cta.href || '#'} className={ctaClass(ctaStyle)} data-cta={ctaStyle}>
                    <span data-slot="introCta.label">{cta.label}</span>
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="col-12 lo-itemscol" data-part="items">
          <div className="lo-grid">
            {items.map((it, i) => {
              const img = slotImg(it, { before: { className: 'lo-logo' }, after: { loading: 'lazy' } });
              return (
                <div key={i} data-part="item">
                  {str(it.href) ? (
                    <SiteLink className="lo-inner d-flex align-items-center justify-content-center" href={it.href} target="_blank" rel="noopener">{img}</SiteLink>
                  ) : (
                    <div className="lo-inner d-flex align-items-center justify-content-center">{img}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </BlockSection>
  );
}
