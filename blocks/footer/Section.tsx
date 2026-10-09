'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// footer —— 页脚，Webpixels / Bootstrap 那一套（#1455 T2.2 → #1464 定稿第 2 版，总纲 #1422）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **外壳区块**（manifest `region: true`）：不进注册表、不进 Puck、不进提示词；站上由 `SiteShell` 渲染，
//    data 是构建期从 navigation.json + brand.json 派生的那一份（`scripts/lib/shell-data.js`，#1425 T3），
//    形态取主题选择单 `shapes.footer`。单格页 `/__catalog` 直接传 data。
//
// 🔴 **一份 markup + 两个旋钮 + 三个预设**（#1464，Chris 2026-09-27 图册定稿第 2 版，照 header 的做法；
//    #1469 第 3 版加 `brand`；#1648 删掉页脚 CTA 条 —— 页尾号召只由页面里的 CTA 块负责）。
//    旋钮 `layout`（row | stacked | columns）· `brand`（left | right），声明在 manifest 的
//    `slots.options.knobs`；预设是旋钮组合起的名，表在顶层 `presets`（name 与形态目录名 shape 相同）。
//    形态名只决定**初值**：`options` 里写了旋钮就按旋钮画（§resolveKnobs），函数跟工具栏是同一个
//    （`scripts/lib/header-knobs.js`）。footer 没有耦合（manifest 不写 `knobCoupling`）⟹ 任意组合都成立，
//    对不上预设的就是 Custom。根上挂 `ftr-layout-*` 类，工具类表达不了的几条在
//    `blocks/footer/block.css`（不在各预设的 shape.css：Custom 组合没有文件夹）。
//    部件永远是 `[主体] [底栏]`；主体按 layout 分三种排法。
//
// 🔴 **`brand=right`：桌面在左的，小屏就在上**（Chris 2026-09-27；#1469 起它是旋钮 `brand`，原来是开关 `reverse`，
//    画法逐字没变 —— 根上的类名也还叫 `ftr-reverse`）。两个排布的主容器 ≥768 反向（首项 / 品牌列
//    在右），<768 用 `flex-column-reverse` 放到最下；底栏根容器用同一个 `mainReverse`（#1525 补上，原来只翻
//    ≥768）。`columns` 的断点从 T2.2 的 `lg` 改成 `md`（#1464 的真改动）—— 品牌列在 768 起就跟其余列并排，不然「768–991 品牌列在右」无从谈起。
//    导航行 / 社交行 / 底栏里那几处小容器用的是不带断点的 `flex-row-reverse`，任何宽度都翻。
//    🔴 `stacked` 是居中的，`brand` 对它**一处都不起作用**（#1469 AC3：两个值 HTML 相同）—— 原来的 reverse 在
//    stacked 下还会翻导航 / 社交 / 联系 / CTA 行和根上的类，所以判据收在一个变量上（函数体里的 `reverse`），不在各处分别判。
//
// 🔴 **底色 = 颜色槽 `bg`**（#1469，原来是开关 `dark`）：任意 `#rrggbb`、`brand`（主题主色）或渐变
//    `{ stops: [2–3 个色], angle }`，字色按背景亮度自动反白 —— 纯色跟 hero 同一个函数（`scripts/lib/contrast.js`
//    §toneFor，门槛 0.4），渐变按色标平均亮度（§toneForBg，门槛 0.55），不另起一套。没填 = 改前 `dark=false`
//    那一份，逐字相同。
//
// 🔴 **表单 = 槽 `form: { id? }` + 旋钮 `form`（none | teaser | full）**（#1471，跟 hero / contact / cta 同形）：
//    表单是站级资产（`site/<locale>/forms.json`），槽只选一张（空 = 第一张）；露多少只存在 `data.options.form` 一处，
//    经本文件 §resolveKnobs（同一份 manifest 的旋钮表）取实际生效值。3 个预设一律 `form: none`（形态里没给表单留位置）。
//    🔴 #1469 的 `form.mode` 不再读、也不做兼容读：旧值已迁移（#1469 当时它还没上客户站）。
//
// 🔴 **排版只走 Webpixels 的工具类**（总纲约束 3）。Webpixels 的工具类全带 `!important`，要压过它们的
//    规则也得带 `!important` 且 class 数不少于它（票正文那条通用规矩）。
//
// 🔴 **这个块没有 HTML 交互，所以也没有 Bootstrap 的 JS**（#1514 口径：有展开 / 收起 / 滑动 / 关闭这类行为才用
//    bootstrap.js；这里一样都没有）。表单部件跟 hero 共用一份（`src/components/BlockLeadForm.tsx`）：
//    提交 POST `/api/leads`、原地显示 successMessage —— 那是数据往返不是 HTML 交互，这里只决定它挂在哪儿。

