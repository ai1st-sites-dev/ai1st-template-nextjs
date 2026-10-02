// ══════════════════════════════════════════════════════════════════════════════════════════════════
// faq-new —— 块头（intro，可带 help 卡）+ 一组问答（items），Webpixels / Bootstrap 那一套（#1484，总纲 #1422 的 T2.8）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，六个旋钮**：intro*（introPosition / introAlign）· items*（itemsMode / itemsColumns）·
//    item*（itemStyle / itemToggle），四个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-item-toggle` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **纯服务端组件，不许加客户端指令、不许用组件状态**（同 faq-accordion，理由在它的 `Section.tsx:38-50`；
//    AC3 按字面 grep 那两个词，所以这段注释也不写出它们）：
//    答案必须在静态 HTML 里 —— 搜索引擎和 AI 读的是那份 HTML。开合用原生 `<details>/<summary>`，收起时答案也在 DOM 里。
//    一条都不默认展开（Chris 2026-09-29）：没有一个 `<details>` 带 `open`。
//
// 🔴 **藏东西一律是不渲染**，不靠 CSS 藏：`itemsMode=accordion` 只画 `<details>`，`open` 只画 `<h3>` + `<p>`（DOM 里没有另一份）；
//    开合图标只画 `itemToggle` 选中的那一种（chevron = 一个图标；plus = plus + dash 两个，展开时 CSS 换着显示）；
//    help 卡、眉标没有数据就没有节点。块头只看 `headline` / `body` / `help`：三个都空 ⟹ 块头那一列整个不渲染。
//
// 🔴 **图标是内联 SVG**（同 features-new / milestones）：`iconTable` 由服务端按名字查好传进来
//    （`scripts/lib/icons.js` §iconTableFor，开合那三个名字登记在 `BLOCK_ICONS['faq-new']`），这里用 `InlineIcon` 画。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），纯色、brand、渐变都认；
//    这里不自己算亮度、不自己拼渐变。

import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface FaqNewButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface FaqNewItem { question?: string; answer?: string }
export interface FaqNewHelp { headline?: string; body?: string; cta?: FaqNewButton }
export interface FaqNewOptions {
  introPosition?: string; introAlign?: string;
  itemsMode?: string; itemsColumns?: string;
  itemStyle?: string; itemToggle?: string;
}
export interface FaqNewData {
  options?: FaqNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  help?: FaqNewHelp;
  items?: FaqNewItem[];
  bg?: BgValue;
}

interface Props {
  data: FaqNewData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// items 1–12 条（manifest `slots.items.maxItems`，validateSite 拦超出的）；多出来的在这里截掉。
const MAX_ITEMS = manifest.slots.items.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'fq-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'fq-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'fq-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'fq-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

// help 卡的按钮没写 size ⟹ sm（图册那张卡就是 btn-sm）。
function btnClass(b: FaqNewButton, fallback: BtnStyle): string {
  const style = b.style || fallback;
  const size = b.size === 'md' ? '' : b.size === 'lg' ? ' btn-lg' : ' btn-sm';
  if (style === 'link') return `btn btn-link px-0 d-inline-flex align-items-center text-nowrap${size}`;
  if (style === 'outline') return `btn btn-outline-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  return `btn btn-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
}

export default function FaqNewSection({ data, block, iconTable = {} }: Props) {
  const d: FaqNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: FaqNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof FaqNewOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero-new / cta-new / features-new / milestones：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : eyebrow.style in EYEBROW_CLASS ? eyebrow.style : 'none';
  const help = isObj(d.help) ? d.help : null;
  const helpCta = help && isObj(help.cta) && str(help.cta.label) ? help.cta : null;
  const hasHelp = !!help && !!(str(help.headline) || str(help.body) || helpCta);
  const hasIntro = !!(str(d.headline) || str(d.body) || hasHelp);
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter((it): it is FaqNewItem => isObj(it) && !!str(it.question))
    .slice(0, MAX_ITEMS);
  const accordion = k.itemsMode !== 'open';

  // chevron：一个向下的箭头，展开时转 180°；plus：plus + dash 两个，展开时 plus 藏、dash 显（block.css §itemToggle）。
  const toggle = k.itemToggle === 'plus'
    ? <>{icon('plus', 'fq-plus')}{icon('dash', 'fq-minus')}</>
    : icon('chevron-down', 'fq-chev');

  return (
    <section
      {...blockAttrs('faq-new', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-items-mode={k.itemsMode}
      data-items-columns={k.itemsColumns}
      data-item-style={k.itemStyle}
      data-item-toggle={k.itemToggle}
      data-tone={tone}
      data-bs-theme={bsThemeForBg(d.bg)}
      className="position-relative py-16 py-lg-24"
      style={bgValue ? { background: bgValue } : undefined}
    >
      <div className="container">
        <div className="row fq-frame gy-10 gx-lg-16">
          {hasIntro ? (
            <div className="col-12 fq-introcol" data-part="intro">
              <div className="fq-intro-text" data-part="intro-text">
                {eyebrow && eyebrowStyle !== 'none' ? (
                  <div className="mb-4" data-part="eyebrow">
                    <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="introEyebrow.text">
                      {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                    </span>
                  </div>
                ) : null}
                {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 fq-title" data-slot="headline">{d.headline}</h2> : null}
                {d.body ? <p className="fs-5 text-muted mb-0 fq-body" data-slot="body">{d.body}</p> : null}
                {hasHelp ? (
                  <div className="fq-help rounded-4 p-6" data-part="help">
                    {help.headline ? <div className="fw-semibold fs-5 mb-1 fq-help-title" data-slot="help.headline">{help.headline}</div> : null}
                    {help.body ? <p className="text-muted text-sm mb-0" data-slot="help.body">{help.body}</p> : null}
                    {helpCta ? (
                      <div className="fq-help-cta" data-part="help-cta">
                        <Link href={helpCta.href || '#'} className={btnClass(helpCta, 'solid')} data-cta={helpCta.style || 'solid'}>
                          {helpCta.icon ? icon(helpCta.icon, 'me-2') : null}
                          <span data-slot="help.cta.label">{helpCta.label}</span>
                          {helpCta.arrow ? <span className="ms-2 d-inline-flex">{icon('arrow-right')}</span> : null}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="col-12 fq-itemscol" data-part="items">
            <div className="fq-grid">
              {items.map((it, i) => (
                <div key={i} className="fq-item" data-part="item">
                  {accordion ? (
                    <details className="fq-inner">
                      <summary className="fq-q d-flex align-items-center justify-content-between gap-4 fw-semibold">
                        <span data-slot={`items.${i}.question`}>{it.question}</span>
                        <span className="fq-toggle d-inline-flex flex-shrink-0" data-part="toggle" aria-hidden="true">{toggle}</span>
                      </summary>
                      {it.answer ? <div className="fq-a text-muted" data-slot={`items.${i}.answer`}>{it.answer}</div> : null}
                    </details>
                  ) : (
                    <div className="fq-open">
                      <h3 className="fq-q fw-semibold mb-2" data-slot={`items.${i}.question`}>{it.question}</h3>
                      {it.answer ? <p className="fq-a text-muted mb-0" data-slot={`items.${i}.answer`}>{it.answer}</p> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
