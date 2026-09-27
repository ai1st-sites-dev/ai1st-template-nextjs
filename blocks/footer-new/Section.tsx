'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// footer-new —— 页脚，Webpixels / Bootstrap 那一套（#1455，总纲 #1422 的 T2.2）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **还没进正式库**（manifest `staging: true`），理由同 `header-new`：客户站在 T4 之前没有
//    Bootstrap 的 CSS（设计稿 B1）。它是外壳区块（`region: true`）：不进注册表、不进 Puck、不进
//    提示词；今天唯一渲染它的地方是图册 `/__catalog`。T3 删旧库时它改名成 `footer`、接回 `SiteShell`。
//
// 🔴 **一份 markup，4 个形态 = 4 组布局类**（设计稿 B5 对「排布型块」的放宽，`header-new` 是第一个）。
//    部件永远是 `[品牌] [列] [底栏]`，外加两个可选部件（顶上的 CTA 条、订阅框）；形态名查下面那张
//    `SHAPES` 表，得到主体怎么排、底栏怎么排、订阅框挂哪儿。**槽位契约 4 个形态是同一份**（B5 的不变量）。
//
// 🔴 **排版只走 Webpixels 的工具类**（总纲约束 3）。`shape.css` 里只有工具类表达不了的那几条
//    （Webpixels 的工具类全带 `!important`，要压过它们的规则也得带 `!important` 且 class 数不少于它 ——
//    票正文那条通用规矩）。
//
// 🔴 **不用任何 `data-bs-*`**（总纲约束 2）。订阅框只是表单壳：提交归 React（`onSubmit` 拦下默认行为、
//    发一个 `footer-new:newsletter` 事件占位），收邮件的后端另开票。

import type { FormEvent } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

type BtnStyle = 'solid' | 'outline' | 'link';
type CtaStyle = 'band' | 'bar' | 'row';

export interface FooterLink { label: string; href: string; icon?: string }
export interface FooterButton { label: string; href: string; style?: BtnStyle }
export interface FooterContact { phone?: string; address?: string; hours?: string; email?: string }
export interface FooterColumns { services?: FooterLink[]; areas?: FooterLink[]; contact?: boolean }
export interface FooterCta { style?: CtaStyle; title?: string; subtitle?: string; buttons?: FooterButton[] }
export interface FooterNewsletter { title?: string; blurb?: string; placeholder?: string; buttonLabel?: string }
export interface FooterOptions { dark?: boolean; reverse?: boolean }

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
  newsletter?: FooterNewsletter;
  options?: FooterOptions;
}

/** 订阅框挂在哪儿：品牌列下面 / 联系一行下面 / 按钮下面 / 不渲染（`slim-row` 没地方放）。 */
type NewsletterAt = 'brand' | 'contact' | 'button' | 'none';

interface ShapeLayout {
  /** 主体那一段的排法。 */
  body: 'row' | 'centered' | 'columns' | 'minimal';
  newsletter: NewsletterAt;
  /** 底栏：`split` = 左右两头（768 以下上下叠）；`centered` = 居中一行；`fine` = 一行小字。 */
  bar: 'split' | 'centered' | 'fine';
}

// ── 形态 → 布局（本票的核心，照 `header-new` 的 `SHAPES` 写）────────────────────────────────────────
export const SHAPES: Record<string, ShapeLayout> = {
  'slim-row': { body: 'row', newsletter: 'none', bar: 'split' },
  centered: { body: 'centered', newsletter: 'contact', bar: 'centered' },
  columns: { body: 'columns', newsletter: 'brand', bar: 'split' },
  minimal: { body: 'minimal', newsletter: 'button', bar: 'fine' },
};
export const DEFAULT_SHAPE = 'slim-row';

/** 列的固定语义（`columns` 形态专用）。标题是图册的英文演示；T3 接站时跟着站的语言走。 */
const COLUMN_TITLES = { services: 'Services', areas: 'Service areas', pages: 'Pages', contact: 'Contact' };

function btnClass(style: BtnStyle | undefined, onDark: boolean, large = false): string {
  const size = large ? ' btn-lg' : '';
  if (style === 'link') return `btn btn-link${size} ${onDark ? 'link-light' : ''}`;
  if (style === 'outline') return `btn${size} ${onDark ? 'btn-outline-light' : 'btn-outline-primary'}`;
  return `btn btn-primary${size}`;
}

