'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// footer-new —— 页脚，Webpixels / Bootstrap 那一套（#1455 T2.2 → #1464 定稿第 2 版，总纲 #1422）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **还没进正式库**（manifest `staging: true`），理由同 `header-new`：客户站在 T4 之前没有
//    Bootstrap 的 CSS（设计稿 B1）。它是外壳区块（`region: true`）：不进注册表、不进 Puck、不进
//    提示词；今天唯一渲染它的地方是单格页 `/__catalog`。T3 删旧库时它改名成 `footer`、接回 `SiteShell`。
//
// 🔴 **一份 markup + 三个旋钮 + 六个预设**（#1464，Chris 2026-09-27 图册定稿第 2 版，照 header-new 的做法；
//    #1469 第 3 版加 `brand`）。
//    旋钮 `layout`（row | stacked | columns）· `brand`（left | right）· `cta`（none | centered | boxed | inline），声明在 manifest 的
//    `slots.options.knobs`；预设是旋钮组合起的名，表在顶层 `presets`（name 与形态目录名 shape 相同）。
//    形态名只决定**初值**：`options` 里写了旋钮就按旋钮画（§resolveKnobs），函数跟工具栏是同一个
//    （`scripts/lib/header-knobs.js`）。footer 没有耦合（manifest 不写 `knobCoupling`）⟹ 任意组合都成立，
//    对不上预设的就是 Custom。根上挂 `ftr-layout-*` / `ftr-cta-*` 两个类，工具类表达不了的几条在
//    `blocks/footer-new/block.css`（不在各预设的 shape.css：Custom 组合没有文件夹）。
//    部件永远是 `[CTA 条?] [主体] [底栏]`；主体按 layout 分三种排法，CTA 条按 cta 三选一或没有。
//
// 🔴 **`brand=right`：桌面在左的，小屏就在上**（Chris 2026-09-27；#1469 起它是旋钮 `brand`，原来是开关 `reverse`，
//    画法逐字没变 —— 根上的类名也还叫 `ftr-reverse`）。两个排布的主容器 ≥768 反向（首项 / 品牌列
//    在右），<768 用 `flex-column-reverse` 放到最下。`columns` 的断点从 T2.2 的 `lg` 改成 `md`（#1464 的
//    真改动）—— 品牌列在 768 起就跟其余列并排，不然「768–991 品牌列在右」无从谈起。
//    导航行 / 社交行 / 底栏里那几处小容器用的是不带断点的 `flex-row-reverse`，任何宽度都翻。
//    🔴 `stacked` 是居中的，`brand` 对它**一处都不起作用**（#1469 AC3：两个值 HTML 相同）—— 原来的 reverse 在
//    stacked 下还会翻导航 / 社交 / 联系 / CTA 行和根上的类，所以判据收在一个变量上（函数体里的 `reverse`），不在各处分别判。
//
// 🔴 **底色 = 颜色槽 `bg`**（#1469，原来是开关 `dark`）：任意 `#rrggbb`、`brand`（主题主色）或渐变
//    `{ stops: [2–3 个色], angle }`，字色按背景亮度自动反白 —— 纯色跟 hero-new 同一个函数（`scripts/lib/contrast.js`
//    §toneFor，门槛 0.4），渐变按色标平均亮度（§toneForBg，门槛 0.55），不另起一套。没填 = 改前 `dark=false`
//    那一份，逐字相同。
//
// 🔴 **表单 = `form: { mode: teaser | full, id? }`**（#1469）：表单是站级资产（#1471），块只选一张、选画法。
//    `id` 在 #1471 落地前恒空 ⟹ 用组件里那份替身（§FORM_STANDIN）。`teaser` = 首要字段 + 按钮，`full` = 整张；
//    没写 `mode`（含槽位不在）不渲染 —— 工具栏上的 `none` 就是这个意思。
//
// 🔴 **排版只走 Webpixels 的工具类**（总纲约束 3）。Webpixels 的工具类全带 `!important`，要压过它们的
//    规则也得带 `!important` 且 class 数不少于它（票正文那条通用规矩）。
//
// 🔴 **不用任何 `data-bs-*`**（总纲约束 2）。表单部件跟 hero 共用一份（`src/components/BlockLeadForm.tsx`）：
//    提交 POST `/api/leads`、原地显示 successMessage，这里只决定它挂在哪儿。