import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import SiteLink from '@/components/SiteLink';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import { getLabels } from '@/lib/component-labels';
import type { BlockConfig, SiteFormConfig } from '@/lib/types/config';
import BlockLeadForm from '@/components/BlockLeadForm';
import manifest from './manifest.json';
import { knobsOf, normalizeKnobs, presetForShape, presetOf, presetsOf } from '../../scripts/lib/header-knobs.js';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';
// #1506 —— 电话 → `tel:`、邮箱 → `mailto:` 只有一份（contact 与引用展开 `scripts/lib/item-sources.js` 用的也是它）。
import { mailtoHref, telHref } from '../../scripts/lib/contact-facts.js';

export type Layout = 'row' | 'stacked' | 'columns';
export type BrandSide = 'left' | 'right';
export type FormMode = 'none' | 'teaser' | 'full';

export interface FooterLink { label: string; href: string; icon?: string }
/** #1530 —— `city`：`row` 底栏露「电话 + 城市」读它（`{source: "brand"}` 从 `brand.locations[].city` 展开）；没有就那一格不画，不从地址串猜。 */
export interface FooterContact { phone?: string; address?: string; hours?: string; email?: string; city?: string }
/** #1632 —— 关键词页按服务分组的那几栏（构建从当前页面现算，`scripts/lib/shell-data.js`）；只有 `layout=columns` 画。 */
export interface FooterKeywordGroup { title: string; links: FooterLink[] }
export interface FooterColumns { services?: FooterLink[]; areas?: FooterLink[]; contact?: boolean; keywordGroups?: FooterKeywordGroup[] }
/** #1471 —— 块只选一张站级表单（空 = 第一张）；露多少是旋钮 `options.form`。 */
export interface FooterForm { id?: string }
export interface FooterOptions {
  /** 只是标签：旋钮跟某个预设吻合就是它的名，否则 `custom`。渲染不读它。 */
  preset?: string;
  layout?: Layout;
  brand?: BrandSide;
  /** #1471 —— 表单露多少：none（不画）· teaser（首要字段 + 按钮）· full（整张）。 */
  form?: FormMode;
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
  form?: FooterForm;
  /** #1469 —— 底色：`#rrggbb` · `brand` · 渐变 `{ stops, angle }`；空 = 浅底（`bg-body`）。 */
  bg?: BgValue;
  options?: FooterOptions;
}

export interface FooterKnobs { layout: Layout; brand: BrandSide; form: FormMode }

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


/** 列的固定语义（`columns` 排布专用）。#1640 —— 标题跟着站的语言走（`getLabels` 逐键回落英文，图册没有站的语言 ⟹ 英文演示）。 */
function columnTitles(locale: string) {
  const t = getLabels(locale);
  return { services: t.footerServices, areas: t.footerServiceAreas, pages: t.footerPages, contact: t.footerContact };
}

