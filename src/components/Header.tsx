'use client';

import Link from 'next/link';
import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { brand, defaultLocale, getNavigation, getBrandName, regionLayout } from '@/lib/config';

// TICKET-129: defaultLocale uses root URL alias (no /<locale> prefix).
function localizeHref(href: string, locale: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (locale === defaultLocale) return href;
  if (href === '/') return `/${locale}`;
  return `/${locale}${href}`;
}

// #960 — 这个组件以前只有一个结构,30 套 theme 换下来它一个像素都不动(只有颜色跟着变)。Durable 换装时
// 最抢眼的变化恰恰在顶栏:导航是浮在首屏图上、还是一条实色横条、还是 logo 居中、还是一根胶囊浮条。
//
// 结构从 `regionLayout.header` 来,而它是**构建时**定的(sync-config.js 的 §Regions):
//   · 没换装的站 ⟹ 'solid-bar',也就是这一票之前的样子,一个字节不差
//   · 换了装 ⟹ theme 注册表 supports.header 说了算
//
// 🔴 `transparent-overlay` 只在 `overHero` 为真时真的浮起来。它压的是首屏那张图,而一个 about 页的第一段
// 是 page-header —— 浮上去就是标题被压在横条底下。所以这个判断由**页面**给(SiteShell 的参数),不是这里猜。
// 🔴 `regionLayout.headerScrim` 是构建期那条对比度规则的产物:首屏不能被证明是深底时它为 true,这里加一层
// 半透明深色底。规则本身(以及为什么它写成「能不能证明是深底」而不是一张禁配清单)在 scripts/region-layout.js。

type HeaderProps = { locale: string; overHero?: boolean };