import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import { defaultLocale } from '@/lib/config';
import type { BlockConfig } from '@/lib/types/config';
import BlockLeadForm, { type BlockLeadFormData } from '@/components/BlockLeadForm';
import manifest from './manifest.json';
import { knobsOf, normalizeKnobs, presetForShape, presetOf, presetsOf } from '../../scripts/lib/header-knobs.js';
import { bgCss, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export type Layout = 'row' | 'stacked' | 'columns';
export type BrandSide = 'left' | 'right';
export type Cta = 'none' | 'centered' | 'boxed' | 'inline';

export interface FooterLink { label: string; href: string; icon?: string }
export interface FooterButton { label: string; href: string; style?: BtnStyle }
export interface FooterContact { phone?: string; address?: string; hours?: string; email?: string }
export interface FooterColumns { services?: FooterLink[]; areas?: FooterLink[]; contact?: boolean }
export interface FooterCta { title?: string; subtitle?: string; buttons?: FooterButton[] }
/** #1469 —— 块只选一张表单、选画法；表单本身是站级资产（#1471）。 */
export interface FooterForm { mode?: 'teaser' | 'full'; id?: string }
export interface FooterOptions {
  /** 只是标签：旋钮跟某个预设吻合就是它的名，否则 `custom`。渲染不读它。 */
  preset?: string;
  layout?: Layout;
  brand?: BrandSide;
  cta?: Cta;
}

export interface FooterNewData {
  logo?: string;
  brandName?: string;
  tagline?: string;
  nav?: FooterLink[];
  columns?: FooterColumns;
  contact?: FooterContact;
  social?: FooterLink[];
  legal?: FooterLink[];
  copyright?: string;
  cta?: FooterCta;
  form?: FooterForm;
  /** #1469 —— 底色：`#rrggbb` · `brand` · 渐变 `{ stops, angle }`；空 = 浅底（`bg-body`）。 */
  bg?: BgValue;
  options?: FooterOptions;
}

export interface FooterKnobs { layout: Layout; brand: BrandSide; cta: Cta }

const KNOBS = knobsOf(manifest);
const PRESETS = presetsOf(manifest);
export const DEFAULT_PRESET = 'slim-row';

/** 形态名（= 预设名）给初值，`options` 里写着的旋钮盖上去，认不出的值落回预设。形态名不认识就落回 `slim-row`。 */
export function resolveKnobs(shape: string | undefined, options: FooterOptions = {}): { knobs: FooterKnobs; preset: string; shape: string } {
  const hit = (shape && presetForShape(PRESETS, shape)) || presetForShape(PRESETS, DEFAULT_PRESET);
  const known = hit ? hit.shape : DEFAULT_PRESET;
  const base = hit ? { ...hit.knobs } : {};
  const given: Record<string, unknown> = {};
  for (const k of KNOBS) if (options[k.name as keyof FooterOptions] !== undefined) given[k.name] = options[k.name as keyof FooterOptions];
  const knobs = normalizeKnobs({ ...base, ...given }, { knobs: KNOBS, presets: PRESETS, coupling: null, base }) as unknown as FooterKnobs;
  return { knobs, preset: presetOf(knobs, { knobs: KNOBS, presets: PRESETS }), shape: known };
}

/**
 * #1469 —— 替身表单：`form.id` 空（#1471 落地前恒空）时用它。内容取自 #1464 的演示夹具；首要字段是电话
 * （`teaser` 只画它 + 按钮）。
 */
const FORM_STANDIN: BlockLeadFormData = {
  fields: ['name', 'phone', 'service'],
  buttonText: 'Call me back',
  successMessage: "Thanks! We'll call you back within the hour.",
};
const FORM_PRIMARY_FIELD = 'phone' as const;

/** 列的固定语义（`columns` 排布专用）。标题是图册的英文演示；T3 接站时跟着站的语言走。 */
const COLUMN_TITLES = { services: 'Services', areas: 'Service areas', pages: 'Pages', contact: 'Contact' };

/** `solidLight`：boxed 那个深色盒子里、以及主色底（`bg=brand`）上的实心按钮用浅色（Webpixels footer-3），别处照旧是主色。 */
function btnClass(style: BtnStyle | undefined, onDark: boolean, large = false, solidLight = false): string {
  const size = large ? ' btn-lg' : '';
  if (style === 'link') return `btn btn-link${size} ${onDark ? 'link-light' : ''}`;
  if (style === 'outline') return `btn${size} ${onDark ? 'btn-outline-light' : 'btn-outline-primary'}`;
  return `btn${size} ${solidLight ? 'btn-light' : 'btn-primary'}`;
}

/** 地址的最后一段当城市（`2150 Yonge St, Toronto` → `Toronto`）：`row` 底栏只露「电话 + 城市」。 */
function cityOf(address: string | undefined): string {
  if (!address) return '';
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

interface Props {
  data?: FooterNewData;
  /** 形态名 = 预设名；没给或不认识就落回 `slim-row`。今天只有单格页传它。 */
  shape?: string;
  block?: BlockConfig;
  /** #1462 —— 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）；图标画成内联 SVG，不走字体。 */
  iconTable?: IconTable;
  locale?: string;
}

export default function FooterNewSection({ data = {}, shape: shapeIn, block, iconTable = {}, locale = defaultLocale }: Props) {
  const opts = data.options || {};
  const { knobs, preset, shape } = resolveKnobs(shapeIn, opts);
  const { layout, cta: ctaKind } = knobs;
  const brandSide = knobs.brand;
  // §文件头：`stacked` 下 brand 一处都不生效 —— 下面所有「翻不翻」都只读这一个变量。
  const reverse = brandSide === 'right' && layout !== 'stacked';
  const bg = data.bg;
  const tone = toneForBg(bg);
  const dark = tone !== 'light';
  const bgValue = bgCss(bg);
  const bgStyle = bgValue ? { background: bgValue } : undefined;
  // 主色底上主色按钮看不见 ⟹ 翻成浅色（hero-new 同一条：「`brand` 时主按钮翻成白底主色字」）。
  const onBrand = tone === 'brand';
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter(Boolean) : []);
  const nav = list(data.nav);
  const social = list(data.social);
  const legal = list(data.legal);
  const contact = data.contact || {};
  const brand = data.brandName || '';
  const copyright = data.copyright || `© ${new Date().getFullYear()} ${brand}`;
  const cta = ctaKind !== 'none' && data.cta && data.cta.title ? data.cta : null;
  const formMode = data.form && (data.form.mode === 'teaser' || data.form.mode === 'full') ? data.form.mode : null;
  const form: BlockLeadFormData | null = formMode
    ? { ...FORM_STANDIN, fields: formMode === 'teaser' ? [FORM_PRIMARY_FIELD] : FORM_STANDIN.fields }
    : null;

  const linkTone = dark ? 'link-light' : 'link-secondary';
  // 深底上的小字（说明 / 联系 / 版权）不用灰：白 .92（`block.css` §ftr-muted-on-dark；图册 2026-09-28 实测
  // 紫→金渐变上 .5 / .7 的灰字看不清）。
  const mutedTone = dark ? 'ftr-muted-on-dark' : 'text-body-secondary';
  const headTone = dark ? 'text-white' : 'text-heading';
  // 深底的分隔线：`border-secondary` 在 Webpixels 里是紫色，深底上画出来是一道紫线 —— 用半透明白。
  const lineTone = dark ? 'border-white border-opacity-10' : '';
  // 主容器的 reverse（§文件头）：≥768 反向，<768 反序叠 —— 首项 / 品牌列在最下。
  const mainReverse = reverse ? 'flex-column-reverse flex-md-row-reverse' : 'flex-column flex-md-row';

  // ── 部件 ──────────────────────────────────────────────────────────────────────────────────────
  const brandMark = (big = false) => (
    // `flex-shrink-0`：row 一行里它是 flex 项，被挤的时候盒子缩、`text-nowrap` 的店名照样画出去，
    // 压到旁边的链接上（820 实测：reverse 时一直画到页脚外面）。
    <a className={`d-inline-flex flex-shrink-0 align-items-center gap-2 text-decoration-none ${headTone}`} href="/" data-footer-part="brand">
      {data.logo ? <img src={data.logo} alt="" className="h-rem-8 w-auto" /> : null}
      <span className={`fw-semibold ${big ? 'fs-4' : 'fs-5'} text-nowrap`}>{brand}</span>
    </a>
  );

  const tagline = (extra = '') => (data.tagline
    ? <p className={`${mutedTone} mb-0 mw-sm ${extra}`}>{data.tagline}</p>
    : null);

  const linkRow = (items: FooterLink[], extra = '') => (items.length ? (
    <ul className={`list-unstyled d-flex flex-wrap column-gap-6 row-gap-2 mb-0 ${reverse ? 'flex-row-reverse' : ''} ${extra}`}>
      {items.map((l, i) => (
        <li key={i}><a className={`${linkTone} text-decoration-none`} href={l.href}>{l.label}</a></li>
      ))}
    </ul>
  ) : null);

  const socialIcons = (extra = '') => (social.length ? (
    <div className={`d-flex flex-shrink-0 align-items-center gap-4 ${reverse ? 'flex-row-reverse' : ''} ${extra}`}>
      {social.map((s, i) => (
        <a key={i} href={s.href} className={`${linkTone} fs-5`} aria-label={s.label}>
          <InlineIcon name={s.icon && iconTable[s.icon] ? s.icon : 'link-45deg'} icons={iconTable} />
        </a>
      ))}
    </div>
  ) : null);

  // 联系信息：每个字段可空、空的不渲染（没有空图标、没有空行）。
  const contactItems = [
    contact.phone ? { key: 'phone', icon: 'telephone', text: contact.phone, href: telHref(contact.phone) } : null,
    contact.address ? { key: 'address', icon: 'geo-alt', text: contact.address } : null,
    contact.hours ? { key: 'hours', icon: 'clock', text: contact.hours } : null,
    contact.email ? { key: 'email', icon: 'envelope', text: contact.email, href: `mailto:${contact.email}` } : null,
  ].filter((c): c is { key: string; icon: string; text: string; href?: string } => !!c);

  // `stacked`：竖着一条一行（`columns` 品牌列里那份）。🔴 竖排时不叠 `flex-row-reverse` —— 它跟
  // `flex-column` 都是带 `!important` 的同级工具类，谁赢看样式表里的先后，不看 markup。
  const contactLine = (keys: string[], extra = '', stacked = false) => {
    const items = contactItems.filter((c) => keys.includes(c.key));
    if (!items.length) return null;
    const dir = stacked ? `flex-column ${reverse ? 'align-items-end' : ''}` : `flex-wrap ${reverse ? 'flex-row-reverse' : ''}`;
    return (
      <div className={`d-flex column-gap-6 row-gap-2 ${mutedTone} ${dir} ${extra}`} data-footer-part="contact">
        {items.map((c) => (
          <span key={c.key} className="d-inline-flex align-items-center gap-2">
            <InlineIcon name={c.icon} icons={iconTable} />
            {c.href ? <a className={`${linkTone} text-decoration-none`} href={c.href}>{c.text}</a> : c.text}
          </span>
        ))}
      </div>
    );
  };

  // 表单部件：`layout=stacked` 在联系一行下、`layout=columns` 在品牌列下、`layout=row` 不渲染；空值不渲染。
  //    `teaser` 沿用 #1464 `inline` 的画法（一个字段 + 按钮一行），`full` 沿用 `stacked`（整张）。
  const formPart = (extra = '') => (form && formMode ? (
    <div className={`w-100 mw-sm ${extra}`} data-footer-form={formMode}>
      <BlockLeadForm data={form} variant={formMode === 'teaser' ? 'inline' : 'stacked'} locale={locale} idPrefix="ftr" size="sm" tone={tone} />
    </div>
  ) : null);

  // ── CTA 条（旋钮 `cta`，顶上，三选一或没有）──────────────────────────────────────────────────────
  //    三种与下面内容之间都是 `mb-16`（间距照 Webpixels footer-4 的尺度，票正文）。
  const ctaButtons = (onDark: boolean, large: boolean, extra = '', solidLight = false) => (
    <div className={`d-flex flex-column flex-sm-row gap-2 ${extra}`}>
      {list(cta?.buttons).map((b, i) => (
        <a key={i} href={b.href} className={`${btnClass(b.style, onDark, large, solidLight)} text-nowrap`}>{b.label}</a>
      ))}
    </div>
  );
  const ctaCopy = (onDark: boolean) => (
    <div>
      <h2 className={`h4 fw-bold mb-1 ${onDark ? 'text-white' : headTone}`}>{cta?.title}</h2>
      {/* boxed 那个深盒子在浅底页脚上照旧 .5（#1464 的样子）；页脚本身是深底时跟别处小字一样白 .92。 */}
      {cta?.subtitle ? <p className={`mb-0 ${onDark ? (dark ? 'ftr-muted-on-dark' : 'text-white-50') : mutedTone}`}>{cta.subtitle}</p> : null}
    </div>
  );
  const ctaRowDir = `d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-4 ${reverse ? 'flex-md-row-reverse' : ''}`;

  const ctaStrip = () => {
    if (!cta) return null;
    if (ctaKind === 'centered') {
      return (
        <div className={`border-bottom ${lineTone} py-10 mb-16 text-center`} data-footer-cta="centered">
          <h2 className={`display-6 fw-bold mb-2 ${headTone}`}>{cta.title}</h2>
          {cta.subtitle ? <p className={`fs-5 mb-4 mx-auto mw-lg ${mutedTone}`}>{cta.subtitle}</p> : null}
          {ctaButtons(dark, true, 'justify-content-center', onBrand)}
        </div>
      );
    }
    if (ctaKind === 'boxed') {
      // 深色圆角盒子：页脚本身是深底（`bg` 深色 / `brand`）时换成比底色浅一档（半透明白叠在底色上 ——
      // 任何深底、包括主色底都成立），否则深盒子融进深底看不出来。
      return (
        <div className={`rounded-3 ${dark ? 'bg-white bg-opacity-10' : 'bg-dark'} text-white px-6 px-md-10 py-8 mb-16 ${ctaRowDir}`} data-footer-cta="boxed">
          {ctaCopy(true)}
          {ctaButtons(true, false, 'flex-shrink-0', !dark || onBrand)}
        </div>
      );
    }
    return (
      <div className={`border-bottom ${lineTone} pb-10 mb-16 ${ctaRowDir}`} data-footer-cta="inline">
        {ctaCopy(false)}
        {ctaButtons(dark, false, 'flex-shrink-0', onBrand)}
      </div>
    );
  };

  // ── 主体（按 layout）───────────────────────────────────────────────────────────────────────────
  const rowBody = () => (
    <div className={`d-flex ${mainReverse} align-items-md-center justify-content-between gap-6`} data-footer-main="">
      {brandMark()}
      <nav className="ftr-nav" aria-label="Footer">{linkRow(nav)}</nav>
      {socialIcons()}
    </div>
  );

  // T2.2 的 centered + minimal 合成这一个（Chris 2026-09-27，只留居中一种）。间距照 Webpixels footer-4：
  // 各段 `mb-8`，菜单 `fs-5`，版权 `text-sm text-muted`。竖排、居中 ⟹ reverse 没有意义，不翻主容器。
  const stackedBody = () => (
    <div className="d-flex flex-column align-items-center text-center" data-footer-main="">
      <div className="mb-6">{brandMark(true)}</div>
      {tagline('mx-auto mb-8')}
      {nav.length ? <nav className="mb-8" aria-label="Footer">{linkRow(nav, 'justify-content-center fs-5')}</nav> : null}
      {socialIcons('justify-content-center mb-8')}
      {contactLine(['phone', 'address', 'hours'], 'justify-content-center text-sm mb-8')}
      {formPart('mx-auto mb-8 text-start')}
    </div>
  );

  const services = list(data.columns?.services);
  const areas = list(data.columns?.areas);
  const showContactCol = data.columns?.contact === true && contactItems.length > 0;
  const linkCol = (key: string, title: string, items: FooterLink[]) => (
    <div className="col-6 col-lg" key={key} data-footer-col={key}>
      <div className={`fw-semibold mb-3 ${headTone}`}>{title}</div>
      <ul className="list-unstyled vstack gap-2 mb-0">
        {items.map((l, i) => (
          <li key={i}><a className={`${linkTone} text-decoration-none`} href={l.href}>{l.label}</a></li>
        ))}
      </ul>
    </div>
  );
  // `.row` 上的方向工具类同样带 `!important`，所以反向直接用工具类（§mainReverse），不另写规则。
  const columnsBody = () => (
    <div className={`row gy-10 ${reverse ? mainReverse : ''}`} data-footer-main="">
      <div className={`col-12 col-md-4 d-flex flex-column gap-4 ${reverse ? 'align-items-end text-end' : 'align-items-start'}`} data-footer-col="brand">
        {brandMark()}
        {tagline()}
        {/* 联系信息每个排布都在（本地 SEO 资产）：联系列不出（`columns.contact` 不是 true）时，
            电话 / 地址 / 营业时间挂到品牌列里，不让这个排布整个没有联系方式。 */}
        {showContactCol ? null : contactLine(['phone', 'address', 'hours'], '', true)}
        {socialIcons()}
        {formPart('text-start')}
      </div>
      <div className="col-12 col-md-8">
        <div className="row gy-8">
          {services.length ? linkCol('services', COLUMN_TITLES.services, services) : null}
          {areas.length ? linkCol('areas', COLUMN_TITLES.areas, areas) : null}
          {nav.length ? linkCol('pages', COLUMN_TITLES.pages, nav) : null}
          {showContactCol ? (
            <div className="col-6 col-lg" data-footer-col="contact">
              <div className={`fw-semibold mb-3 ${headTone}`}>{COLUMN_TITLES.contact}</div>
              <ul className={`list-unstyled vstack gap-2 mb-0 ${mutedTone}`}>
                {contactItems.map((c) => (
                  <li key={c.key} className="d-flex gap-2">
                    <InlineIcon name={c.icon} icons={iconTable} />
                    {c.href ? <a className={`${linkTone} text-decoration-none`} href={c.href}>{c.text}</a> : <span>{c.text}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  // ── 底栏 ──────────────────────────────────────────────────────────────────────────────────────
  const bottomBar = () => {
    if (layout === 'stacked') {
      return (
        <div className={`d-flex flex-column flex-md-row justify-content-center align-items-center gap-2 column-gap-md-6 text-sm ${mutedTone}`}>
          <span>{copyright}</span>
          {linkRow(legal, 'justify-content-center')}
        </div>
      );
    }
    // row 左边电话 + 城市；columns 左边只有版权。右边版权 / 法务。
    const city = cityOf(contact.address);
    const left = layout === 'row'
      ? (contact.phone || city ? (
        <div className={`d-flex flex-wrap column-gap-4 row-gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          {contact.phone ? (
            <a className={`${linkTone} text-decoration-none d-inline-flex align-items-center gap-2`} href={telHref(contact.phone)}>
              <InlineIcon name="telephone" icons={iconTable} />{contact.phone}
            </a>
          ) : null}
          {city ? <span className="d-inline-flex align-items-center gap-2"><InlineIcon name="geo-alt" icons={iconTable} />{city}</span> : null}
        </div>
      ) : null)
      : <span>{copyright}</span>;
    const right = layout === 'row'
      ? (
        <div className={`d-flex flex-wrap align-items-center column-gap-6 row-gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          <span>{copyright}</span>
          {linkRow(legal)}
        </div>
      )
      : linkRow(legal);
    return (
      <div className={`border-top ${lineTone} mt-10 pt-6 d-flex flex-column flex-md-row justify-content-between gap-3 text-sm ${mutedTone} ${reverse ? 'flex-md-row-reverse' : ''}`}>
        {left}
        {right}
      </div>
    );
  };

  const body = layout === 'stacked' ? stackedBody() : layout === 'columns' ? columnsBody() : rowBody();

  const footerBlock = { ...(block || {}), type: 'footer-new', shape } as BlockConfig;
  const rootClass = [
    // 填了 `bg` 就不挂 `bg-body`：Webpixels 的背景工具类带 `!important`，会压过下面 style 上的底色。
    bgStyle ? (dark ? 'text-white' : '') : 'bg-body',
    'border-top',
    lineTone,
    `ftr-layout-${layout}`,
    `ftr-cta-${ctaKind}`,
    reverse ? 'ftr-reverse' : '',
  ].filter(Boolean).join(' ');

  return (
    <footer {...blockAttrs('footer-new', footerBlock)} className={rootClass} data-preset={preset} style={bgStyle}>
      <div className={`container-lg ${layout === 'stacked' ? 'py-16 py-lg-20' : 'py-12'}`}>
        {ctaStrip()}
        {body}
        {bottomBar()}
      </div>
    </footer>
  );
}
