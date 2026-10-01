// ══════════════════════════════════════════════════════════════════════════════════════════════════
// reviews-new —— 块头（intro，可带总分）+ 一组平台评分（platforms），Webpixels / Bootstrap 那一套（#1504，总纲 #1422 的 T2.17）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，六个旋钮**：intro*（introPosition / introAlign）· total（none / show）· items*（itemsLayout）·
//    item*（itemStyle / itemAlign），三个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-item-align` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//    grid 的列数没有旋钮：按平台个数，服务端写成 `--rv-n`（block.css 那一段有规则）。
//
// 🔴 **总分不是槽，这里算**：按各平台 `count` 加权平均 = Σ(rating × count) ÷ Σcount，一位小数；条数 = Σcount。
//    AI 不写这个数（它写不错）。显示与否由 `total` 旋钮管；`total=none` ⟹ 没有这个节点。
//
// 🔴 **平台 logo 三档**（`scripts/lib/review-platforms.js`）：上传的 `logoUrl` → Google / Yelp / Facebook 内置品牌图标（品牌色）
//    → 粗体平台名。每一格的 DOM 里都有文字平台名（图标 / 图片那两档带一段 `visually-hidden`）。
//
// 🔴 **图标是内联 SVG**：星（`star-fill`）和三个品牌图标登记在 `scripts/lib/icons.js` 的 `BLOCK_ICONS['reviews-new']`；
//    `iconTable` 由服务端查好传进来，这里用 `InlineIcon` 画。是哪个图标看 `<svg data-icon="google">`（仓里图标的统一读数）——
//    不另挂 `bi bi-google` 这种类：没有样式规则的类会被 theme-css 守卫（#992「unstyled class」）点名。
//
// 🔴 **藏东西一律是不渲染**：眉标、标题、正文没数据就没节点；块头三样文字都空、总分又不显示 ⟹ 块头那一列整个不渲染。
//    没有 `source`、分数不是 0–5 的数、条数不是正数的那一项不画。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），这里不自己算亮度、不自己拼渐变。

import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import SiteLink from '@/components/SiteLink';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';
import { platformLogo } from '../../scripts/lib/review-platforms.js';

export interface ReviewsNewPlatform { source?: string; rating?: number | string; count?: number | string; href?: string; logoUrl?: string }
export interface ReviewsNewOptions {
  introPosition?: string; introAlign?: string; total?: string;
  itemsLayout?: string; itemStyle?: string; itemAlign?: string;
}
export interface ReviewsNewData {
  options?: ReviewsNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  platforms?: ReviewsNewPlatform[];
  bg?: BgValue;
}

interface Props {
  data: ReviewsNewData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// 平台 1–4 个（manifest `slots.platforms.minItems` / `maxItems`，validateSite 拦超出的）；多出来的在这里截掉。
const MAX_ITEMS = manifest.slots.platforms.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);

interface Platform { index: number; source: string; rating: number; count: number; href: string; logoUrl: string }
function platformOf(v: unknown, index: number): Platform | null {
  if (!isObj(v)) return null;
  const p = v as ReviewsNewPlatform;
  const rating = num(p.rating);
  const count = num(p.count);
  if (!str(p.source) || !Number.isFinite(rating) || rating < 0 || rating > 5 || !Number.isFinite(count) || count <= 0) return null;
  return { index, source: str(p.source), rating, count: Math.round(count), href: str(p.href), logoUrl: str(p.logoUrl) };
}

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'rv-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'rv-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'rv-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'rv-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

const fmt = (n: number): string => n.toFixed(1);

