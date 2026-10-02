'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// header-new —— 顶栏，Webpixels / Bootstrap 那一套（#1424 T2.1 → #1462 定稿第 2 版，总纲 #1422）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **还没进正式库**（manifest `staging: true`）。客户站只有 Tailwind、没有 Bootstrap 的 CSS，这个块
//    上了客户站就是一坨没样式的 HTML（设计稿 B1）。所以它是外壳区块（`region: true`）：不进
//    `registry.generated.ts`、不进 Puck、不进 AI 的提示词；今天唯一渲染它的地方是单格页 `/__catalog`，
//    而那条路由自己加载 `/site.css`。T3 删旧库时它改名成 `header`、接回 `SiteShell`。
//
// 🔴 **一份 markup + 两个旋钮 + 一个归预设管的开关 + 七个预设**（#1462 → #1468，Chris 2026-09-28 图册）。
//    旋钮 `logo`（left | center | right）· `menu`（beside | center | split | gathered | below），声明在 manifest 的
//    `slots.options.knobs`；`topbar` 是布尔开关（顶条放什么是内容，旋钮只管有没有），跟 icons 并排。
//    预设是「旋钮 + topbar」组合起的名，表在顶层 `presets`（`{ name, shape, knobs, options: { topbar } }`，header 的
//    name 与形态目录名 shape 相同）。形态名只决定**初值**：`options` 里写了旋钮 / topbar 就按写的画
//    （§resolveKnobs），不成立的组合由 `scripts/lib/header-knobs.js` 纠正 —— 工具栏和这里用的是同一个函数。
//    排版由旋钮派生成根上的三个类（`hdr-logo-*` / `hdr-menu-*` / `hdr-topbar-on|off`），几何在
//    `blocks/header-new/block.css`；这里只决定「每一格里放什么」。`logo=right` 就是 logo 在右的镜像（#1468 前
//    是一个布尔修饰，已退役）：网格两格对调、紧凑条反向、顶条两段对调都在 block.css；markup 里只有顶条那两行
//    挂一个 `hdr-flip`（它们不是网格格子，CSS 要一个钩子）。
//
// 🔴 **折叠点 992**（`lg`）：iPad（768–991）跟手机一样是 logo ·（topbar 开时）电话图标 · 汉堡 +
//    抽屉 —— 真实站的菜单项是「Brake repair and diagnostics」这种长度，820 宽必折行（T2.1 验收截图）。
//
// 🔴 **排版只走 Webpixels 的工具类**（总纲约束 3），工具类表达不了的（网格列宽、每格落哪一栏、
//    logo=right 换栏、992 起才显示的那几段）在 block.css。
//
// 🔴 **底色 = 颜色槽 `bg`**（#1476，原来是开关；同 footer-new #1469）：任意 `#rrggbb`、`brand`（主题主色）或渐变
//    `{ stops: [2–3 个色], angle }`，字色按背景亮度自动反白 —— 判亮度、写成 CSS 都走 `scripts/lib/contrast.js`
//    （§toneForBg / §bgCss），跟 footer-new / cta-new 同一份，这里不另算。没填 = 改前的浅底那一份，逐字相同。
//
// 🔴 **抽屉的展开 / 收起是 Bootstrap Collapse**（#1514，Chris 2026-10-01：HTML 的交互归 bootstrap.js）：汉堡按钮只写
//    `data-bs-toggle="collapse"` + `data-bs-target`，抽屉一直在 HTML 里、挂 `.collapse`，藏 / 显 / 动画 / `aria-expanded`
//    全是 Bootstrap 的事；模块按需加载（`src/components/BootstrapJs.tsx` §loadBootstrap('collapse')）。Collapse 自己
//    不管 Esc，所以下面挂了一个 keydown 调它的 hide —— 这是本文件里唯一一行事件处理。
//    深底上的字色仍是工具类（`link-light` / `text-white`），不是 Bootstrap 的 `data-bs-theme`。
// 🔴 **不挂 `.navbar-collapse`，也不给 nav 挂 `.navbar-expand-*`**：#1514 复现过 ——Webpixels 的
//    `.navbar-expand-lg .navbar-collapse { display: flex !important }` 住在 `@media (min-width: 992px)` 里，<992 它
//    不开火、Collapse 照常工作；≥992 它会把收起的抽屉强行撑成 flex。抽屉在 ≥992 本来就该不见（`d-lg-none`），
//    所以只用裸的 `.collapse`，那条规则就跟它无关。做图册时真正踩到的是另外两件事（#1514 都量过）：
//    ① 源码里没出现过 `collapse` 这个类名，`public/site.css` 把 `.collapse:not(.show){display:none}` 整条 purge 掉了
//       （实测 0 条）—— 抽屉藏不住。类名现在在源码里（这里 + BootstrapJs.tsx 的 BOOTSTRAP_RUNTIME_CLASSES），purge 留得住。
//    ② Tailwind 有一个同名工具类 `.collapse { visibility: collapse }`（`app/layout.css`），源码一出现 collapse 它就生成
//       —— 抽屉打开了（display: block、高 344px）也看不见。block.css 给 `.hdr-drawer.collapse` 顶回 `visibility: visible`，
//       T4（#1426）Tailwind 退场后那条可以删。
//    紧凑那一条和桌面那一格仍是两个元素，各自在自己的断点上显示。
//
// 🔴 **图标是内联 SVG，不是字体**（#1462，Chris 拍板）：`iconTable` 由服务端按名查好传进来
//    （`scripts/lib/icons.js`），这里用 `InlineIcon` 画；查不到的名字不画。

