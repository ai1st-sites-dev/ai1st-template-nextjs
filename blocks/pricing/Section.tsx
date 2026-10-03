'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// pricing —— 块头（intro）+ 一组套餐（plans），Webpixels / Bootstrap 那一套（#1483，总纲 #1422 的 T2.7）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，两层旋钮**：intro*（introPosition / introAlign）· plans* / plan*（plansColumns / planFeatures /
//    planStyle / planAlign / planCta）+ featured，六个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-featured` / `data-tone` / `data-fc-*`），`block.css` 按它们排；
//    形态目录自己不带几何。
//
// 🔴 **藏东西一律是不渲染**（部件有数据才画），不靠 CSS 藏：`highlights` / `proof` / `logos` 空 ⟹ DOM 里没有那个节点；
//    `billing` 只在它有值、**而且**至少一个套餐填了 `price.yearly` 时才画（图册踩过：居中 highlights 那条
//    `display:flex!important` 盖掉了隐藏规则，没勾也露出来 —— 这里没有「隐藏规则」可被盖）。
//
// 🔴 **'use client' 是因为月付 / 年付切换是组件内状态**（点 Yearly ⟹ 每个套餐显示 `price.yearly`）。组件其余部分跟
//    服务端渲染的结果逐字相同：初始状态恒是 monthly，所以静态导出的 HTML 就是月付那一版。
//
// 🔴 **两个颜色槽**：`bg`（整段底色）与 `featuredColor`（高亮那个套餐的颜色，空 = `brand` = 站点主色）。两个都走
//    `scripts/lib/contrast.js` 的 §bgCss / §toneForBg（纯色、brand、渐变都认），这里不自己算亮度、不自己拼渐变。
//    `featuredColor` 写成根上的几个 CSS 变量 + `data-fc-kind`（solid / gradient）+ `data-fc-tone`（light / dark / brand）；
//    🔴 不叫 `data-tone` —— 那个名字挂着全站那条「深底小字白 .92」（`site-css.js` §ON_DEEP_MUTED），高亮卡的底色
//    不该让整段的小字跟着反白。
//
// 🔴 **图标是内联 SVG**（同 features / milestones）：`iconTable` 由服务端按数据里出现的名字查好传进来
//    （`scripts/lib/icons.js` §iconTableFor，`check` 勾号登记在 `BLOCK_ICONS['pricing']`），这里用 `InlineIcon` 画。

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import { slotImg } from '@/lib/sections/blockMedia';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, bsThemeForBg, normalizeBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

export interface PricingNewImage { imageUrl?: string; alt?: string }
export interface PricingNewButton { label?: string; href?: string; style?: 'solid' | 'outline' }
export interface PricingNewPlan {
  name?: string;
  price?: { monthly?: string; yearly?: string };
  period?: string;
  description?: string;
  features?: string[];
  cta?: PricingNewButton;
  featured?: boolean;
  badge?: string;
}
export interface PricingNewOptions {
  introPosition?: string; introAlign?: string;
  plansColumns?: string; planFeatures?: string; planStyle?: string; planAlign?: string; planCta?: string; featured?: string;
}
export interface PricingNewData {
  options?: PricingNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  highlights?: { icon?: string; title?: string; text?: string }[];
  proof?: { avatars?: PricingNewImage[]; rating?: number | string; text?: string };
  logos?: { caption?: string; items?: PricingNewImage[] };
  billing?: { monthlyLabel?: string; yearlyLabel?: string; yearlyNote?: string };
  plans?: PricingNewPlan[];
  bg?: BgValue;
  featuredColor?: BgValue;
}