export default function ReviewsNewSection({ data, block, iconTable = {} }: Props) {
  const d: ReviewsNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: ReviewsNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof ReviewsNewOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);

  // 星：按分数四舍五入到整数颗实心星（4.5 → 5、4.4 → 4），不画半颗、不补空星（照定稿图册）。
  const stars = (rating: number, part: string) => {
    const n = Math.max(0, Math.min(5, Math.round(rating)));
    return (
      <span className="rv-stars d-inline-flex gap-1 text-warning" data-part={part} data-stars={n} role="img" aria-label={`${n} out of 5 stars`}>
        {Array.from({ length: n }, (_, i) => <InlineIcon name="star-fill" key={i} icons={iconTable} />)}
      </span>
    );
  };

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero-new / features-new：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : eyebrow.style in EYEBROW_CLASS ? eyebrow.style : 'none';
  const platforms = (Array.isArray(d.platforms) ? d.platforms : []).map((v, i) => platformOf(v, i)).filter((p): p is Platform => !!p).slice(0, MAX_ITEMS);

  // 总分：按条数加权，一位小数。
  const totalCount = platforms.reduce((s, p) => s + p.count, 0);
  const totalRating = totalCount ? Math.round((platforms.reduce((s, p) => s + p.rating * p.count, 0) / totalCount) * 10) / 10 : 0;
  const showTotal = k.total === 'show' && platforms.length > 0;
  const totalLine = platforms.length === 1 ? `${totalCount} reviews on ${platforms[0].source}` : `${totalCount} reviews on ${platforms.length} platforms`;
  const hasIntro = !!(str(d.headline) || str(d.body) || showTotal || (eyebrow && eyebrowStyle !== 'none'));

  // `data-slot` 挂在写平台名的那个节点上（编辑器据它原地改字）：图 / 图标两档是 visually-hidden 那一段，名字那一档是名字本身。
  const logo = (p: Platform, i: number) => {
    const l = platformLogo(p.source, p.logoUrl);
    const hidden = <span className="visually-hidden" data-slot={`platforms.${i}.source`}>{p.source}</span>;
    if (l.kind === 'image') {
      return (
        <span className="rv-logo rv-logo-img" data-part="logo" data-logo="image">
          <img src={l.logoUrl} alt={p.source} loading="lazy" />
          {hidden}
        </span>
      );
    }
    if (l.kind === 'icon') {
      return (
        <span className="rv-logo rv-icon" data-part="logo" data-logo="icon" style={{ ['--rv-brand' as string]: l.color }}>
          <InlineIcon name={l.icon} icons={iconTable} />
          {hidden}
        </span>
      );
    }
    return <span className="rv-logo rv-name fw-bold" data-part="logo" data-logo="name" data-slot={`platforms.${i}.source`}>{p.source}</span>;
  };

  return (
    <section
      {...blockAttrs('reviews-new', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-total={k.total}
      data-items-layout={k.itemsLayout}
      data-item-style={k.itemStyle}
      data-item-align={k.itemAlign}
      data-tone={tone}
      className="position-relative py-16 py-lg-24"
      style={bgValue ? { background: bgValue } : undefined}
    >
      <div className="container">
        <div className="row rv-frame gy-10 gx-lg-16">
          {hasIntro ? (
            <div className="col-12 rv-introcol" data-part="intro">
              <div className="rv-intro-text" data-part="intro-text">
                {eyebrow && eyebrowStyle !== 'none' ? (
                  <div className="rv-eyebrow-wrap mb-4" data-part="eyebrow">
                    <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="introEyebrow.text">
                      {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                    </span>
                  </div>
                ) : null}
                {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 rv-title" data-slot="headline">{d.headline}</h2> : null}
                {d.body ? <p className="fs-5 text-muted mb-0 rv-body" data-slot="body">{d.body}</p> : null}
                {showTotal ? (
                  <div className="rv-total d-flex align-items-center gap-3" data-part="total" data-total-rating={fmt(totalRating)} data-total-count={totalCount}>
                    <span className="rv-total-score fw-bold lh-1">{fmt(totalRating)}</span>
                    <span className="rv-meta d-flex flex-column gap-1">
                      {stars(totalRating, 'total-stars')}
                      <span className="rv-count text-sm text-muted">{totalLine}</span>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="col-12 rv-itemscol" data-part="items">
            <div className="rv-items" style={{ ['--rv-n' as string]: String(Math.max(1, platforms.length)) }}>
              {platforms.map((p, i) => {
                const inner = (
                  <>
                    {logo(p, p.index)}
                    <span className="rv-score fw-bold lh-1" data-part="score" data-slot={`platforms.${p.index}.rating`}>{fmt(p.rating)}</span>
                    <span className="rv-meta d-flex flex-column">
                      {stars(p.rating, 'stars')}
                      <span className="rv-count text-sm text-muted" data-part="count"><span data-slot={`platforms.${p.index}.count`}>{p.count}</span> reviews</span>
                    </span>
                  </>
                );
                return p.href ? (
                  <SiteLink /* #1508 r2：href 是 AI / 老板写的，没有协议校验 ⟹ 按值判 */ key={i} className="rv-item text-reset text-decoration-none" data-part="item" data-source={p.source} href={p.href} target="_blank" rel="noopener">{inner}</SiteLink>
                ) : (
                  <div key={i} className="rv-item" data-part="item" data-source={p.source}>{inner}</div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