/** 地址的最后一段当城市（`2150 Yonge St, Toronto` → `Toronto`）：`slim-row` 底栏只露「电话 + 城市」。 */
function cityOf(address: string | undefined): string {
  if (!address) return '';
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

interface Props {
  data?: FooterNewData;
  /** 形态名；没给或不认识就落回 `slim-row`。今天只有图册传它。 */
  shape?: string;
  block?: BlockConfig;
}

export default function FooterNewSection({ data = {}, shape: shapeIn, block }: Props) {
  const shape = shapeIn && SHAPES[shapeIn] ? shapeIn : DEFAULT_SHAPE;
  const layout = SHAPES[shape];
  const { dark = false, reverse = false } = data.options || {};
  const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter(Boolean) : []);
  const nav = list(data.nav);
  const social = list(data.social);
  const legal = list(data.legal);
  const contact = data.contact || {};
  const brand = data.brandName || '';
  const copyright = data.copyright || `© ${new Date().getFullYear()} ${brand}`;
  const cta = data.cta && data.cta.title ? data.cta : null;
  const newsletter = data.newsletter && data.newsletter.buttonLabel ? data.newsletter : null;

  const linkTone = dark ? 'link-light' : 'link-secondary';
  const mutedTone = dark ? 'text-white-50' : 'text-body-secondary';
  const headTone = dark ? 'text-white' : 'text-heading';
  // 深底的分隔线：`border-secondary` 在 Webpixels 里是紫色，深底上画出来是一道紫线 —— 用半透明白。
  const lineTone = dark ? 'border-white border-opacity-10' : '';

  // ── 部件 ──────────────────────────────────────────────────────────────────────────────────────
  const brandMark = (
    // `flex-shrink-0`：slim-row 一行里它是 flex 项，被挤的时候盒子缩、`text-nowrap` 的店名照样画出去，
    // 压到旁边的链接上（820 实测：reverse 时一直画到页脚外面）。
    <a className={`d-inline-flex flex-shrink-0 align-items-center gap-2 text-decoration-none ${headTone}`} href="/">
      {data.logo ? <img src={data.logo} alt="" className="h-rem-8 w-auto" /> : null}
      <span className="fw-semibold fs-5 text-nowrap">{brand}</span>
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
          <i className={`bi ${s.icon ? `bi-${s.icon}` : 'bi-link-45deg'}`} aria-hidden="true" />
        </a>
      ))}
    </div>
  ) : null);

  // 联系信息：每个字段可空、空的不渲染（验收 4：没有空图标、没有空行）。
  const contactItems = [
    contact.phone ? { key: 'phone', icon: 'bi-telephone', text: contact.phone, href: telHref(contact.phone) } : null,
    contact.address ? { key: 'address', icon: 'bi-geo-alt', text: contact.address } : null,
    contact.hours ? { key: 'hours', icon: 'bi-clock', text: contact.hours } : null,
    contact.email ? { key: 'email', icon: 'bi-envelope', text: contact.email, href: `mailto:${contact.email}` } : null,
  ].filter((c): c is { key: string; icon: string; text: string; href?: string } => !!c);

  // `stacked`：竖着一条一行（`columns` 品牌列里那份）。🔴 竖排时不叠 `flex-row-reverse` —— 它跟
  // `flex-column` 都是带 `!important` 的同级工具类，谁赢看样式表里的先后，不看 markup。
  const contactLine = (keys: string[], extra = '', stacked = false) => {
    const items = contactItems.filter((c) => keys.includes(c.key));
    if (!items.length) return null;
    const dir = stacked ? `flex-column ${reverse ? 'align-items-end' : ''}` : `flex-wrap ${reverse ? 'flex-row-reverse' : ''}`;
    return (
      <div className={`d-flex column-gap-6 row-gap-2 ${mutedTone} ${dir} ${extra}`}>
        {items.map((c) => (
          <span key={c.key} className="d-inline-flex align-items-center gap-2">
            <i className={`bi ${c.icon}`} aria-hidden="true" />
            {c.href ? <a className={`${linkTone} text-decoration-none`} href={c.href}>{c.text}</a> : c.text}
          </span>
        ))}
      </div>
    );
  };

  const onSubscribe = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    // 提交后端另开票（票正文「不做」）。这里只把意图交出去，谁接谁处理。
    e.currentTarget.dispatchEvent(new CustomEvent('footer-new:newsletter', { bubbles: true, detail: { email } }));
  };

  const newsletterBox = (at: NewsletterAt, extra = '') => (newsletter && layout.newsletter === at ? (
    <form className={`w-100 mw-sm ${extra}`} onSubmit={onSubscribe} data-footer-newsletter="">
      {newsletter.title ? <div className={`fw-semibold mb-1 ${headTone}`}>{newsletter.title}</div> : null}
      {newsletter.blurb ? <p className={`text-sm ${mutedTone} mb-3`}>{newsletter.blurb}</p> : null}
      <div className="input-group">
        <input
          type="email"
          name="email"
          className="form-control"
          placeholder={newsletter.placeholder || ''}
          aria-label={newsletter.placeholder || newsletter.title || 'Email'}
          required
        />
        <button type="submit" className="btn btn-primary text-nowrap">{newsletter.buttonLabel}</button>
      </div>
    </form>
  ) : null);

  // ── CTA 条（可选部件，顶上）──────────────────────────────────────────────────────────────────
  const ctaButtons = (onDark: boolean, extra = '') => (
    <div className={`d-flex flex-column flex-md-row gap-3 ${extra}`}>
      {list(cta?.buttons).map((b, i) => (
        <a key={i} href={b.href} className={`${btnClass(b.style, onDark, true)} text-nowrap`}>{b.label}</a>
      ))}
    </div>
  );

  const ctaStrip = () => {
    if (!cta) return null;
    const style: CtaStyle = cta.style === 'bar' || cta.style === 'row' ? cta.style : 'band';
    if (style === 'band') {
      return (
        <div className={`border-bottom ${lineTone} py-16 text-center`} data-footer-cta="band">
          <div className="container-lg d-flex flex-column align-items-center gap-4">
            <h2 className={`display-6 mb-0 ${headTone}`}>{cta.title}</h2>
            {cta.subtitle ? <p className={`lead mb-0 mw-lg ${mutedTone}`}>{cta.subtitle}</p> : null}
            {ctaButtons(dark, 'justify-content-center mt-2')}
          </div>
        </div>
      );
    }
    if (style === 'bar') {
      // 深色圆角盒子：页脚本身是深底时换主色，否则深盒子融进深底看不出来。
      return (
        <div className="container-lg pt-12" data-footer-cta="bar">
          <div className={`rounded-3 ${dark ? 'bg-primary' : 'bg-dark'} text-white p-8 d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-6 ${reverse ? 'flex-md-row-reverse' : ''}`}>
            <div>
              <h2 className="h3 mb-1 text-white">{cta.title}</h2>
              {cta.subtitle ? <p className="mb-0 text-white-50">{cta.subtitle}</p> : null}
            </div>
            {ctaButtons(true, 'flex-shrink-0')}
          </div>
        </div>
      );
    }
    return (
      <div className="container-lg" data-footer-cta="row">
        <div className={`border-bottom ${lineTone} py-10 d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-6 ${reverse ? 'flex-md-row-reverse' : ''}`}>
          <div>
            <h2 className={`h3 mb-1 ${headTone}`}>{cta.title}</h2>
            {cta.subtitle ? <p className={`mb-0 ${mutedTone}`}>{cta.subtitle}</p> : null}
          </div>
          {ctaButtons(dark, 'flex-shrink-0')}
        </div>
      </div>
    );
  };

  // ── 主体（按形态）─────────────────────────────────────────────────────────────────────────────
  const rowBody = () => (
    <div className={`d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-6 ${reverse ? 'flex-md-row-reverse' : ''}`}>
      {brandMark}
      <nav className="ftr-nav" aria-label="Footer">{linkRow(nav)}</nav>
      {socialIcons()}
    </div>
  );

  const centeredBody = () => (
    <div className="d-flex flex-column align-items-center text-center gap-5">
      {brandMark}
      {tagline()}
      {nav.length ? <nav aria-label="Footer">{linkRow(nav, 'justify-content-center')}</nav> : null}
      {socialIcons()}
      {contactLine(['phone', 'address', 'hours'], 'justify-content-center')}
      {newsletterBox('contact', 'text-start')}
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
  const columnsBody = () => (
    <div className={`row gy-10 ${reverse ? 'flex-lg-row-reverse' : ''}`}>
      <div className={`col-12 col-lg-4 d-flex flex-column gap-4 ${reverse ? 'align-items-end text-end' : 'align-items-start'}`} data-footer-col="brand">
        {brandMark}
        {tagline()}
        {/* 联系信息每个形态都在（本地 SEO 资产）：联系列不出（`columns.contact` 不是 true）时，
            电话 / 地址 / 营业时间挂到品牌列里，不让这个形态整个没有联系方式。 */}
        {showContactCol ? null : contactLine(['phone', 'address', 'hours'], '', true)}
        {socialIcons()}
        {newsletterBox('brand', 'text-start')}
      </div>
      <div className="col-12 col-lg-8">
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
                    <i className={`bi ${c.icon}`} aria-hidden="true" />
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

  const minimalBody = () => (
    <div className={`d-flex flex-column flex-md-row align-items-md-end justify-content-between gap-8 ${reverse ? 'flex-md-row-reverse' : ''}`}>
      <div className="d-flex flex-column gap-3">
        {data.tagline ? <p className={`h4 mb-0 ${headTone}`}>{data.tagline}</p> : null}
        {contact.phone ? (
          <a className={`display-6 fw-bold text-decoration-none ${headTone}`} href={telHref(contact.phone)}>{contact.phone}</a>
        ) : null}
        {contactLine(['email', 'hours'])}
      </div>
      <div className={`d-flex flex-column gap-4 ${reverse ? 'align-items-md-start' : 'align-items-md-end'}`}>
        {list(cta?.buttons).slice(0, 1).map((b, i) => (
          <a key={i} href={b.href} className={`${btnClass(b.style, dark, true)} text-nowrap`}>{b.label}</a>
        ))}
        {newsletterBox('button')}
        {socialIcons()}
      </div>
    </div>
  );

  const body = () => {
    switch (layout.body) {
      case 'centered': return centeredBody();
      case 'columns': return columnsBody();
      case 'minimal': return minimalBody();
      default: return rowBody();
    }
  };

  // ── 底栏 ──────────────────────────────────────────────────────────────────────────────────────
  const bottomBar = () => {
    if (layout.bar === 'fine') {
      // minimal：一行小字 —— 版权 + 地址。
      return (
        <div className={`border-top ${lineTone} mt-10 pt-6 d-flex flex-wrap column-gap-4 row-gap-1 text-xs ${mutedTone} ${reverse ? 'flex-row-reverse' : ''}`}>
          <span>{copyright}</span>
          {contact.address ? <span>{contact.address}</span> : null}
        </div>
      );
    }
    if (layout.bar === 'centered') {
      return (
        <div className={`border-top ${lineTone} mt-10 pt-6 d-flex flex-column align-items-center gap-2 text-sm ${mutedTone}`}>
          <span>{copyright}</span>
          {linkRow(legal, 'justify-content-center text-sm')}
        </div>
      );
    }
    // split：slim-row 左边电话 + 城市；columns 左边只有版权。右边版权 / 法务。
    const city = cityOf(contact.address);
    const left = layout.body === 'row'
      ? (contact.phone || city ? (
        <div className={`d-flex flex-wrap column-gap-4 row-gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          {contact.phone ? (
            <a className={`${linkTone} text-decoration-none d-inline-flex align-items-center gap-2`} href={telHref(contact.phone)}>
              <i className="bi bi-telephone" aria-hidden="true" />{contact.phone}
            </a>
          ) : null}
          {city ? <span className="d-inline-flex align-items-center gap-2"><i className="bi bi-geo-alt" aria-hidden="true" />{city}</span> : null}
        </div>
      ) : null)
      : <span>{copyright}</span>;
    const right = layout.body === 'row'
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

  const footerBlock = { ...(block || {}), type: 'footer-new', shape } as BlockConfig;
  const rootClass = [
    dark ? 'bg-dark text-white' : 'bg-body',
    'border-top',
    lineTone,
  ].filter(Boolean).join(' ');

  return (
    <footer {...blockAttrs('footer-new', footerBlock)} className={rootClass}>
      {ctaStrip()}
      <div className="container-lg py-12">
        {body()}
        {bottomBar()}
      </div>
    </footer>
  );
}