interface Props {
  data?: FooterNewData;
  /** 形态名 = 预设名；没给或不认识就落回 `slim-row`。今天只有单格页传它。 */
  shape?: string;
  block?: BlockConfig;
  /** #1462 —— 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）；图标画成内联 SVG，不走字体。 */
  iconTable?: IconTable;
  locale?: string;
  /** #1425 —— logo 那个「回首页」链接（同 header 的 `homeHref`）；不传 = `/`。 */
  homeHref?: string;
  /**
   * #1665 —— 页脚表单要的那几样（服务下拉的选项 + `leadFormSite` 那三样），由 `SiteShell` 在服务端取好递进来。
   * 这个块是浏览器端组件，站点内容读不到；以前它自己 import `@/lib/config`。不传 ⟹ 表单用内置默认字段、没有服务下拉。
   */
  leadForm?: { services: { id: string; name: string }[]; siteId: string; leadApi: string; forms: SiteFormConfig[] };
}

export default function FooterNewSection({ data = {}, shape: shapeIn, block, iconTable = {}, locale = 'en', homeHref = '/', leadForm }: Props) {
  const opts = data.options || {};
  const titles = columnTitles(locale);
  const { knobs, preset, shape } = resolveKnobs(shapeIn, opts);
  const { layout } = knobs;
  const brandSide = knobs.brand;
  // §文件头：`stacked` 下 brand 一处都不生效 —— 下面所有「翻不翻」都只读这一个变量。
  const reverse = brandSide === 'right' && layout !== 'stacked';
  const bg = data.bg;
  const tone = toneForBg(bg);
  const dark = tone !== 'light';
  const bgValue = bgCss(bg);
  const bgStyle = bgValue ? { background: bgValue } : undefined;
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter(Boolean) : []);
  const nav = list(data.nav);
  const social = list(data.social);
  const legal = list(data.legal);
  const contact = data.contact || {};
  const brand = data.brandName || '';
  const copyright = data.copyright || `© ${new Date().getFullYear()} ${brand}`;
  const formMode = knobs.form === 'teaser' || knobs.form === 'full' ? knobs.form : null;
  const formId = data.form && typeof data.form.id === 'string' && data.form.id ? data.form.id : undefined;

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
  // `wrap`：只有 `columns` 传 true（#1524）。品牌列在 768 起是 `col-md-4`（768 宽 ~256px），`text-nowrap` 的长店名
  // 按构造画出列外；`brand=right` 时列是 `align-items-end`，画出去的方向是屏幕右边 ⟹ 整页横向滚动（768 / 800 / 820
  // 实测 scrollWidth 793 / 815 / 828）。放开之后只在放不下时才折行，放得下的宽度上一个像素都不变。
  const brandMark = (big = false, wrap = false) => (
    // `flex-shrink-0`：row 一行里它是 flex 项，被挤的时候盒子缩、`text-nowrap` 的店名照样画出去，
    // 压到旁边的链接上（820 实测：reverse 时一直画到页脚外面）。
    <SiteLink className={`d-inline-flex flex-shrink-0 align-items-center gap-2 text-decoration-none ${headTone}`} href={homeHref} data-footer-part="brand">
      {data.logo ? <img src={data.logo} alt="" className="h-rem-8 w-auto" /> : null}
      <span className={`fw-semibold ${big ? 'fs-4' : 'fs-5'} ${wrap ? '' : 'text-nowrap'}`}>{brand}</span>
    </SiteLink>
  );

  const tagline = (extra = '') => (data.tagline
    ? <p className={`${mutedTone} mb-0 mw-sm ${extra}`}>{data.tagline}</p>
    : null);

  const linkRow = (items: FooterLink[], extra = '') => (items.length ? (
    <ul className={`list-unstyled d-flex flex-wrap column-gap-6 row-gap-2 mb-0 ${reverse ? 'flex-row-reverse' : ''} ${extra}`}>
      {items.map((l, i) => (
        <li key={i}><SiteLink className={`${linkTone} text-decoration-none`} href={l.href}>{l.label}</SiteLink></li>
      ))}
    </ul>
  ) : null);

  const socialIcons = (extra = '') => (social.length ? (
    <div className={`d-flex flex-shrink-0 align-items-center gap-4 ${reverse ? 'flex-row-reverse' : ''} ${extra}`}>
      {social.map((s, i) => (
        <SiteLink key={i} href={s.href} className={`${linkTone} fs-5`} aria-label={s.label}>
          <InlineIcon name={s.icon && iconTable[s.icon] ? s.icon : 'link-45deg'} icons={iconTable} />
        </SiteLink>
      ))}
    </div>
  ) : null);

  // 联系信息：每个字段可空、空的不渲染（没有空图标、没有空行）。
  const contactItems = [
    contact.phone ? { key: 'phone', icon: 'telephone', text: contact.phone, href: telHref(contact.phone) } : null,
    contact.address ? { key: 'address', icon: 'geo-alt', text: contact.address } : null,
    contact.hours ? { key: 'hours', icon: 'clock', text: contact.hours } : null,
    contact.email ? { key: 'email', icon: 'envelope', text: contact.email, href: mailtoHref(contact.email) } : null,
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
            {c.href ? <SiteLink className={`${linkTone} text-decoration-none`} href={c.href}>{c.text}</SiteLink> : c.text}
          </span>
        ))}
      </div>
    );
  };

  // 表单部件：`layout=stacked` 在联系一行下、`layout=columns` 在品牌列下、`layout=row` 不渲染；旋钮 `form=none` 不渲染。
  //    `teaser` 沿用 #1464 `inline` 的画法（一个字段 + 按钮一行），`full` 沿用 `stacked`（整张）。
  const formPart = (extra = '') => (formMode ? (
    <div className={`w-100 mw-sm ${extra}`} data-footer-form={formMode}>
      <BlockLeadForm mode={formMode} formId={formId} {...leadForm} locale={locale} idPrefix="ftr" size="sm" tone={tone} />
    </div>
  ) : null);

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
  const keywordGroups = list(data.columns?.keywordGroups).filter((g) => g.title && list(g.links).length);
  const linkCol = (key: string, title: string, items: FooterLink[]) => (
    <div className="col-6 col-lg" key={key} data-footer-col={key}>
      <div className={`fw-semibold mb-3 ${headTone}`}>{title}</div>
      <ul className="list-unstyled vstack gap-2 mb-0">
        {items.map((l, i) => (
          <li key={i}><SiteLink className={`${linkTone} text-decoration-none`} href={l.href}>{l.label}</SiteLink></li>
        ))}
      </ul>
    </div>
  );
  // `.row` 上的方向工具类同样带 `!important`，所以反向直接用工具类（§mainReverse），不另写规则。
  const columnsBody = () => (
    <div className={`row gy-10 ${reverse ? mainReverse : ''}`} data-footer-main="">
      <div className={`col-12 col-md-4 d-flex flex-column gap-4 ${reverse ? 'align-items-end text-end' : 'align-items-start'}`} data-footer-col="brand">
        {brandMark(false, true)}
        {tagline()}
        {/* 联系信息每个排布都在（本地 SEO 资产）：联系列不出（`columns.contact` 不是 true）时，
            电话 / 地址 / 营业时间挂到品牌列里，不让这个排布整个没有联系方式。 */}
        {showContactCol ? null : contactLine(['phone', 'address', 'hours'], '', true)}
        {socialIcons()}
        {formPart('text-start')}
      </div>
      <div className="col-12 col-md-8">
        <div className="row gy-8">
          {services.length ? linkCol('services', titles.services, services) : null}
          {areas.length ? linkCol('areas', titles.areas, areas) : null}
          {nav.length ? linkCol('pages', titles.pages, nav) : null}
          {showContactCol ? (
            <div className="col-6 col-lg" data-footer-col="contact">
              <div className={`fw-semibold mb-3 ${headTone}`}>{titles.contact}</div>
              <ul className={`list-unstyled vstack gap-2 mb-0 ${mutedTone}`}>
                {contactItems.map((c) => (
                  <li key={c.key} className="d-flex gap-2">
                    <InlineIcon name={c.icon} icons={iconTable} />
                    {c.href ? <SiteLink className={`${linkTone} text-decoration-none`} href={c.href}>{c.text}</SiteLink> : <span>{c.text}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      {/* #1632 —— 关键词页栏：现有那行栏下面另起一行，每组一栏。没有就整行不出（不留空行）。 */}
      {keywordGroups.length ? (
        <div className="col-12" data-footer-keywords="">
          <div className="row gy-8">
            {keywordGroups.map((g, i) => (
              <div className="col-6 col-md-4 col-lg-3" key={i} data-footer-col={`kw-${i}`}>
                <div className={`fw-semibold mb-3 ${headTone}`}>{g.title}</div>
                <ul className="list-unstyled vstack gap-2 mb-0">
                  {list(g.links).map((l, j) => (
                    <li key={j}><SiteLink className={`${linkTone} text-decoration-none`} href={l.href}>{l.label}</SiteLink></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
    const city = contact.city || '';
    const left = layout === 'row'
      ? (contact.phone || city ? (
        <div className={`d-flex flex-wrap column-gap-4 row-gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          {contact.phone ? (
            <a /* #1508：tel: 不受 basePath 影响，保持裸 <a> */ className={`${linkTone} text-decoration-none d-inline-flex align-items-center gap-2`} href={telHref(contact.phone)}>
              <InlineIcon name="telephone" icons={iconTable} />{contact.phone}
            </a>
          ) : null}
          {city ? <span className="d-inline-flex align-items-center gap-2"><InlineIcon name="geo-alt" icons={iconTable} />{city}</span> : null}
        </div>
      ) : null)
      // columns + brand=right（#1524）：<768 竖排时法务那一行自己翻到右边（`linkRow` 不带断点的 `flex-row-reverse`），
      // 版权是被拉满整行的块、文字照默认靠左 ⟹ 两行分家。推到右边跟法务、跟品牌列（`align-items-end`）一致；
      // ≥768 它是一行里按内容宽的 flex 项，`text-md-start` 退回原样。
      : <span className={reverse ? 'text-end text-md-start' : undefined}>{copyright}</span>;
    const right = layout === 'row'
      ? (
        <div className={`d-flex flex-wrap align-items-center column-gap-6 row-gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          <span>{copyright}</span>
          {linkRow(legal)}
        </div>
      )
      : linkRow(legal);
    // 根容器跟主容器同一条规矩（§文件头）：≥768 反向，<768 反序叠 —— 桌面在左的那个，小屏在上（#1525）。
    return (
      <div className={`border-top ${lineTone} mt-10 pt-6 d-flex ${mainReverse} justify-content-between gap-3 text-sm ${mutedTone}`} data-footer-bottom="">
        {left}
        {right}
      </div>
    );
  };

  const body = layout === 'stacked' ? stackedBody() : layout === 'columns' ? columnsBody() : rowBody();

  const footerBlock = { ...(block || {}), type: 'footer', shape } as BlockConfig;
  const rootClass = [
    // 填了 `bg` 就不挂 `bg-body`：Webpixels 的背景工具类带 `!important`，会压过下面 style 上的底色。
    bgStyle ? (dark ? 'text-white' : '') : 'bg-body',
    'border-top',
    lineTone,
    `ftr-layout-${layout}`,
    reverse ? 'ftr-reverse' : '',
  ].filter(Boolean).join(' ');

  return (
    <footer {...blockAttrs('footer', footerBlock)} data-bs-theme={bsThemeForBg(bg)} className={rootClass} data-preset={preset} style={bgStyle}>
      <div className={`container-lg ${layout === 'stacked' ? 'py-16 py-lg-20' : 'py-12'}`}>
        {body}
        {bottomBar()}
      </div>
    </footer>
  );
}
