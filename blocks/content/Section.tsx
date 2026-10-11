// ══════════════════════════════════════════════════════════════════════════════════════════════════
// content —— 块头（eyebrow + 标题）+ 正文（富文本）+ 按钮，可带一张图（#1498，总纲 #1422 的 T2.15）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，五个旋钮**：headlinePosition / textAlign / textStyle / image / frame，四个预设各是一个形态目录。
//    实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js`
//    §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上（`data-headline-position` …
//    `data-frame` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **正文是 `richtext`**：`body` 是一段 markdown 子集，按 `scripts/lib/richtext.js` §parseRichtext 出的那棵树
//    用 React 画（字由 React 转义，不走 dangerouslySetInnerHTML）。validateSite 报错用的是同一个解析器，
//    所以「校验说不会出链接」与「页面上真没有链接」是同一件事。
//
// 🔴 **藏东西一律是不渲染**：`image=none` 或没有图 ⟹ DOM 里没有 `<img>`；没有标题 ⟹ 没有 `<h2>`（eyebrow 照常）；
//    没有按钮 ⟹ 没有按钮那一行。
//
// 🔴 **图片的键叫 `imageUrl`**（`image`）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键（`scripts/lib/image-urls.js`）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg，同 milestones / cta）。

import type { ReactNode } from 'react';
import { slotImg } from '@/lib/sections/blockMedia';
import BlockSection from '@/components/BlockSection';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import SiteLink from '@/components/SiteLink';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import Button from '@/components/Button';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { type BgValue } from '../../scripts/lib/contrast.js';
import { parseRichtext, type RichInline } from '../../scripts/lib/richtext.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface ContentImage { imageUrl?: string; alt?: string }
export interface ContentButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface ContentOptions { headlinePosition?: string; textAlign?: string; textStyle?: string; image?: string; frame?: string }
export interface ContentData {
  options?: ContentOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  ctas?: ContentButton[];
  image?: ContentImage;
  bg?: BgValue;
}

interface Props {
  data: ContentData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// 按钮 0–2 条（manifest `slots.ctas.max`）。演示内容包按守卫 (c) 给按钮 6 条，多出来的在这里截掉。
const MAX_CTAS = manifest.slots.ctas.max;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const imgOf = (v: unknown): ContentImage | null => (isObj(v) && str((v as ContentImage).imageUrl) ? (v as ContentImage) : null);

function inline(nodes: RichInline[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.v;
    if (n.t === 'strong') return <strong key={i}>{inline(n.c)}</strong>;
    // #1508 r2：richtext 的链接也收 `/` 开头的站内路径（richtext.js §SAFE_HREF）⟹ 按值判，站内走 next/link 才吃 basePath。
    return <SiteLink key={i} href={n.href}>{inline(n.c)}</SiteLink>;
  });
}

export default function ContentNewSection({ data, block, iconTable = {} }: Props) {
  const d: ContentData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: ContentOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<ContentOptions>;
  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 milestones / features：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const showEyebrow = !!eyebrow && eyebrowStyle !== 'none';
  const headline = str(d.headline);
  const body = parseRichtext(d.body);
  const ctas = (Array.isArray(d.ctas) ? d.ctas : []).filter((b) => isObj(b) && str(b.label)).slice(0, MAX_CTAS);
  const img = k.image !== 'none' ? imgOf(d.image) : null;

  return (
    <BlockSection
      type="content"
      block={block}
      attrs={{
        'data-headline-position': k.headlinePosition,
        'data-text-align': k.textAlign,
        'data-text-style': k.textStyle,
        'data-image': k.image,
        'data-frame': k.frame,
      }}
      bg={d.bg}
    >
      <div className="co-outer">
        <div className="co-frame" data-part="frame">
          <div className="co-inner">
            {showEyebrow || headline ? (
              <div className="co-head" data-part="head">
                {showEyebrow ? (
                  <div className="co-eyebrow" data-part="eyebrow">
                    <Eyebrow style={eyebrowStyle} text={eyebrow!.text} slot="introEyebrow.text" />
                  </div>
                ) : null}
                {headline ? <h2 className="co-title display-5 fw-bold lh-1 ls-tight mb-0" data-slot="headline">{headline}</h2> : null}
              </div>
            ) : null}
            <div className="co-main">
              {body.length ? (
                <div className="co-body" data-slot="body">
                  {body.map((b, i) => (b.t === 'p'
                    ? <p key={i}>{inline(b.c)}</p>
                    : b.t === 'ul'
                      ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
                      : <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>))}
                </div>
              ) : null}
              {ctas.length ? (
                <div className="co-ctas d-flex flex-wrap gap-2" data-part="ctas">
                  {ctas.map((b, i) => (
                    <Button key={i} href={b.href || '#'} style={b.style} fallback={i === 0 ? 'solid' : 'outline'} size={b.size} defaultSize="md" flush>
                      {b.icon ? icon(b.icon, 'me-2') : null}
                      <span data-slot={`ctas.${i}.label`}>{b.label}</span>
                      {b.arrow ? <span className="ms-2 d-inline-flex">{icon('arrow-right')}</span> : null}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {img ? (
          <div className="co-img" data-part="image">
            {slotImg(img, { before: { className: 'w-100 rounded-4 object-fit-cover' }, slot: 'image' })}
          </div>
        ) : null}
      </div>
    </BlockSection>
  );
}