interface Props {
  data: PricingNewData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// plans 1–4、highlights 1–4（manifest `slots.<槽>.maxItems`，validateSite 拦超出的）。演示内容包按守卫 (c)
// 给 6 条，多出来的在这里截掉。头像 4 个、logo 6 个同 hero。
const MAX_PLANS = manifest.slots.plans.maxItems;
const MAX_HIGHLIGHTS = manifest.slots.highlights.maxItems;
const MAX_AVATARS = 4;
const MAX_LOGOS = 6;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const imgs = (v: unknown): PricingNewImage[] => (Array.isArray(v) ? v.filter((x) => isObj(x) && str((x as PricingNewImage).imageUrl)) : []);

/**
 * `featuredColor` → 根上的 CSS 变量（`block.css` 的 featured 两档读它们）：
 *   --pr-fc       实色（outline 的边框、badge / 主按钮的底）：纯色 = 它，brand = 主色，渐变 = 整条渐变（只能当 background 用）
 *   --pr-fc-line  outline 纯色时的边框色（渐变时不用 —— 渐变走 padding-box / border-box 两层背景）
 *   --pr-fc-on    铺在这个色上的字：深 / brand ⟹ 白，浅 ⟹ 深色
 *   --pr-fc-ink   反过来：白底上用这个色写字（background 档的主按钮 / badge）；渐变取第一个色标
 */
function featuredVars(fc: BgValue | null): { kind: 'solid' | 'gradient'; tone: string; vars: Record<string, string> } {
  const v = fc || 'brand';
  const css = bgCss(v) || 'var(--x-primary)';
  const grad = typeof v === 'object';
  const tone = toneForBg(v);
  const on = tone === 'light' ? '#0f172a' : '#fff';
  const ink = grad ? (v as { stops: string[] }).stops[0] : css;
  return {
    kind: grad ? 'gradient' : 'solid',
    tone,
    vars: {
      '--pr-fc': css,
      '--pr-fc-line': grad ? 'transparent' : css,
      '--pr-fc-on': on,
      '--pr-fc-ink': ink,
      '--pr-fc-muted': tone === 'light' ? '#475569' : 'rgba(255, 255, 255, .92)',
    },
  };
}

export default function PricingNewSection({ data, block, iconTable = {} }: Props) {
  const d: PricingNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: PricingNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof PricingNewOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);
  const fc = featuredVars(normalizeBg(d.featuredColor));
  // 月付 / 年付：这是**数据切换**不是 HTML 交互 —— 换的是渲染出来的价格数字，不是哪个元素显不显，Bootstrap 没有对应组件，
  // 所以留 React（#1514 正文的分类表，Chris 2026-10-01 口径「HTML 的交互归 bootstrap.js」管不到它）。
  const [yearly, setYearly] = useState(false);

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;
  const hasIcon = (name: unknown) => typeof name === 'string' && !!iconTable[name];

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero / cta / features / milestones）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const highlights = (Array.isArray(d.highlights) ? d.highlights : []).filter((h) => isObj(h) && (str(h.title) || str(h.text))).slice(0, MAX_HIGHLIGHTS);
  const proof = isObj(d.proof) && (str(d.proof.text) || imgs(d.proof.avatars).length) ? d.proof : null;
  const logos = isObj(d.logos) ? imgs(d.logos.items).slice(0, MAX_LOGOS) : [];
  const plans = (Array.isArray(d.plans) ? d.plans : []).filter((p): p is PricingNewPlan => isObj(p)).slice(0, MAX_PLANS);
  // 「最多一个 featured」由 validateSite 拦；这里再兜一次：只认第一个，页面上不会同时亮两张。
  const featuredAt = plans.findIndex((p) => p.featured === true);
  const billing = isObj(d.billing) && plans.some((p) => isObj(p.price) && str(p.price.yearly)) ? d.billing : null;
  const hasIntro = !!(str(d.headline) || str(d.body) || eyebrow || highlights.length || proof || logos.length);

