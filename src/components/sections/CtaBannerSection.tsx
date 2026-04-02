import Link from 'next/link';

interface CtaBannerSectionProps {
  data: {
    headline: string;
    description: string;
    button: { label: string; href: string };
    variant?: 'solid' | 'outlined' | 'gradient' | 'split' | 'dark';
  };
}

export default function CtaBannerSection({ data }: CtaBannerSectionProps) {
  const variant = data.variant || 'solid';

  if (variant === 'gradient') {
    return (
      <section className="bg-gradient-to-r from-primary-600 to-accent-500 section-padding" aria-labelledby="cta-heading">
        <div className="container-width text-center">
          <h2 id="cta-heading" className="text-3xl font-bold text-white sm:text-4xl">
            {data.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">
            {data.description}
          </p>
          <div className="mt-8">
            <Link href={data.button.href} className="inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-lg font-semibold text-primary-700 transition-all hover:bg-gray-100">
              {data.button.label}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'split') {
    return (
      <section className="section-padding" aria-labelledby="cta-heading">
        <div className="container-width">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 id="cta-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
                {data.headline}
              </h2>
              <p className="mt-4 max-w-xl text-lg text-gray-600">
                {data.description}
              </p>
            </div>
            <div className="flex items-center justify-center rounded-2xl bg-accent-50 px-8 py-12">
              <Link href={data.button.href} className="btn-primary text-lg">
                {data.button.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'dark') {
    return (
      <section className="relative bg-primary-900 section-padding" aria-labelledby="cta-heading">
        <div className="absolute inset-0 bg-[url('/images/grid-pattern.svg')] opacity-10" />
        <div className="container-width relative text-center">
          <h2 id="cta-heading" className="text-3xl font-bold text-white sm:text-4xl">
            {data.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-300">
            {data.description}
          </p>
          <div className="mt-8">
            <Link href={data.button.href} className="btn-accent text-lg">
              {data.button.label}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'outlined') {
    return (
      <section className="section-padding" aria-labelledby="cta-heading">
        <div className="container-width">
          <div className="rounded-2xl border-2 border-primary-200 bg-primary-50 px-8 py-16 text-center sm:px-16">
            <h2 id="cta-heading" className="text-3xl font-bold text-primary-900 sm:text-4xl">
              {data.headline}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-700">
              {data.description}
            </p>
            <div className="mt-8">
              <Link href={data.button.href} className="btn-primary text-lg">
                {data.button.label}
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-primary-500 section-padding" aria-labelledby="cta-heading">
      <div className="container-width text-center">
        <h2 id="cta-heading" className="text-3xl font-bold text-white sm:text-4xl">
          {data.headline}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-primary-100">
          {data.description}
        </p>
        <div className="mt-8">
          <Link href={data.button.href} className="btn-accent text-lg">
            {data.button.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
