import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';

interface NewsletterSignupSectionProps {
  data: {
    headline: string;
    description?: string;
    buttonText?: string;
    variant?: 'inline' | 'card' | 'split' | 'minimal';
  };
  locale: string;
}

export default function NewsletterSignupSection({ data, locale }: NewsletterSignupSectionProps) {
  const labels = getLabels(locale);
  const variant = data.variant || 'inline';
  const buttonText = data.buttonText || labels.subscribe;

  if (variant === 'card') {
    return (
      <section {...blockAttrs('newsletter-signup')} className="bg-gray-50 section-padding" aria-labelledby="newsletter-heading">
        <div className="container-width">
          <div className="mx-auto max-w-lg rounded-2xl bg-white p-10 text-center shadow-lg">
            <h2 id="newsletter-heading" className="text-2xl font-bold text-gray-900">
              {data.headline}
            </h2>
            {data.description && (
              <p className="mt-3 text-gray-600">{data.description}</p>
            )}
            <form action="#" className="mt-6">
              <input
                type="email"
                placeholder={labels.enterYourEmail}
                className="mb-3 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-500"
                aria-label={labels.emailAddress}
                readOnly
              />
              <button
                type="button"
                className="w-full rounded-lg bg-primary-500 py-3 font-semibold text-white transition-colors hover:bg-primary-600"
              >
                {buttonText}
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  if (variant === 'minimal') {
    return (
      <section {...blockAttrs('newsletter-signup')} className="border-y bg-gray-50 py-4" aria-labelledby="newsletter-heading">
        <div className="container-width">
          <form action="#" className="flex flex-col items-center gap-3 sm:flex-row">
            <h2 id="newsletter-heading" className="shrink-0 text-sm font-bold text-gray-900">
              {data.headline}
            </h2>
            <input
              type="email"
              placeholder={labels.enterYourEmail}
              className="w-full max-w-xs rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-500 sm:w-auto"
              aria-label={labels.emailAddress}
              readOnly
            />
            <button
              type="button"
              className="shrink-0 rounded-lg bg-primary-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
            >
              {buttonText}
            </button>
          </form>
        </div>
      </section>
    );
  }

  if (variant === 'split') {
    return (
      <section {...blockAttrs('newsletter-signup')} className="section-padding" aria-labelledby="newsletter-heading">
        <div className="container-width">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 id="newsletter-heading" className="text-3xl font-bold text-gray-900">
                {data.headline}
              </h2>
              {data.description && (
                <p className="mt-4 text-lg text-gray-600">{data.description}</p>
              )}
            </div>
            <div className="rounded-xl bg-gray-50 p-8">
              <form action="#">
                <input
                  type="email"
                  placeholder={labels.enterYourEmail}
                  className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-500"
                  aria-label={labels.emailAddress}
                  readOnly
                />
                <button
                  type="button"
                  className="w-full rounded-lg bg-primary-500 py-3 font-semibold text-white transition-colors hover:bg-primary-600"
                >
                  {buttonText}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Default: inline
  return (
    <section {...blockAttrs('newsletter-signup')} className="bg-primary-500 py-8" aria-labelledby="newsletter-heading">
      <div className="container-width text-center">
        <h2 id="newsletter-heading" className="text-xl font-bold text-white">
          {data.headline}
        </h2>
        {data.description && (
          <p className="mt-2 text-primary-100">{data.description}</p>
        )}
        <form action="#" className="mx-auto mt-4 flex max-w-md">
          <input
            type="email"
            placeholder={labels.enterYourEmail}
            className="flex-1 rounded-l-lg bg-white px-4 py-3 text-gray-500"
            aria-label={labels.emailAddress}
            readOnly
          />
          <button
            type="button"
            className="rounded-r-lg bg-accent-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-accent-600"
          >
            {buttonText}
          </button>
        </form>
      </div>
    </section>
  );
}