  const intro = hasIntro ? (
    <div className="col-12 pr-introcol" data-part="intro">
      <div className="pr-intro">
        <div className="pr-intro-text">
          {eyebrow && eyebrowStyle !== 'none' ? (
            <div className="mb-4" data-part="eyebrow">
              <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
            </div>
          ) : null}
          {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 pr-title" data-slot="headline">{d.headline}</h2> : null}
          {d.body ? <p className="fs-5 text-muted mb-0 pr-body" data-slot="body">{d.body}</p> : null}
          {highlights.length ? (
            <ul className="pr-highlights list-unstyled mb-0" data-part="highlights">
              {highlights.map((h, i) => (
                <li key={i} className="pr-hl d-flex align-items-start gap-4" data-part="highlight">
                  {hasIcon(h.icon) ? (
                    <span className="pr-hl-icon d-inline-flex align-items-center justify-content-center rounded-3 border bg-body flex-shrink-0" data-part="icon">
                      {icon(h.icon)}
                    </span>
                  ) : null}
                  <div className="pr-hl-text">
                    {h.title ? <div className="fw-semibold fs-5 pr-hl-title" data-slot={`highlights.${i}.title`}>{h.title}</div> : null}
                    {h.text ? <div className="text-muted text-sm" data-slot={`highlights.${i}.text`}>{h.text}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {proof ? (
            <div className="pr-proof d-flex align-items-center gap-3" data-part="proof">
              {imgs(proof.avatars).length ? (
                <div className="d-flex">
                  {imgs(proof.avatars).slice(0, MAX_AVATARS).map((a, i) => (
                    slotImg(a, { key: i, after: { width: 36, height: 36, className: 'rounded-circle border border-2 border-body object-fit-cover pr-avatar' } })
                  ))}
                </div>
              ) : null}
              <div className="text-sm">
                {proof.rating !== undefined && proof.rating !== '' ? (
                  <><span className="text-warning" aria-hidden="true">★★★★★</span> <b>{proof.rating}</b> · </>
                ) : null}
                <span data-slot="proof.text">{proof.text}</span>
              </div>
            </div>
          ) : null}
          {logos.length ? (
            <div className="pr-logos" data-part="logos">
              {isObj(d.logos) && d.logos.caption ? (
                <div className="text-sm text-muted mb-3" data-slot="logos.caption">{d.logos.caption}</div>
              ) : null}
              <div className="pr-logo-row d-flex flex-wrap align-items-center gap-4">
                {logos.map((l, i) => slotImg(l, { key: i, after: { className: 'pr-logo' } }))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <section
      {...blockAttrs('pricing', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-plans-columns={k.plansColumns}
      data-plan-features={k.planFeatures}
      data-plan-style={k.planStyle}
      data-plan-align={k.planAlign}
      data-plan-cta={k.planCta}
      data-featured={k.featured}
      data-tone={tone}
      data-bs-theme={bsThemeForBg(d.bg)}
      data-fc-kind={fc.kind}
      data-fc-tone={fc.tone}
      className="position-relative py-16 py-lg-24"
      style={{ ...(bgValue ? { background: bgValue } : {}), ...fc.vars } as CSSProperties}
    >
      <div className="container">
        <div className="row pr-frame gy-10 gx-lg-16">
          {intro}
          <div className="col-12 pr-planscol" data-part="plans">
            {billing ? (
              <div className="pr-billing-wrap" data-part="billing" data-billing={yearly ? 'yearly' : 'monthly'}>
                <div className="pr-billing d-inline-flex align-items-center gap-1 p-1 rounded-pill border" role="group">
                  <button type="button" data-billing-option="monthly" aria-pressed={!yearly} onClick={() => setYearly(false)}
                    className={`btn btn-sm rounded-pill px-4 ${yearly ? 'btn-link text-body text-decoration-none' : 'btn-primary'}`}>
                    <span data-slot="billing.monthlyLabel">{billing.monthlyLabel || 'Monthly'}</span>
                  </button>
                  <button type="button" data-billing-option="yearly" aria-pressed={yearly} onClick={() => setYearly(true)}
                    className={`btn btn-sm rounded-pill px-4 ${yearly ? 'btn-primary' : 'btn-link text-body text-decoration-none'}`}>
                    <span data-slot="billing.yearlyLabel">{billing.yearlyLabel || 'Yearly'}</span>
                    {billing.yearlyNote ? (
                      <span className="pr-billing-note badge rounded-pill bg-success-subtle text-success ms-1" data-slot="billing.yearlyNote">{billing.yearlyNote}</span>
                    ) : null}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="pr-grid" data-plan-count={plans.length}>
              {plans.map((p, i) => {
                const featured = i === featuredAt;
                const price = isObj(p.price) ? p.price : {};
                const shown = yearly && str(price.yearly) ? str(price.yearly) : str(price.monthly);
                const features = (Array.isArray(p.features) ? p.features : []).filter((f) => str(f));
                const cta = isObj(p.cta) && str(p.cta.label) ? p.cta : null;
                const ctaStyle = cta && cta.style ? cta.style : featured ? 'solid' : 'outline';
                return (
                  <div key={i} className={`pr-plan${featured ? ' pr-featured' : ''}`} data-part="plan" data-plan-featured={featured ? 'true' : undefined}>
                    <div className="pr-inner h-100 d-flex flex-column">
                      <div className="pr-card">
                        <div className="pr-head d-flex align-items-center justify-content-between gap-3 mb-3">
                          {p.name ? <div className="pr-name fw-bold fs-5" data-slot={`plans.${i}.name`}>{p.name}</div> : null}
                          {p.badge ? (
                            <span className="pr-badge badge rounded-pill text-xs px-3 py-2" data-part="badge" data-slot={`plans.${i}.badge`}>{p.badge}</span>
                          ) : null}
                        </div>
                        {shown ? (
                          <div className="pr-price d-flex flex-wrap align-items-baseline gap-1 mb-2" data-part="price">
                            <span className="pr-amount display-5 fw-bold lh-1 ls-tight" data-price={yearly && str(price.yearly) ? 'yearly' : 'monthly'}>{shown}</span>
                            {p.period ? <span className="pr-period text-muted text-sm" data-slot={`plans.${i}.period`}>{p.period}</span> : null}
                          </div>
                        ) : null}
                        {p.description ? <p className="pr-desc text-muted text-sm mb-4" data-slot={`plans.${i}.description`}>{p.description}</p> : null}
                        {cta ? (
                          <Link href={cta.href || '#'} className={`pr-cta btn ${ctaStyle === 'solid' ? 'btn-primary' : 'btn-outline-primary'} w-100`} data-cta={ctaStyle}>
                            {cta.label}
                          </Link>
                        ) : null}
                      </div>
                      {features.length ? (
                        <ul className="pr-features list-unstyled mb-0" data-part="features">
                          {features.map((f, j) => (
                            <li key={j} className="d-flex align-items-start text-sm mb-3">
                              <InlineIcon name="check" icons={iconTable} className="pr-check flex-shrink-0 me-3" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