import { useEffect, useRef, type ReactNode } from 'react';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import { loadBootstrap } from '@/components/BootstrapJs';
import SiteLink from '@/components/SiteLink';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import manifest from './manifest.json';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';
import {
  couplingOf, knobsOf, normalizeKnobs, presetForShape, presetOf, presetsOf,
} from '../../scripts/lib/header-knobs.js';

type Show = 'text' | 'icon' | 'both';
type CtaStyle = 'solid' | 'outline' | 'link';

export type Logo = 'left' | 'center' | 'right';
export type Menu = 'beside' | 'center' | 'split' | 'gathered' | 'below';

export interface NavItem { label: string; href: string; icon?: string; show?: Show }
export interface Cta { label: string; href: string; style?: CtaStyle }
export interface TopbarContact { icon?: string; text: string; href?: string }
export interface TopbarLink { label: string; href: string; icon?: string }
export interface HeaderOptions {
  /** 只是标签：旋钮跟某个预设吻合就是它的名，否则 `custom`。渲染不读它。 */
  preset?: string;
  logo?: Logo;
  menu?: Menu;
  /** 归预设管的开关：没写就跟形态（= 预设）走。 */
  topbar?: boolean;
  icons?: boolean;
}

export interface HeaderNewData {
  logo?: string;
  brandName?: string;
  nav?: NavItem[];
  ctaPrimary?: Cta;
  ctaSecondary?: Cta;
  topbar?: { contact?: TopbarContact[]; links?: TopbarLink[]; social?: TopbarLink[] };
  /** 底色（§文件头）。没填 = 浅底。 */
  bg?: BgValue;
  options?: HeaderOptions;
}

export interface HeaderKnobs { logo: Logo; menu: Menu }

const KNOBS = knobsOf(manifest);
const PRESETS = presetsOf(manifest);
const COUPLING = couplingOf(manifest);
export const DEFAULT_PRESET = 'logo-left';

/**
 * 形态名（= 预设名）给初值，`options` 里写着的旋钮 / topbar 盖上去，再纠正一次。形态名不认识就落回 `logo-left`。
 * 🔴 纠正时不知道「刚拧的是哪个」⟹ logo 为准（header-knobs.js 文件头）：logo=center + menu=beside ⟹ split。
 */
