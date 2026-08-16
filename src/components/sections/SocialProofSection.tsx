import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface SocialProofSectionProps {
  data: {
    headline: string;
    overallRating: string;
    totalReviews: string;
    platforms?: { name: string; rating: string; reviews: string }[];
    badges?: string[];
    featuredQuote?: { text: string; author: string };
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F, and the block whose four branches
// disagreed most about WHAT THEY SHOW.
//
// Four looks went out (`badges`, `review-platforms`, `highlight` and the `rating-bar` fallback),
// selected by `data.variant`. Measured before deleting them, per branch and per field — four
// branches, four different field sets, which is the widest spread in this batch:
//
//     rating-bar          headline · overallRating · totalReviews
//     badges              headline · badges
//     review-platforms    headline · platforms
//     highlight           headline · overallRating · featuredQuote
//
// So `block_layout` grows from one value to four: `default` (the rating on its own), plus
// `with-platforms`, `with-badges`, `with-quote`. Nothing converts `variant` into `block_layout`
// (`blocks.js:21-22`, spec D5).
//
// 🔴 BUT THE FOUR FIELD SETS ARE NOT DISJOINT IN REAL DATA, AND THAT CHANGES WHAT THIS BLOCK SHOWS
// TODAY — the loudest consequence in this batch, so it is written here rather than left to be found.
// On the six live sites all 12 instances carry `overallRating` AND `totalReviews`, 11 carry
// `featuredQuote`, 10 carry `platforms`, 6 carry `badges` — while the variant they chose
// (`review-platforms` 6, `highlight` 6) drew exactly one of those. A neutral markup renders what is
// there, so most of these blocks will now show a quote AND the platforms AND the badges where they
// used to show one. The content was always in the page JSON; the old branches were hiding it. If a
// site wants less shown, the answer is to take it out of the page JSON — not to have the component
// silently drop it.
//
// 🔴 THE INVENTED RATING DISTRIBUTION IS GONE, AND IT IS THE BIGGEST THING THIS FILE DELETES. The
// old `rating-bar` branch printed a five-row bar chart from a CONSTANT — `{5: 85%, 4: 10%, 3: 3%,
// 2: 1%, 1: 1%}`, hard-coded in the component, identical on every site that ever used it, with
// `aria-valuenow` on each bar so assistive tech read the invented numbers out as fact. No site's
// data ever reached it. Deleting it is not a migration decision; a stylesheet cannot and must not
// bring it back.
//
// 🔴 THE FIVE STAR SVGs ARE GONE AND THE RATING IS TEXT. Contract §1 refuses tag selectors, so no
// sheet can reach an inline `<svg>`; stars belong on a hook as
// `.social-proof__rating::before { content: ""; background-image: url(data:image/svg+xml,…) }`,
// which is legal (§2 admits `background*`, and `theme-css-lint.js` keeps `data:` URLs legal on
// purpose) and is what the three sheets below do. The accessibility side gets better rather than
// worse: the old markup put the score in an `aria-label` on a `role="img"` div because the stars
// carried no text (#652 had to fight for that label), and now "4.8" and "out of 5" are ordinary
// text that everything can read — screen readers, search engines and AI alike.
//
// 🔴 `/5` AND `reviews` COME FROM THE LOCALE TABLE, NOT FROM THE MARKUP. The old branches wrote
// `{rating}/5 from {n} reviews` and `{n} reviews` in English regardless of the site's language.
// `component-labels.ts` is where the template's own words live; this block now uses it like every
// other block that has words of its own. Two keys were added there — `outOfFive` and `reviews` — in
// all 14 locales rather than in `en` alone: that file's own note says per-key fallback makes the
// English-first shortcut legal, and it is legal, but the fallback's failure is a Chinese page
// quietly printing "reviews", which is the defect being removed here.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ (#1008 AC5) — see `AwardsCertificationsSection.tsx`.
// Live: `review-platforms` 6 · `highlight` 6.
//
// 🔴 THE PARTS ARE FLAT, one level under the block, because CSS grid only places CHILDREN. Each
// platform, each badge and the quote are siblings of the headline, so a sheet can put the score in
// its own column, run the badges along one row, or stack everything — without the markup choosing.
// A platform's own three pieces sit inside it and are laid out by the structure layer in
// `globals.css` (contract §1 refuses tag selectors, so no sheet could reach them anyway).
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('social-proof', block)` (#998's
// `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function SocialProofSection({ data, locale, block }: SocialProofSectionProps) {
  const labels = getLabels(locale);

  return (
    <section
      {...blockAttrs('social-proof', block)}
      className="social-proof"
      aria-labelledby="social-proof-heading"
    >
      <h2 id="social-proof-heading" className="social-proof__headline">
        {data.headline}
      </h2>
      {data.overallRating && (
        <p className="social-proof__rating">
          {data.overallRating} <span>{labels.outOfFive}</span>
        </p>
      )}
      {data.totalReviews && (
        <p className="social-proof__reviews">{data.totalReviews} {labels.reviews}</p>
      )}
      {data.platforms?.map((platform, index) => (
        <div key={index} className="social-proof__platform">
          <span>{platform.name}</span>
          <span>{platform.rating} {labels.outOfFive}</span>
          <span>{platform.reviews} {labels.reviews}</span>
        </div>
      ))}
      {data.badges?.map((badge, index) => (
        <p key={index} className="social-proof__badge">{badge}</p>
      ))}
      {data.featuredQuote && (
        <blockquote className="social-proof__quote">
          <p>{data.featuredQuote.text}</p>
          <footer className="social-proof__quote-author">{data.featuredQuote.author}</footer>
        </blockquote>
      )}
    </section>
  );
}
