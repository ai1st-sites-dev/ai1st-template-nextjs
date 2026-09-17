'use client';

import Link from 'next/link';
import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import { brand, defaultLocale, getNavigation, getBrandName, regions } from '@/lib/config';

// TICKET-129: defaultLocale uses root URL alias (no /<locale> prefix).
function localizeHref(href: string, locale: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (locale === defaultLocale) return href;
  if (href === '/') return `/${locale}`;
  return `/${locale}${href}`;
}

// 🔴🔴 #1353 — ONE MARKUP. 顶栏从「一变体一棵树」搬进形态层，规矩跟块完全一样（设计文档 D14）。
//
// 走了四棵树：`solid-bar`（实色横条）、`transparent-overlay`（压在首屏上的浮层）、`centered-logo`
// （logo 居中）、`pill-floating`（圆角胶囊浮条）。它们今天是下面这同一副骨架，**排版整段住在
// `public/shapes.css` 的 `[data-block="header"][data-shape="…"]`**，每种形态的间距和皮也在那份文件
// 末尾那一节（**不在主题表** —— 那条明写的例外和它的射程写在 `shapes.css` 的 `#1353` 那一段）。
// 📌 #960 把它们做成四棵树时，块那一层还没有形态层（#1008 之后才有）。D14 把顶栏页脚点成「已知例外」
//    并写明 3.5 步清掉，这就是那一步。
//
// 🔴 这个文件里【一个 Tailwind 响应式类都不许有】（AC2 逐条 grep `(sm|md|lg|xl):`）。手机上汉堡出来、
//    导航收起，这些是**几何**，归 `shapes.css` 的 `@media`；写回这里就等于把刚搬走的那一维搬回来。
//
// 🔴 `regionLayout` 不再从这里读（AC2 也 grep 它）。结构现在跟别的块同一条路：主题的**选择单**
//    （`scripts/theme-pool.json` 的 `shapes.header`）→ 构建期算好 → `regions.header.shape`。
//    `supports.header` 那条老路 #1353 退役了。
//
// 🔴 为什么 `overHero` 这条 JS 判断【留在组件里】而不是变成一种形态：D14 第 3 句把它点名了 ——
//    「透明浮层那种要判『压在 hero 上』的逻辑按本条第 3 句归结构本身」。它问的是**这一页的第一段是不是
//    hero**（about 页第一段是 page-header，浮上去就是标题被压住），页面才知道，CSS 不知道。它落成根
//    元素上的 `data-over-hero`，`shapes.css` 拿它当第三个条件 —— 形态仍然只有四个名字。
//
// 🔴 遮罩（`header__scrim`）**永远在 DOM 里**，显不显示由 CSS 说。D14 第 2 句：可选零件缺席不算
//    HTML 不同；反过来，一个只在某一支里才存在的元素就是「另一棵树」，正是本票要清的东西。
//    它的浓度为什么是那样，写在 `scripts/region-layout.js` 的文件头（白字压纯白首屏的最坏情况）。
type HeaderProps = { locale: string; overHero?: boolean };

export default function Header({ locale, overHero = false }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { header } = getNavigation(locale);
  const shape = regions.header.shape;

  // 浮层压在首屏上时，顶栏的字是白的。这是**这一页**的事（见上面那段），所以它是一个属性，不是一种形态。
  const overlaid = shape === 'transparent-overlay' && overHero;

  // 🔴 语言开关那行字仍然**显式接线**，不靠继承 —— `LanguageSwitcher.tsx` 的头注里记着为什么：
  // #960 r2 漏的就是它，多语言站上它在顶栏最右、压在深底上 1.08:1，而单语言站它根本不渲染，
  // 30 张单语言截图里它从来不在场。手机抽屉里那个不传：抽屉永远是实色白底。
  const langSwitcher = <LanguageSwitcher currentLocale={locale} onDark={overlaid} />;

  const headerBlock = { type: 'header', shape, role: 'essential' } as unknown as BlockConfig;

  return (
    <header
      {...blockAttrs('header', headerBlock)}
      className="header"
      data-over-hero={overlaid ? 'true' : 'false'}
    >
      {/* 遮罩：一条从上往下的深色渐变。只有浮层压在首屏上时 CSS 才把它显出来。 */}
      <div className="header__scrim" data-role="optional" aria-hidden="true" />

      <nav className="header__bar">
        <Link
          href={localizeHref('/', locale)}
          className="header__logo"
          data-role="essential"
          aria-label={`${getBrandName(locale)} - Home`}
        >
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={getBrandName(locale)} className="header__logo-img" />
          ) : (
            <span className="header__logo-mark">
              <ServiceIcon icon={brand.logoIcon} className="header__logo-icon" />
            </span>
          )}
          {/* TICKET-159: icon-only logo（AI 生成、logoHasWordmark=false）或者干脆没有 logo 时，
              旁边补一行公司名；用户自己传的 logo 认为自带字标，不重复。 */}
          {(!brand.logoUrl || !brand.logoHasWordmark) && (
            <span className="header__logo-name">{getBrandName(locale)}</span>
          )}
        </Link>

        <div className="header__nav" data-role="essential">
          {header.links.map((link) => (
            <Link key={link.href} href={localizeHref(link.href, locale)} className="header__link">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="header__cta" data-role="optional">
          <Link href={localizeHref(header.cta.href, locale)} className="btn-accent header__cta-link">
            {header.cta.label}
          </Link>
        </div>

        <div className="header__lang" data-role="optional">{langSwitcher}</div>

        <button
          type="button"
          className="header__burger"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? (
            <svg className="header__burger-icon" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="header__burger-icon" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
          )}
        </button>
      </nav>

      {/* 手机抽屉。永远实色白底：浮层在小屏上展开菜单，底下是照片，谁也读不了。
          🔴 它在 DOM 里恒存在（同上，D14 第 2 句），开没开由 `data-open` 说，显示由 CSS 说 ——
          `mobileMenuOpen` 这个状态是**行为**，行为归块（D14 第 3 句）。 */}
      <div className="header__menu" data-role="optional" data-open={mobileMenuOpen ? 'true' : 'false'}>
        {header.links.map((link) => (
          <Link
            key={link.href}
            href={localizeHref(link.href, locale)}
            className="header__menu-link"
            onClick={() => setMobileMenuOpen(false)}
          >
            {link.label}
          </Link>
        ))}
        <Link
          href={localizeHref(header.cta.href, locale)}
          className="btn-accent header__menu-cta"
          onClick={() => setMobileMenuOpen(false)}
        >
          {header.cta.label}
        </Link>
        <div className="header__menu-lang">
          <LanguageSwitcher currentLocale={locale} />
        </div>
      </div>
    </header>
  );
}