export function resolveKnobs(shape: string | undefined, options: HeaderOptions = {}): { knobs: HeaderKnobs; topbar: boolean; preset: string; shape: string } {
  const hit = (shape && presetForShape(PRESETS, shape)) || presetForShape(PRESETS, DEFAULT_PRESET);
  const known = hit ? hit.shape : DEFAULT_PRESET;
  const base = hit ? { ...hit.knobs } : {};
  const given: Record<string, unknown> = {};
  for (const k of KNOBS) if (options[k.name as keyof HeaderOptions] !== undefined) given[k.name] = options[k.name as keyof HeaderOptions];
  const knobs = normalizeKnobs({ ...base, ...given }, { knobs: KNOBS, presets: PRESETS, coupling: COUPLING, base }) as unknown as HeaderKnobs;
  const topbar = typeof options.topbar === 'boolean' ? options.topbar : !!(hit && hit.options && hit.options.topbar === true);
  return { knobs, topbar, preset: presetOf({ ...knobs, topbar }, { knobs: KNOBS, presets: PRESETS }), shape: known };
}

// `onBrand`：主色底上主色按钮看不见 ⟹ 实心那种翻成白底主色字（hero-new / cta-new 同一条；样式在 block.css
// §hdr-cta-on-brand）。
function ctaClass(style: CtaStyle | undefined, deep: boolean, onBrand = false): string {
  if (style === 'link') return deep ? 'btn btn-link link-light' : 'btn btn-link';
  if (style === 'outline') return deep ? 'btn btn-outline-light' : 'btn btn-outline-primary';
  return onBrand ? 'btn btn-primary hdr-cta-on-brand' : 'btn btn-primary';
}

