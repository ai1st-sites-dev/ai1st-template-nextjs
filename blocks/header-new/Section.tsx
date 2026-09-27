'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// header-new —— 顶栏，Webpixels / Bootstrap 那一套（#1424，总纲 #1422 的 T2.1）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **还没进正式库**（manifest `staging: true`）。客户站只有 Tailwind、没有 Bootstrap 的 CSS，这个块
//    上了客户站就是一坨没样式的 HTML（设计稿 B1）。所以它是外壳区块（`region: true`）：不进
//    `registry.generated.ts`、不进 Puck、不进 AI 的提示词；今天唯一渲染它的地方是图册 `/__catalog`，
//    而图册那条路由自己加载 `/site.css`。T3 删旧库时它改名成 `header`、接回 `SiteShell`。
//
// 🔴 **一份 markup，6 个形态 = 6 组布局类**（设计稿 B5 对「排布型块」的放宽，本票写进设计稿）。
//    DOM 永远是三个盒子 `[左组] [logo] [右组]`，加一个手机菜单；形态名查下面那张 `SHAPES` 表，
//    得到外层的 flex / grid 类、以及两个组里各放什么。**槽位契约 6 个形态是同一份**（B5 的不变量）。
//
// 🔴 **排版只走 Webpixels 的工具类**（总纲约束 3）。`shape.css` 里只有工具类表达不了的那几条：
//    三栏网格的列宽、`reverse` 时换栏（每格同时钉 `grid-row: 1`）、`.navbar > .container` 的
//    `space-between` 压制。同一个元素的排版不许一半在工具类、一半在 CSS（B4 的推论）。
//
// 🔴 **不用任何 `data-bs-*`**（总纲约束 2）：展开 / 收起是下面那个 `useState`，深底是工具类
//    （`bg-dark` / `link-light` / `text-white`），不是 Bootstrap 的 `data-bs-theme`。
//    也不用 `.navbar-collapse` / `.navbar-expand-*`：这两个一起用时 Webpixels 的
//    `.navbar-expand-md .navbar-collapse { display: flex !important }` 会压过 `d-md-none`
//    （做图册时踩到的坑 1）。桌面那份和手机那份是两个元素，各自用 `d-none d-md-flex` / `d-md-none`。

import { useState } from 'react';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

type Show = 'text' | 'icon' | 'both';
type CtaStyle = 'solid' | 'outline' | 'link';

export interface NavItem { label: string; href: string; icon?: string; show?: Show }
export interface Cta { label: string; href: string; style?: CtaStyle }
export interface TopbarContact { icon?: string; text: string; href?: string }
export interface TopbarLink { label: string; href: string; icon?: string }
export interface HeaderOptions { dark?: boolean; icons?: boolean; reverse?: boolean }

export interface HeaderNewData {
  logo?: string;
  brandName?: string;
  nav?: NavItem[];
  ctaPrimary?: Cta;
  ctaSecondary?: Cta;
  topbar?: { contact?: TopbarContact[]; links?: TopbarLink[]; social?: TopbarLink[] };
  options?: HeaderOptions;
}

/** 左右两组里各放什么。`navA` / `navB` 是菜单切成的前后两半（logo 居中的两个形态）。 */
type Part = 'nav' | 'navA' | 'navB' | 'ctas' | 'social' | 'links';

interface ShapeLayout {
  /** 外层（`.container`）的类：flex 还是网格、网格那一族叫什么（列宽在 shape.css）。 */
  row: string;
  left: Part[];
  right: Part[];
  /** 两层的形态：`bar` = 上面一条联系信息 / 工具链接 / 社交的顶条；`nav` = 菜单单独占下面一行。 */
  stack?: 'bar' | 'nav';
}

// ── 形态 → 布局类（本票的核心，T2.n 的排布型块照这个样子写）─────────────────────────────────────
// 🔴 `hdr-grid` 那四个形态手机上仍是 `.navbar > .container` 的 flex（logo 回到左边、汉堡在右），
//    768 起才变三栏网格 —— 网格的 display / 列宽 / 每格落在哪一栏整段在各形态的 shape.css 里，
//    不拆一半给 `d-md-grid`（同一个元素的排版只许一个来源，B4 的推论）。断点规矩「居中 logo 的
//    两个形态手机上 logo 回到左边」就是这一条说的。flex 那两个形态外层不加类。
export const SHAPES: Record<string, ShapeLayout> = {
  'logo-left': { row: '', left: [], right: ['nav', 'ctas'] },
  'menu-center': { row: 'hdr-grid', left: ['nav'], right: ['ctas'] },
  'logo-center-split': { row: 'hdr-grid', left: ['navA'], right: ['navB', 'ctas'] },
  'logo-center-gathered': { row: 'hdr-grid', left: ['navA'], right: ['navB', 'ctas'] },
  'stacked-topbar': { row: '', left: [], right: ['nav', 'ctas'], stack: 'bar' },
  'stacked-centered': { row: 'hdr-grid', left: ['social'], right: ['links', 'ctas'], stack: 'nav' },
};
export const DEFAULT_SHAPE = 'logo-left';

