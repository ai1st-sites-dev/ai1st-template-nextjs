interface SocialProofSectionProps {
  data: {
    headline: string;
    overallRating: string;
    totalReviews: string;
    platforms?: { name: string; rating: string; reviews: string }[];
    badges?: string[];
    featuredQuote?: { text: string; author: string };
    variant?: 'rating-bar' | 'badges' | 'review-platforms' | 'highlight';
  };
}

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      className={className || 'h-6 w-6'}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}

function StarRating({ rating, size }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-8 w-8' : size === 'sm' ? 'h-4 w-4' : 'h-6 w-6';
  return (
    <div className="flex gap-1 text-accent-500" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon key={i} filled={i < Math.round(rating)} className={sizeClass} />
      ))}
    </div>
  );
}

export default function SocialProofSection({ data }: SocialProofSectionProps) {
  const variant = data.variant || 'rating-bar';
  const ratingNum = parseFloat(data.overallRating) || 0;

  if (variant === 'badges') {
    return (
      <section className="section-padding" aria-labelledby="social-proof-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="social-proof-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
          </div>
          {data.badges && data.badges.length > 0 && (
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.badges.map((badge, index) => (
                <div key={index} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50" aria-hidden="true">
                    <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                  </div>
                  <span className="font-semibold text-gray-900">{badge}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'review-platforms') {
    return (
      <section className="section-padding" aria-labelledby="social-proof-heading">
        <div className="container-width">
          <div className="text-center">
            <h2 id="social-proof-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
              {data.headline}
            </h2>
          </div>
          {data.platforms && data.platforms.length > 0 && (
            <div className="mt-12 flex flex-wrap items-center justify-center gap-8 divide-x divide-gray-200">
              {data.platforms.map((platform, index) => (
                <div key={index} className={`text-center ${index > 0 ? 'pl-8' : ''}`}>
                  <p className="font-bold text-gray-900">{platform.name}</p>
                  <div className="mt-2 flex justify-center">
                    <StarRating rating={parseFloat(platform.rating) || 0} size="sm" />
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{platform.reviews} reviews</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (variant === 'highlight') {
    return (
      <section className="bg-primary-900 section-padding" aria-labelledby="social-proof-heading">
        <div className="container-width">
          <div className="mx-auto max-w-3xl text-center">
            <div className="flex justify-center">
              <StarRating rating={ratingNum} size="lg" />
            </div>
            <p className="mt-4 text-5xl font-extrabold text-white">{data.overallRating}<span className="text-2xl font-normal text-primary-300">/5</span></p>
            <h2 id="social-proof-heading" className="mt-2 text-lg font-medium text-primary-300">
              {data.headline}
            </h2>
            {data.featuredQuote && (
              <div className="mt-10">
                <span className="text-6xl font-serif text-primary-700" aria-hidden="true">&ldquo;</span>
                <blockquote className="mt-2 text-xl leading-relaxed text-white">
                  {data.featuredQuote.text}
                </blockquote>
                <p className="mt-6 text-sm font-medium text-primary-300">
                  &mdash; {data.featuredQuote.author}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Default: rating-bar
  const ratingDistribution = [
    { stars: 5, percent: 85 },
    { stars: 4, percent: 10 },
    { stars: 3, percent: 3 },
    { stars: 2, percent: 1 },
    { stars: 1, percent: 1 },
  ];

  return (
    <section className="section-padding" aria-labelledby="social-proof-heading">
      <div className="container-width">
        <div className="mx-auto max-w-2xl text-center">
          <h2 id="social-proof-heading" className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {data.headline}
          </h2>
          <div className="mt-8 flex justify-center">
            <StarRating rating={ratingNum} size="lg" />
          </div>
          <p className="mt-4 text-2xl font-bold text-gray-900">
            {data.overallRating}/5 from {data.totalReviews} reviews
          </p>
          <div className="mt-10 space-y-3">
            {ratingDistribution.map((row) => (
              <div key={row.stars} className="flex items-center gap-3">
                <span className="w-12 text-right text-sm font-medium text-gray-600">{row.stars} star</span>
                <div className="flex-1 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-3 rounded-full bg-accent-500 transition-all"
                    style={{ width: `${row.percent}%` }}
                    role="progressbar"
                    aria-valuenow={row.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.stars} star: ${row.percent}%`}
                  />
                </div>
                <span className="w-10 text-sm text-gray-500">{row.percent}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
