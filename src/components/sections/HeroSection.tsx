import Link from 'next/link';
import { themeCss } from '@/lib/config';

interface HeroSectionProps {
  data: {
    headline: string;
    subheadline: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
    variant?: 'left' | 'centered' | 'split' | 'minimal' | 'video-style' | 'gradient-overlay'
      | 'light-split' | 'light-editorial' | 'light-showcase';
    imageUrl?: string;
  };
}

export default function HeroSection({ data }: HeroSectionProps) {
  const variant = data.variant || 'left';

  // 🔴🔴 #991 — ONE MARKUP, THREE LOOKS. Phase 1 of the theme-CSS architecture
  // (docs/superpowers/specs/2026-08-12-theme-css-architecture-design.md), proved on hero and on
  // nothing else yet.
  //
  // Everything below this branch is the old world: nine variants, each one a different tree, with the
  // layout written into Tailwind utilities (`lg:grid-cols-2`, `aspect-square`). A new look means new
  // code, and a theme cannot move the picture from the right to the left because the picture's
  // position IS the markup.
  //
  // Here the markup carries meaning only — what each part IS, never where it goes — and a stylesheet
  // in public/themes/ decides the rest. The claim being tested is falsifiable and AC1 is how:
  // build this three times with three different sheets and the HTML must come out byte-for-byte
  // identical apart from the <link>. If any layout decision is still hiding in here, that fails.
  //
  // 🔴 WHY media AND body ARE SIBLINGS AND NOT NESTED: CSS grid only places CHILDREN. Wrapping them in
  // the usual `<div class="container">` would let a sheet stack them but never swap their order or
  // give one of them a different share of the row, which is exactly the difference the three sheets
  // have to show. Flat is not tidiness here, it is the whole mechanism.
  //
  // 🔴 THE ROLE MARKS ARE LOAD-BEARING, NOT DECORATION (spec §4.2). `essential` is what a theme may
  // never hide, and the invariant checker reads the computed display of exactly these attributes —
  // with no `data-role` in the tree that check passes by having nothing to look at.
  //
  // 📌 The old branches stay. Phase 2 moves the remaining blocks one at a time and only then can any
  // of this be deleted; a site with no `css` in its theme.json never reaches this line.
  if (themeCss) {
    return (
      <section className="hero" data-block="hero">
        {/* Decorative only, and empty on purpose: the contract gives sheets ::before/::after on this
            hook to draw with. Anything a reader needs to KNOW belongs in the body below, where the
            structured data and the translations can see it. */}
        <div className="hero__deco" data-role="optional" aria-hidden="true" />
        <div className="hero__media" data-role="optional">
          {data.imageUrl ? (
            <img className="hero__img" src={data.imageUrl} alt={data.headline} />
          ) : null}
        </div>
        <div className="hero__body" data-role="essential">
          <h1 className="hero__title">{data.headline}</h1>
          <p className="hero__sub">{data.subheadline}</p>
          <div className="hero__cta">
            {/* 🔴 The buttons keep the SITE's button classes rather than getting hooks of their own.
                A theme owns layout; what a primary button looks like is the brand's, and it already
                follows the palette through CSS variables (globals.css @layer components). Giving
                sheets a hook here would let one of the 30 themes quietly restyle every call to
                action on the site, which is a much bigger promise than "the picture moves". */}
            <Link href={data.ctaPrimary?.href ?? '#'} className="btn-accent text-lg">
              {data.ctaPrimary?.label}
            </Link>
            <Link href={data.ctaSecondary?.href ?? '#'} className="btn-secondary text-lg">
              {data.ctaSecondary?.label}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'split') {
    return (
      <section className="relative bg-gradient-to-b from-primary-900 via-primary-800 to-primary-700 text-white">
        <div className="absolute inset-0 bg-[url('/images/grid-pattern.svg')] opacity-10" />
        <div className="container-width relative px-4 py-24 sm:px-6 md:py-32 lg:px-8 lg:py-40">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
                {data.headline}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-gray-200 sm:text-xl">
                {data.subheadline}
              </p>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                <Link href={data.ctaPrimary?.href ?? "#"} className="btn-accent text-lg">
                  {data.ctaPrimary?.label}
                </Link>
                <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
                  {data.ctaSecondary?.label}
                </Link>
              </div>
            </div>
            <div className="flex items-center justify-center">
              {data.imageUrl ? (
                <img src={data.imageUrl} alt={data.headline} className="aspect-square w-full max-w-lg rounded-2xl object-cover" />
              ) : (
                <div className="aspect-square w-full max-w-lg rounded-2xl bg-gradient-to-br from-primary-200 to-accent-200" />
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'minimal') {
    return (
      <section className="bg-white">
        <div className="container-width px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              <span className="inline border-b-4 border-accent-500">{data.headline}</span>
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl">
              {data.subheadline}
            </p>
            <div className="mt-12">
              <Link href={data.ctaPrimary?.href ?? "#"} className="btn-primary text-lg">
                {data.ctaPrimary?.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // #959 — 浅底方向的三种写法。两条设计约束：
  //
  // 1. 它们跟深底那五种的区别不能只是颜色：#932 的读回工具把 class 里的颜色 token 归一化掉之后
  //    再比骨架，只换颜色的写法会跟原写法算成同一种结构，读回直接报错不出标注。
  // 2. 主按钮不用 `btn-primary`，改成 primary-700 的深底白字。`btn-primary` 是 primary-500 底白字，
  //    实测在这 10 套用到浅底 hero 的 theme 里有 5 套不到 WCAG AA 4.5:1（arctic-mint 3.17 ·
  //    coastal-teal 3.19 · forest-green 3.30 · assurance-teal 3.95 · sky-clinic 4.10）。
  //    深底 hero 的主按钮是 btn-accent（浅底白字深字），不吃这个问题。primary-700 那一档这 10 套
  //    最低 6.58。📌 `btn-primary` 本身没改 —— 它在别的 section 里也这么用，那是圈外的事。
  const lightPrimaryCta = 'inline-flex items-center justify-center rounded-lg bg-primary-700 px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-primary-800';

  if (variant === 'light-split') {
    return (
      <section className="bg-white">
        <div className="container-width px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-6">
              <div className="h-1 w-12 rounded-full bg-accent-500" />
              <h1 className="mt-8 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
                {data.headline}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-gray-600">
                {data.subheadline}
              </p>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link href={data.ctaPrimary?.href ?? "#"} className={lightPrimaryCta}>
                  {data.ctaPrimary?.label}
                </Link>
                <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center gap-2 px-2 py-3 text-lg font-semibold text-primary-700 transition-colors hover:text-primary-900">
                  {data.ctaSecondary?.label}
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </div>
            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-sm">
                {data.imageUrl ? (
                  <img src={data.imageUrl} alt={data.headline} className="aspect-[4/3] w-full rounded-xl object-cover" />
                ) : (
                  <div className="aspect-[4/3] w-full rounded-xl bg-gradient-to-br from-primary-200 to-accent-200" />
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'light-editorial') {
    return (
      <section className="bg-gray-50">
        <div className="container-width px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              {data.headline}
            </h1>
            <div className="mx-auto mt-10 h-px w-24 bg-gray-400" />
            <p className="mx-auto mt-10 max-w-2xl text-lg leading-loose text-gray-600 sm:text-xl">
              {data.subheadline}
            </p>
            <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href={data.ctaPrimary?.href ?? "#"} className={lightPrimaryCta}>
                {data.ctaPrimary?.label}
              </Link>
              <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center justify-center rounded-lg border border-gray-400 px-6 py-3 text-lg font-semibold text-gray-800 transition-colors hover:border-gray-900 hover:text-gray-900">
                {data.ctaSecondary?.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'light-showcase') {
    return (
      <section className="bg-white">
        <div className="container-width px-4 pt-20 sm:px-6 lg:px-8 lg:pt-24">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              {data.headline}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl">
              {data.subheadline}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href={data.ctaPrimary?.href ?? "#"} className={lightPrimaryCta}>
                {data.ctaPrimary?.label}
              </Link>
              <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center justify-center rounded-lg bg-gray-100 px-6 py-3 text-lg font-semibold text-gray-800 transition-colors hover:bg-gray-200">
                {data.ctaSecondary?.label}
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-16 w-full">
          {data.imageUrl ? (
            <img src={data.imageUrl} alt={data.headline} className="h-[420px] w-full object-cover" />
          ) : (
            <div className="h-[420px] w-full bg-gradient-to-r from-primary-200 via-primary-100 to-accent-200" />
          )}
        </div>
      </section>
    );
  }

  if (variant === 'video-style') {
    return (
      <section className="relative bg-primary-900 text-white">
        <div className="container-width relative px-4 py-28 sm:px-6 md:py-36 lg:px-8 lg:py-44">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white transition-transform hover:scale-110">
              <svg className="ml-1 h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <h1 className="mt-10 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              {data.headline}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-300 sm:text-xl">
              {data.subheadline}
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href={data.ctaPrimary?.href ?? "#"} className="btn-accent text-lg">
                {data.ctaPrimary?.label}
              </Link>
              <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
                {data.ctaSecondary?.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'gradient-overlay') {
    return (
      <section className="relative overflow-hidden bg-gradient-to-br from-primary-600 to-accent-600 text-white">
        {/* Decorative circles */}
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute -bottom-16 right-10 h-56 w-56 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute right-1/3 top-1/4 h-40 w-40 rounded-full bg-white/5" aria-hidden="true" />
        <div className="container-width relative px-4 py-28 sm:px-6 md:py-36 lg:px-8 lg:py-44">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-5xl font-extrabold tracking-tight lg:text-6xl">
              {data.headline}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/90 sm:text-xl">
              {data.subheadline}
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href={data.ctaPrimary?.href ?? "#"}
                className="inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-lg font-semibold text-primary-600 transition-all hover:bg-white/90"
              >
                {data.ctaPrimary?.label}
              </Link>
              <Link
                href={data.ctaSecondary?.href ?? "#"}
                className="inline-flex items-center justify-center rounded-lg border-2 border-white/60 px-6 py-3 text-lg font-semibold text-white transition-all hover:border-white hover:bg-white/10"
              >
                {data.ctaSecondary?.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'centered') {
    return (
      <section className="relative bg-gradient-to-b from-primary-900 via-primary-800 to-primary-700 text-white">
        <div className="absolute inset-0 bg-[url('/images/grid-pattern.svg')] opacity-10" />
        <div className="container-width relative px-4 py-28 sm:px-6 md:py-36 lg:px-8 lg:py-44">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              {data.headline}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-200 sm:text-xl">
              {data.subheadline}
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href={data.ctaPrimary?.href ?? "#"} className="btn-accent text-lg">
                {data.ctaPrimary?.label}
              </Link>
              <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
                {data.ctaSecondary?.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative bg-gradient-to-br from-primary-900 via-primary-800 to-primary-700 text-white">
      <div className="absolute inset-0 bg-[url('/images/grid-pattern.svg')] opacity-10" />
      <div className="container-width relative px-4 py-24 sm:px-6 md:py-32 lg:px-8 lg:py-40">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            {data.headline}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-gray-200 sm:text-xl">
            {data.subheadline}
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link href={data.ctaPrimary?.href ?? "#"} className="btn-accent text-lg">
              {data.ctaPrimary?.label}
            </Link>
            <Link href={data.ctaSecondary?.href ?? "#"} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
              {data.ctaSecondary?.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
