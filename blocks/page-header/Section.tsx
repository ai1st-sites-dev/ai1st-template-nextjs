// ══════════════════════════════════════════════════════════════════════════════════════════════════
// page-header —— 内页标题带，Webpixels / Bootstrap 那一套（#1502，总纲 #1422 的 T2.16）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一页一个、永远在最上面**（非首页、关键词页）。T3 切换时 `page-header` → `page-header`，旧块删；
//    在那之前两个块并存，提示词里写着「用它或 page-header，不要同时用」。它是 `page-specific`，不进首页抽取池。
//
// 🔴 **h1 在这里**：标题（`headline`）渲染成 `<h1>`，一页只有这一个 h1。
//
// 🔴 **面包屑不是槽，块不读 `data.breadcrumbs`**（Chris 2026-09-30：内容和样子分开）。它按页面路径算
//    （`src/lib/breadcrumbs.ts` §breadcrumbsFor，`SubPage` 出结构化数据用的是同一个函数），块只负责画：
//    当前页的 slug 由 `SectionRenderer` 的 `pageSlug` 传进来（内页 = 真 slug；编辑器画布 = 正在编辑的那一页；
//    单格页 = 夹具页）；没给（首页 / 不知道是哪一页）就不画那一行。
//    🔴 **本块不出 `BreadcrumbList`**：结构化数据只由 `SubPage.tsx` 那一份出，块再出一份就是两段。
//
// 🔴 **一份 markup，三个旋钮**（headlinePosition / textAlign / image），五个预设各是一个形态目录。实际生效的旋钮 =
//    形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs）。
//    旋钮值写在根元素上（`data-headline-position` / `data-text-align` / `data-image` / `data-tone`），`block.css` 按它们排。
//
// 🔴 **藏东西一律是不渲染**（部件有数据才画）：没图 ⟹ 没有 `<img>`；`image=none` 时写了图也不画。
//
// 🔴 **底色与字色**走 `scripts/lib/contrast.js` 那两个共用函数（§bgCss 写成 CSS、§toneForBg 按亮度反白）；
//    `image=background` 一律按深底处理（照片 + 深色遮罩）。

import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import Icon from '@/components/Icon';
import { breadcrumbsFor } from '@/lib/breadcrumbs';
import { getLabels } from '@/lib/component-labels';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface PageHeaderNewImage { imageUrl?: string; alt?: string }
export interface PageHeaderNewButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface PageHeaderNewOptions { headlinePosition?: string; textAlign?: string; image?: string }
export interface PageHeaderNewData {
  options?: PageHeaderNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  subheadline?: string;
  ctas?: PageHeaderNewButton[];
  image?: PageHeaderNewImage;
  bg?: BgValue;
}

interface Props {
  data: PageHeaderNewData;
  locale?: string;
  block?: BlockConfig;
  pageSlug?: string;
}

// 按钮 0–2 条（定稿）；演示内容包按守卫 (c) 给列表槽 6 条，多出来的在这里截掉。
const MAX_CTAS = 2;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'phn-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'phn-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'phn-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'phn-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

function btnClass(b: PageHeaderNewButton): string {
  const size = b.size === 'sm' ? ' btn-sm' : b.size === 'lg' ? ' btn-lg' : '';
  if (b.style === 'link') return `btn btn-link px-0 d-inline-flex align-items-center text-nowrap${size}`;
  if (b.style === 'outline') return `btn btn-outline-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  return `btn btn-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
}

export default function PageHeaderNewSection({ data, locale = 'en', block, pageSlug }: Props) {
  const d: PageHeaderNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: PageHeaderNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as { headlinePosition: string; textAlign: string; image: string };
  const img: PageHeaderNewImage | null = k.image !== 'none' && isObj(d.image) && str(d.image.imageUrl) ? d.image : null;
  const cover = k.image === 'background' && !!img;
  const side = (k.image === 'left' || k.image === 'right') && !!img;
  const tone = cover ? 'dark' : toneForBg(d.bg);
  const bgValue = bgCss(d.bg);

  const crumbs = pageSlug && pageSlug !== 'home' ? breadcrumbsFor(pageSlug, locale) : [];
  const homeLabel = getLabels(locale).home;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 milestones / cta：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : eyebrow.style in EYEBROW_CLASS ? eyebrow.style : 'none';
  const ctas = (Array.isArray(d.ctas) ? d.ctas : []).filter((b) => isObj(b) && str(b.label)).slice(0, MAX_CTAS);
  const sub = str(d.subheadline);

  return (
    <section
      {...blockAttrs('page-header', block)}
      data-headline-position={k.headlinePosition}
      data-text-align={k.textAlign}
      data-image={k.image}
      data-tone={tone}
      data-bs-theme={bsThemeForBg(d.bg, cover)}
      className="phn position-relative"
      style={bgValue ? { background: bgValue } : undefined}
    >
      {cover && img ? (
        <div className="phn-bgimg" data-part="bg" aria-hidden="true">
          <img src={img.imageUrl} alt="" />
        </div>
      ) : null}
      <div className="container position-relative">
        <div className="phn-outer">
          <div className="phn-text" data-part="text">
            {crumbs.length ? (
              <nav className="phn-crumbs" aria-label="Breadcrumb" data-part="breadcrumbs">
                <ol className="breadcrumb text-sm mb-6">
                  {crumbs.map((c, i) => {
                    const last = i === crumbs.length - 1;
                    const label = i === 0 ? homeLabel : c.label;
                    return last ? (
                      <li key={i} className="breadcrumb-item active" aria-current="page">{label}</li>
                    ) : (
                      <li key={i} className="breadcrumb-item">{c.href ? <Link href={c.href}>{label}</Link> : label}</li>
                    );
                  })}
                </ol>
              </nav>
            ) : null}
            <div className="phn-inner">
              <div className="phn-head">
                {eyebrow && eyebrowStyle !== 'none' ? (
                  <div className="mb-4" data-part="eyebrow">
                    <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="introEyebrow.text">
                      {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                    </span>
                  </div>
                ) : null}
                <h1 className="phn-title display-4 fw-bold lh-1 ls-tight mb-0" data-slot="headline">{d.headline}</h1>
              </div>
              {sub || ctas.length ? (
                <div className="phn-main">
                  {sub ? <p className="phn-sub fs-5 text-muted mb-0" data-slot="subheadline">{sub}</p> : null}
                  {ctas.length ? (
                    <div className="phn-ctas d-flex flex-wrap gap-2" data-part="ctas">
                      {ctas.map((b, i) => (
                        <Link key={i} href={b.href || '#'} className={btnClass(b)} data-cta={b.style || 'solid'}>
                          {b.icon ? <Icon name={b.icon} className="me-2" /> : null}
                          <span data-slot={`ctas.${i}.label`}>{b.label}</span>
                          {b.arrow ? <Icon name="arrow-right" className="ms-2" /> : null}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {side && img ? (
            <div className="phn-img" data-part="image">
              <img className="w-100 rounded-4 object-fit-cover" src={img.imageUrl} alt={img.alt || ''} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