function ctaClass(style: CtaStyle | undefined, dark: boolean): string {
  if (style === 'link') return dark ? 'btn btn-link link-light' : 'btn btn-link';
  if (style === 'outline') return dark ? 'btn btn-outline-light' : 'btn btn-outline-primary';
  return 'btn btn-primary';
}

interface Props {
  data?: HeaderNewData;
  /** 形态名；没给或不认识就落回 `logo-left`。今天只有图册传它（T3 接回站点时由构建期算好）。 */
  shape?: string;
  block?: BlockConfig;
}

export default function HeaderNewSection({ data = {}, shape: shapeIn, block }: Props) {
  const [open, setOpen] = useState(false);
  const shape = shapeIn && SHAPES[shapeIn] ? shapeIn : DEFAULT_SHAPE;
  const layout = SHAPES[shape];
  const { dark = false, icons = false, reverse = false } = data.options || {};
  const nav = Array.isArray(data.nav) ? data.nav : [];
  const half = Math.ceil(nav.length / 2);
  const topbar = data.topbar || {};
  const contact = topbar.contact || [];
  const links = topbar.links || [];
  const social = topbar.social || [];
  const ctas = [data.ctaPrimary, data.ctaSecondary].filter((c): c is Cta => !!c && !!c.label);
  const brand = data.brandName || '';

  const linkTone = dark ? 'link-light' : '';
  const mutedTone = dark ? 'text-white-50' : 'text-body-secondary';

  const navItem = (item: NavItem, key: string, vertical = false) => {
    const show: Show = icons && item.icon ? (item.show || 'both') : 'text';
    return (
      <li key={key}>
        <a className={`nav-link d-inline-flex align-items-center gap-2 ${linkTone}`} href={item.href}>
          {show !== 'text' ? <i className={`bi bi-${item.icon}`} aria-hidden="true" /> : null}
          <span className={show === 'icon' && !vertical ? 'visually-hidden' : undefined}>{item.label}</span>
        </a>
      </li>
    );
  };

  const navList = (items: NavItem[], key: string) => (
    <ul className="navbar-nav flex-row flex-wrap column-gap-3 column-gap-lg-5 row-gap-1" key={key}>
      {items.map((it, i) => navItem(it, `${key}-${i}`))}
    </ul>
  );

  // 副 CTA 在 iPad（768–991）上藏起来：`d-none d-lg-inline-block`。主 CTA 三端都在。
  const ctaButtons = (key: string) => (
    <div className="d-flex align-items-center gap-2" key={key}>
      {ctas.map((c, i) => (
        <a
          key={i}
          href={c.href}
          className={`${ctaClass(c.style, dark)} text-nowrap ${i === 1 ? 'd-none d-lg-inline-block' : ''}`}
        >
          {c.label}
        </a>
      ))}
    </div>
  );

  const socialIcons = (key: string) => (
    <div className="d-flex align-items-center gap-3" key={key}>
      {social.map((s, i) => (
        <a key={i} href={s.href} className={`${dark ? 'link-light' : 'link-secondary'} text-nowrap`} aria-label={s.label}>
          <i className={`bi bi-${s.icon || 'link-45deg'}`} aria-hidden="true" />
        </a>
      ))}
    </div>
  );

  const toolLinks = (key: string) => (
    <div className="d-flex align-items-center gap-4" key={key}>
      {links.map((l, i) => (
        <a key={i} href={l.href} className={`${dark ? 'link-light' : 'link-secondary'} text-sm text-nowrap`}>{l.label}</a>
      ))}
    </div>
  );

  const part = (p: Part) => {
    switch (p) {
      case 'nav': return navList(nav, 'nav');
      case 'navA': return navList(nav.slice(0, half), 'navA');
      case 'navB': return navList(nav.slice(half), 'navB');
      case 'ctas': return ctaButtons('ctas');
      case 'social': return socialIcons('social');
      case 'links': return toolLinks('links');
      default: return null;
    }
  };

  const headerBlock = { ...(block || {}), type: 'header-new', shape } as BlockConfig;
  const rootClass = [
    dark ? 'bg-dark text-white' : 'bg-body',
    'border-bottom',
    dark ? 'border-secondary' : '',
    reverse ? 'hdr-reverse' : '',
  ].filter(Boolean).join(' ');

  return (
    <header {...blockAttrs('header-new', headerBlock)} className={rootClass}>
      {layout.stack === 'bar' ? (
        // 顶条：手机上整条不在（电话挪进菜单，变成一条 outline 按钮）。
        <div className={`d-none d-md-block border-bottom ${dark ? 'border-secondary' : ''} py-2 text-sm`}>
          <div className={`container-lg d-flex align-items-center justify-content-between gap-6 ${reverse ? 'flex-row-reverse' : ''}`}>
            <div className={`d-flex align-items-center gap-5 ${mutedTone}`}>
              {contact.map((c, i) => (
                <span key={i} className="d-inline-flex align-items-center gap-2 text-nowrap">
                  {c.icon ? <i className={`bi bi-${c.icon}`} aria-hidden="true" /> : null}
                  {c.href ? <a href={c.href} className={dark ? 'link-light' : 'link-secondary'}>{c.text}</a> : c.text}
                </span>
              ))}
            </div>
            <div className="d-flex align-items-center gap-5">
              {toolLinks('bar-links')}
              {socialIcons('bar-social')}
            </div>
          </div>
        </div>
      ) : null}

      <nav className="navbar py-4" aria-label="Main">
        {/* 🔴 `container-lg` 不是 `container`：后者在 768–991 钉死 720px，6 项菜单 + logo + CTA 塞不下，
            网格那几个形态的菜单会压到 logo 上（820 截图实测）。`container-lg` 在 992 以下是整宽。 */}
        {/* reverse：flex 的两个形态靠 `flex-row-reverse`；网格的四个靠根上的 `hdr-reverse` 换栏（shape.css）。 */}
        <div className={`container-lg ${layout.row} ${reverse && !layout.row ? 'flex-row-reverse' : ''}`}>
          <div className={`hdr-left d-none ${layout.left.length ? 'd-md-flex' : ''} flex-wrap align-items-center column-gap-4 column-gap-lg-6 row-gap-2`}>
            {layout.left.map(part)}
          </div>

          <a className={`hdr-logo navbar-brand d-inline-flex flex-shrink-0 align-items-center gap-2 m-0 ${dark ? 'text-white' : 'text-heading'}`} href="/">
            {data.logo ? <img src={data.logo} alt="" className="h-rem-8 w-auto" /> : null}
            <span className="fw-semibold text-nowrap">{brand}</span>
          </a>

          <div className="hdr-right d-none d-md-flex flex-wrap align-items-center justify-content-end column-gap-4 column-gap-lg-6 row-gap-2">
            {layout.right.map(part)}
          </div>

          <button
            type="button"
            className={`btn d-md-none ${dark ? 'text-white' : ''}`}
            aria-expanded={open}
            aria-label="Toggle navigation menu"
            onClick={() => setOpen(!open)}
          >
            <i className={`bi ${open ? 'bi-x-lg' : 'bi-list'} fs-5`} aria-hidden="true" />
          </button>
        </div>

        {layout.stack === 'nav' ? (
          <div className="container-lg d-none d-md-flex justify-content-center pt-4">
            {navList(nav, 'nav-row')}
          </div>
        ) : null}
      </nav>

      {/* 手机菜单。只在 < 768 出现，开没开由 React 说（总纲约束 2）。副 CTA 在这里三端都在；
          两个 stacked 形态的顶条东西（电话 / 工具链接 / 社交）也折进这里。 */}
      {open ? (
        <div className={`d-md-none border-top ${dark ? 'border-secondary' : ''}`}>
          <div className="container-lg py-4 vstack gap-4">
            <ul className="navbar-nav">
              {nav.map((it, i) => navItem(it, `m-${i}`, true))}
            </ul>
            {layout.stack === 'bar' && contact.length ? (
              <div className="d-grid gap-2">
                {contact.filter((c) => c.href).map((c, i) => (
                  <a key={i} href={c.href} className={`${ctaClass('outline', dark)} text-nowrap`}>
                    {c.icon ? <i className={`bi bi-${c.icon} me-2`} aria-hidden="true" /> : null}
                    {c.text}
                  </a>
                ))}
              </div>
            ) : null}
            {layout.stack === 'nav' ? (
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-4">
                {toolLinks('m-links')}
                {socialIcons('m-social')}
              </div>
            ) : null}
            <div className="d-grid gap-2">
              {ctas.map((c, i) => (
                <a key={i} href={c.href} className={`${ctaClass(c.style, dark)} text-nowrap`}>{c.label}</a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