export default function Header({ locale, overHero = false }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { header } = getNavigation(locale);
  const variant = regionLayout.header;
  const floating = variant === 'transparent-overlay' && overHero;

  // 浮层上的字压在深色首屏上 ⟹ 用白字;其余结构都是白底,用深字。
  const onDark = floating;
  const linkClass = onDark
    ? 'text-sm font-medium text-white/90 transition-colors hover:text-white'
    : 'text-sm font-medium text-gray-600 transition-colors hover:text-primary-500';
  const brandTextClass = onDark ? 'text-xl font-bold text-white' : 'text-xl font-bold text-primary-900';
  const burgerClass = onDark
    ? 'inline-flex items-center justify-center rounded-md p-2 text-white md:hidden'
    : 'inline-flex items-center justify-center rounded-md p-2 text-gray-600 md:hidden';

  // 🔴 顶栏上每一个自己带颜色的东西都要跟着 onDark 走。上面三行管的是这个文件里写死 class 的那三样
  // (导航链接 / 公司名 / 汉堡),而顶栏里还有一个**子组件** —— 语言开关 —— 它自己那行字也是写死的深灰。
  // r2 漏的就是它:多语言站上它在顶栏最右,浮层那一支把周围全换成白字、唯独它还是 text-gray-600,
  // 压在深底上 1.08:1(QA3 量的)。单语言站它不渲染 ⟹ 30 张单语言截图和 30 套像素读数里它都不在场。
  // 手机抽屉里的那个不传:抽屉永远是实色白底(见下面 mobileMenu),深字才对。
  const langSwitcher = <LanguageSwitcher currentLocale={locale} onDark={onDark} />;

  const logo = (
    <Link
      href={localizeHref('/', locale)}
      className="flex items-center gap-2"
      aria-label={`${getBrandName(locale)} - Home`}
    >
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt={getBrandName(locale)} className="h-10 w-auto max-w-[160px] object-contain" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500">
          <ServiceIcon icon={brand.logoIcon} className="h-6 w-6 text-white" />
        </div>
      )}
      {/* TICKET-159: render company-name text alongside the logo when the
          logo is icon-only (AI-generated, logoHasWordmark=false) OR when
          there is no logo at all (logoUrl empty). User-uploaded logos are
          assumed to include their own wordmark (logoHasWordmark=true) so
          we skip the duplicate text. */}
      {(!brand.logoUrl || !brand.logoHasWordmark) && <span className={brandTextClass}>{getBrandName(locale)}</span>}
    </Link>
  );

  const navLinks = header.links.map((link) => (
    <Link key={link.href} href={localizeHref(link.href, locale)} className={linkClass}>
      {link.label}
    </Link>
  ));

  const cta = (
    <Link href={localizeHref(header.cta.href, locale)} className="btn-accent text-sm">
      {header.cta.label}
    </Link>
  );

  const burger = (
    <button
      type="button"
      className={burgerClass}
      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      aria-expanded={mobileMenuOpen}
      aria-label="Toggle navigation menu"
    >
      {mobileMenuOpen ? (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      ) : (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
      )}
    </button>
  );

  // 手机上永远是实色抽屉:浮层在小屏上展开菜单,底下是照片,谁也读不了。
  const mobileMenu = mobileMenuOpen && (
    <div className="border-t bg-white px-4 pb-4 pt-2 md:hidden" data-region="header-mobile-menu">
      {header.links.map((link) => (
        <Link key={link.href} href={localizeHref(link.href, locale)} className="block py-2 text-sm font-medium text-gray-600" onClick={() => setMobileMenuOpen(false)}>
          {link.label}
        </Link>
      ))}
      <Link href={localizeHref(header.cta.href, locale)} className="mt-2 block w-full text-center btn-accent text-sm" onClick={() => setMobileMenuOpen(false)}>
        {header.cta.label}
      </Link>
      <div className="mt-2 border-t pt-2">
        <LanguageSwitcher currentLocale={locale} />
      </div>
    </div>
  );

  // ── 透明浮层:压在首屏上方,自己不占高度 ───────────────────────────────────────────────
  if (floating) {
    return (
      <header
        className="absolute inset-x-0 top-0 z-50"
        data-region-layout="transparent-overlay"
        data-region-scrim={regionLayout.headerScrim ? 'on' : 'off'}
      >
        {/* 遮罩:构建期判定首屏不能被证明是深底时才有。它是一条从上往下的深色渐变,深底首屏上几乎看不出来,
            而浅底首屏上正是它让白字还读得出来。
            🔴 浓度是按**最坏情况**定的:首屏是纯白时,导航文字那一行(距顶约 56px)底下要压到 rgb(118) 或更深,
            白字才有 4.5:1(小字的 WCAG AA 线)。r1 那版是 `h-32 from-black/60`,同一处实测只有 **2.38:1** ——
            字没消失,但也谈不上读得清。中间加一个停靠点是为了让文字所在的那一段别掉得太快。 */}
        {regionLayout.headerScrim && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/75 via-black/55 to-transparent" data-region="header-scrim" />
        )}
        <nav className="container-width relative flex items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
          {logo}
          <div className="hidden items-center gap-8 md:flex">
            {navLinks}
            {cta}
            {langSwitcher}
          </div>
          {burger}
        </nav>
        {mobileMenu}
      </header>
    );
  }

  // ── logo 居中,菜单分两侧(桌面;手机退回 logo 左 + 汉堡右) ──────────────────────────────
  if (variant === 'centered-logo') {
    const half = Math.ceil(header.links.length / 2);
    const left = header.links.slice(0, half);
    const right = header.links.slice(half);
    return (
      <header className="sticky top-0 z-50 bg-white shadow-sm" data-region-layout="centered-logo">
        <nav className="container-width flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8 md:grid md:grid-cols-3">
          <div className="hidden items-center gap-6 md:flex">
            {left.map((link) => (
              <Link key={link.href} href={localizeHref(link.href, locale)} className={linkClass}>{link.label}</Link>
            ))}
          </div>
          <div className="flex justify-start md:justify-center">{logo}</div>
          <div className="hidden items-center justify-end gap-6 md:flex">
            {right.map((link) => (
              <Link key={link.href} href={localizeHref(link.href, locale)} className={linkClass}>{link.label}</Link>
            ))}
            {cta}
            {langSwitcher}
          </div>
          {burger}
        </nav>
        {mobileMenu}
      </header>
    );
  }

  // ── 胶囊浮动条:离顶部有间距的一根圆角条(仍然 sticky,自己占高度) ─────────────────────────
  if (variant === 'pill-floating') {
    return (
      <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8" data-region-layout="pill-floating">
        <nav className="container-width flex items-center justify-between rounded-full bg-white px-6 py-3 shadow-lg ring-1 ring-black/5">
          {logo}
          <div className="hidden items-center gap-8 md:flex">
            {navLinks}
            {cta}
            {langSwitcher}
          </div>
          {burger}
        </nav>
        {mobileMenuOpen && (
          <div className="mt-2 rounded-2xl bg-white px-4 pb-4 pt-2 shadow-lg md:hidden" data-region="header-mobile-menu">
            {header.links.map((link) => (
              <Link key={link.href} href={localizeHref(link.href, locale)} className="block py-2 text-sm font-medium text-gray-600" onClick={() => setMobileMenuOpen(false)}>
                {link.label}
              </Link>
            ))}
            <Link href={localizeHref(header.cta.href, locale)} className="mt-2 block w-full text-center btn-accent text-sm" onClick={() => setMobileMenuOpen(false)}>
              {header.cta.label}
            </Link>
            <div className="mt-2 border-t pt-2">
              <LanguageSwitcher currentLocale={locale} />
            </div>
          </div>
        )}
      </header>
    );
  }

  // ── 实色横条(现状,也是没换装时的默认) ──────────────────────────────────────────────────
  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm" data-region-layout="solid-bar">
      <nav className="container-width flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {logo}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks}
          {cta}
          {langSwitcher}
        </div>
        {burger}
      </nav>
      {mobileMenu}
    </header>
  );
}
