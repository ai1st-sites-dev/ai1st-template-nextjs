import Link from 'next/link';

interface HeroSectionProps {
  data: {
    headline: string;
    subheadline: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
    variant?: 'left' | 'centered' | 'split' | 'minimal' | 'video-style' | 'gradient-overlay';
  };
}

export default function HeroSection({ data }: HeroSectionProps) {
  const variant = data.variant || 'left';

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
                <Link href={data.ctaPrimary.href} className="btn-accent text-lg">
                  {data.ctaPrimary.label}
                </Link>
                <Link href={data.ctaSecondary.href} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
                  {data.ctaSecondary.label}
                </Link>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <div className="aspect-square w-full max-w-lg rounded-2xl bg-gradient-to-br from-primary-200 to-accent-200" />
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
              <Link href={data.ctaPrimary.href} className="btn-primary text-lg">
                {data.ctaPrimary.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'video-style') {
    return (
      <section className="relative bg-primary-950 text-white">
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
              <Link href={data.ctaPrimary.href} className="btn-accent text-lg">
                {data.ctaPrimary.label}
              </Link>
              <Link href={data.ctaSecondary.href} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
                {data.ctaSecondary.label}
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
                href={data.ctaPrimary.href}
                className="inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-lg font-semibold text-primary-600 transition-all hover:bg-white/90"
              >
                {data.ctaPrimary.label}
              </Link>
              <Link
                href={data.ctaSecondary.href}
                className="inline-flex items-center justify-center rounded-lg border-2 border-white/60 px-6 py-3 text-lg font-semibold text-white transition-all hover:border-white hover:bg-white/10"
              >
                {data.ctaSecondary.label}
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
              <Link href={data.ctaPrimary.href} className="btn-accent text-lg">
                {data.ctaPrimary.label}
              </Link>
              <Link href={data.ctaSecondary.href} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
                {data.ctaSecondary.label}
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
            <Link href={data.ctaPrimary.href} className="btn-accent text-lg">
              {data.ctaPrimary.label}
            </Link>
            <Link href={data.ctaSecondary.href} className="inline-flex items-center justify-center rounded-lg border-2 border-white px-6 py-3 text-lg font-semibold text-white transition-all hover:bg-white hover:text-primary-900">
              {data.ctaSecondary.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