interface Props {
  data?: HeaderNewData;
  /** 形态名 = 预设名；没给或不认识就落回 `logo-left`。今天只有单格页传它（T3 接回站点时由构建期算好）。 */
  shape?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

type CollapseCtor = { getInstance(el: Element): { hide(): void } | null };

export default function HeaderNewSection({ data = {}, shape: shapeIn, block, iconTable = {} }: Props) {
  // 抽屉 = Bootstrap Collapse（§文件头）。按钮和抽屉靠这个 id 对上；一页只有一个顶栏，块没 id 就叫 main。
  const drawerId = `hdr-drawer-${(block && block.id) || 'main'}`;
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const loaded = loadBootstrap('collapse') as Promise<{ default: CollapseCtor }>;
    // Collapse 的 data-api 不管 Esc（Modal / Offcanvas 才管）：抽屉开着时按 Esc 关掉它，关的动作仍交给 Bootstrap。
    const onKey = (e: KeyboardEvent) => {
      const el = drawerRef.current;
      if (e.key !== 'Escape' || !el || !el.classList.contains('show')) return;
      void loaded.then((m) => m.default.getInstance(el)?.hide());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const opts = data.options || {};
  const { knobs, topbar: hasTopbar, preset, shape } = resolveKnobs(shapeIn, opts);
  const { logo, menu } = knobs;
  const { icons = false } = opts;
  const tone = toneForBg(data.bg);
  const deep = tone !== 'light';
  const bgValue = bgCss(data.bg);
  const bgStyle = bgValue ? { background: bgValue } : undefined;
  const onBrand = tone === 'brand';
  const right = logo === 'right';
  const nav = Array.isArray(data.nav) ? data.nav : [];
  const half = Math.ceil(nav.length / 2);
  const topbar = data.topbar || {};
  // #1520：`href` 不是字符串（半截的引用写法 `{icon, text, href: {source: "phone"}}`，校验会报）⟹ 按没有链接画 ——
  // 不拿对象去调 `startsWith`（下面 `phone` 那一行），也不把它塞进 `<SiteLink href>`（画出来是 `[object Object]`）。
  // 这一行在 `hasTopbar` 门外，所以不是数组、或数组里有 null 的坏数据也要在这里挡掉（r2，QA1）：
  // 改前它们只在 topbar 开着时才被碰到，关着的预设照常渲染 —— 不能因为挪到门外就变成页面崩。
  const contact = (Array.isArray(topbar.contact) ? topbar.contact : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => (typeof c.href === 'string' ? c : { ...c, href: undefined }));
  const links = topbar.links || [];
  const social = topbar.social || [];
  const phone = hasTopbar ? contact.find((c) => c.href && c.href.startsWith('tel:')) : undefined;
  const ctas = [data.ctaPrimary, data.ctaSecondary].filter((c): c is Cta => !!c && !!c.label);
  const brand = data.brandName || '';

  const linkTone = deep ? 'link-light' : '';
  const subTone = deep ? 'link-light' : 'link-secondary';
  // 深底上的弱化文字不用半透明灰：白 .92（`block.css` §hdr-muted-on-deep，照 footer-new 那条同形的规则）。
  const mutedTone = deep ? 'hdr-muted-on-deep' : 'text-body-secondary';
  const lineTone = deep ? 'border-secondary' : '';
  const icon = (name?: string, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;

  const navItem = (item: NavItem, key: string, vertical = false) => {
    // 图标查不到就按「只有字」画 —— 不然 `show: icon` 的那一项会变成一个看不见的链接。
    const show: Show = icons && item.icon && iconTable[item.icon] ? (item.show || 'both') : 'text';
    return (
      <li key={key}>
        <SiteLink className={`nav-link d-inline-flex align-items-center gap-2 ${linkTone}`} href={item.href}>
          {show !== 'text' ? icon(item.icon) : null}
          <span className={show === 'icon' && !vertical ? 'visually-hidden' : undefined}>{item.label}</span>
        </SiteLink>
      </li>
    );
  };

  const navList = (items: NavItem[], key: string) => (
    <ul className="navbar-nav flex-row flex-wrap column-gap-4 column-gap-xl-6 row-gap-1" key={key}>
      {items.map((it, i) => navItem(it, `${key}-${i}`))}
    </ul>
  );

  const ctaButtons = (key: string) => (
    <div className="d-flex align-items-center gap-2" key={key}>
      {ctas.map((c, i) => (
        <SiteLink key={i} href={c.href} className={`${ctaClass(c.style, deep, onBrand)} text-nowrap`}>{c.label}</SiteLink>
      ))}
    </div>
  );

  const socialIcons = (key: string, extra = '') => (social.length ? (
    <div className={`d-flex align-items-center gap-3 ${extra}`} key={key} data-hdr-part={key}>
      {social.map((s, i) => (
        <SiteLink key={i} href={s.href} className={`${subTone} text-nowrap`} aria-label={s.label}>
          {icon(s.icon && iconTable[s.icon] ? s.icon : 'link-45deg')}
        </SiteLink>
      ))}
    </div>
  ) : null);

  const toolLinks = (key: string) => (links.length ? (
    <div className="d-flex flex-wrap align-items-center column-gap-4 row-gap-1" key={key} data-hdr-part={key}>
      {links.map((l, i) => (
        <SiteLink key={i} href={l.href} className={`${subTone} text-sm text-nowrap`}>{l.label}</SiteLink>
      ))}
    </div>
  ) : null);

  // `compact` = 手机 / iPad 那一条：店名要让位给电话图标和汉堡 —— 可以收缩、可以换成两行，不许把后两个挤到
  // 下一行（QA2 #1462 r1：390 宽 topbar 预设整条折成两行，汉堡掉到第二行最左边；320 宽连 logo-left 也折）。
  // 店名不截断：生意名是这一条上最要紧的字。桌面那三格里仍是一行不收缩。
  const brandLink = (compact = false) => (
    <SiteLink className={`hdr-brand navbar-brand d-inline-flex align-items-center gap-2 m-0 ${compact ? '' : 'flex-shrink-0'} ${deep ? 'text-white' : 'text-heading'}`} href="/">
      {data.logo ? <img src={data.logo} alt="" className="h-rem-8 w-auto flex-shrink-0" /> : null}
      <span className={`fw-semibold ${compact ? 'text-wrap lh-sm' : 'text-nowrap'}`}>{brand}</span>
    </SiteLink>
  );

  // ── 桌面（≥992）三格：`hdr-a` · `hdr-b` · `hdr-c`。每格放什么只由 menu 决定（logo 跟着 menu 走，
  //    纠正之后两者一定成立）；哪格落哪一栏、logo=right 换栏在 block.css。
  const cells: Record<'a' | 'b' | 'c', ReactNode> = { a: null, b: null, c: null };
  if (menu === 'beside') {
    cells.a = brandLink();
    cells.c = <>{navList(nav, 'nav')}{ctaButtons('ctas')}</>;
  } else if (menu === 'center') {
    cells.a = brandLink();
    cells.b = navList(nav, 'nav');
    cells.c = ctaButtons('ctas');
  } else if (menu === 'split' || menu === 'gathered') {
    cells.a = navList(nav.slice(0, half), 'navA');
    cells.b = brandLink();
    cells.c = <>{navList(nav.slice(half), 'navB')}{ctaButtons('ctas')}</>;
  } else {
    cells.a = socialIcons('social');
    cells.b = brandLink();
    cells.c = ctaButtons('ctas');
  }

  const headerBlock = { ...(block || {}), type: 'header-new', shape } as BlockConfig;
  const rootClass = [
    // 填了 `bg` 就不挂 `bg-body`：Webpixels 的背景工具类带 `!important`，会压过 style 上的底色（footer-new 同一条）。
    bgStyle ? (deep ? 'text-white' : '') : 'bg-body',
    'border-bottom',
    lineTone,
    `hdr-logo-${logo}`,
    `hdr-menu-${menu}`,
    `hdr-topbar-${hasTopbar ? 'on' : 'off'}`,
  ].filter(Boolean).join(' ');

  // 抽屉里的联系信息段：电话（可拨）/ 营业时间 / 地址 → Sign in · Create account → 社交（topbar 开时才有）。
  const drawerContact = hasTopbar && (contact.length || links.length || social.length) ? (
    <div className={`border-top ${lineTone} pt-4 vstack gap-3 text-sm`} data-hdr-part="drawer-contact">
      {contact.length ? (
        <ul className={`list-unstyled vstack gap-2 mb-0 ${mutedTone}`} data-hdr-part="drawer-info">
          {contact.map((c, i) => (
            <li key={i} className="d-flex align-items-center gap-2">
              {icon(c.icon)}
              {c.href ? <SiteLink href={c.href} className={`${subTone} text-decoration-none`}>{c.text}</SiteLink> : <span>{c.text}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {toolLinks('drawer-links')}
      {socialIcons('drawer-social')}
    </div>
  ) : null;

  return (
    <header
      {...blockAttrs('header-new', headerBlock)}
      data-bs-theme={bsThemeForBg(data.bg)}
      className={rootClass}
      data-preset={preset}
      data-logo={logo}
      data-menu={menu}
      data-topbar={hasTopbar ? 'on' : 'off'}
      style={bgStyle}
    >
      {hasTopbar ? (
        // 顶条：只在 ≥992 出现（block.css），手机 / iPad 上它的内容折进抽屉。
        <div className={`hdr-topbar border-bottom ${lineTone} py-2 text-sm`}>
          <div className={`container-lg d-flex align-items-center justify-content-between gap-6 ${right ? 'hdr-flip' : ''}`}>
            <div className={`d-flex align-items-center gap-5 ${mutedTone}`}>
              {contact.map((c, i) => (
                <span key={i} className="d-inline-flex align-items-center gap-2 text-nowrap">
                  {icon(c.icon)}
                  {c.href ? <SiteLink href={c.href} className={subTone}>{c.text}</SiteLink> : c.text}
                </span>
              ))}
            </div>
            <div className={`d-flex align-items-center gap-5 ${right ? 'hdr-flip' : ''}`}>
              {toolLinks('bar-links')}
              {socialIcons('bar-social')}
            </div>
          </div>
        </div>
      ) : null}

      <nav className="navbar py-4" aria-label="Main">
        {/* < 992：logo ·（topbar 开时）电话圆图标 · 汉堡。logo=right 时整条反过来（block.css）。 */}
        <div className="hdr-compact container-lg d-flex flex-nowrap d-lg-none align-items-center justify-content-between gap-3">
          {brandLink(true)}
          <div className="d-flex flex-shrink-0 align-items-center gap-2">
            {phone ? (
              <a /* #1508：phone 只取 tel: 开头的那一项（见 const phone），不受 basePath 影响，保持裸 <a> */
                href={phone.href}
                className={`hdr-phone btn btn-sm ${deep ? 'btn-outline-light' : 'btn-outline-primary'} rounded-circle d-inline-flex align-items-center justify-content-center p-0 w-rem-10 h-rem-10`}
                aria-label={`Call ${phone.text}`}
              >
                {icon('telephone')}
              </a>
            ) : null}
            {/* 汉堡：Bootstrap Collapse 的触发器 —— 它自己翻 aria-expanded / .collapsed；两枚图标都在，哪枚露出来由
                block.css 按 aria-expanded 定（§hdr-ic-open / hdr-ic-close）。 */}
            <button
              type="button"
              className={`hdr-burger btn px-2 ${deep ? 'text-white' : ''} fs-5 lh-1`}
              data-bs-toggle="collapse"
              data-bs-target={`#${drawerId}`}
              aria-controls={drawerId}
              aria-expanded="false"
              aria-label="Toggle navigation menu"
            >
              <span className="hdr-ic-open d-inline-flex">{icon('list')}</span>
              <span className="hdr-ic-close d-inline-flex">{icon('x-lg')}</span>
            </button>
          </div>
        </div>

        {/* ≥ 992：三格网格（block.css）。 */}
        <div className="hdr-grid container-lg">
          <div className="hdr-a d-flex flex-wrap align-items-center column-gap-4 column-gap-xl-6 row-gap-2">{cells.a}</div>
          <div className="hdr-b d-flex flex-wrap align-items-center column-gap-4 row-gap-2">{cells.b}</div>
          <div className="hdr-c d-flex flex-wrap align-items-center justify-content-end column-gap-4 column-gap-xl-6 row-gap-2">{cells.c}</div>
        </div>

        {menu === 'below' ? (
          <div className={`hdr-below w-100 border-top ${lineTone} mt-4 pt-4`}>
            <div className="container-lg d-flex justify-content-center">{navList(nav, 'nav-row')}</div>
          </div>
        ) : null}
      </nav>

      {/* 抽屉：一直在 HTML 里，开没开由 Bootstrap Collapse 说（`.collapse` 藏、`.show` 显，#1514）；只在 < 992 出现
          （`d-lg-none`）。顺序 = 菜单 → 主 CTA →（topbar 开时）联系信息 → 链接 → 社交。副 CTA 只在 topbar 关时进来：
          有顶条时电话已经在联系信息那一行里。 */}
      <div id={drawerId} ref={drawerRef} className={`hdr-drawer collapse d-lg-none border-top ${lineTone}`} data-hdr-part="drawer">
        <div className="container-lg py-4 vstack gap-4">
          <ul className="navbar-nav" data-hdr-part="drawer-nav">
            {nav.map((it, i) => navItem(it, `m-${i}`, true))}
          </ul>
          <div className="d-grid gap-2" data-hdr-part="drawer-cta">
            {(hasTopbar ? ctas.filter((c) => c === data.ctaPrimary) : ctas).map((c, i) => (
              <SiteLink key={i} href={c.href} className={`${ctaClass(c.style, deep, onBrand)} text-nowrap`}>{c.label}</SiteLink>
            ))}
          </div>
          {drawerContact}
        </div>
      </div>
    </header>
  );
}
