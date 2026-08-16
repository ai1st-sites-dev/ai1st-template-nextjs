import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ContentSplitSectionProps {
  data: {
    headline: string;
    content: string;
    bullets?: string[];
    stats?: { value: string; label: string }[];
    imageUrl?: string;
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F, and the block with the widest reach
// in it: 51 instances across the six live sites, 8.50 per site, more than any other block this
// batch touches.
//
// Six looks went out (`text-right`, `text-left-stats`, `text-right-list`, `cards-row`,
// `centered-overlay` and the `text-left` fallback), selected by `data.variant`. Measured before
// deleting them, per branch and per field:
//
//     text-left / text-right      headline · content · imageUrl
//     text-left-stats             headline · content · stats
//     text-right-list             headline · content · imageUrl · bullets
//     cards-row                   headline · content · bullets   (sliced to the first 3)
//     centered-overlay            headline · content · bullets
//
// `text-left` and `text-right` are one content shape drawn two ways — the picture moves from one
// side to the other, which is `order` on a grid child and is the whole point of the architecture
// (it is literally the difference between the three phase-1 proof sheets). The other three carry
// DIFFERENT THINGS: a picture, a set of statistics, a list of bullets. That is content structure, so
// it goes to `block_layout` (spec §5.2). Its manifest already declared `with-media` and `text-only`
// from #998; this ticket adds `with-stats` and `with-bullets` — the judgement table PM approved on
// 2026-08-16 named three carriers, and `text-only` is the fourth case (no carrier at all), which was
// already there. Nothing converts `variant` into `block_layout` and nothing should (`blocks.js:21-22`,
// spec D5): they are two coexisting fields, and today no live page writes `block_layout` at all.
//
// 🔴 THE MARKUP RENDERS WHAT THE DATA HAS. `block_layout` is a hook for the sheet; the picture
// appears when there is an `imageUrl`, the bullets when there are bullets, the statistics when there
// are statistics. On the live corpus that is 44 of 51 with a picture, 27 with bullets, 11 with
// statistics — several instances carry more than one, and used to show only the one their variant
// happened to draw.
//
// 🔴 TWO THINGS THIS DELETES ON PURPOSE, both measured rather than argued:
//
//   ① The "Learn more →" line in `text-left` / `text-right`. It was a `<span>`, not a link — no
//      `href`, nothing to click. Two of the six looks drew it and four did not, so a single markup
//      has to choose, and shipping an inert call to action on all 51 instances is the worse half of
//      that choice. `getLabels` is no longer imported here as a result; `locale` is no longer a prop.
//   ② `cards-row`'s `.slice(0, 3)` and its hard-coded English filler ("Learn more about how this
//      helps your business grow and succeed.") printed under every card. The cap is gone, so all
//      the bullets render — more of the page's own content in the DOM, which is the direction this
//      whole architecture is going (search engines and AI read what is in the DOM). The filler is
//      gone because it was never the site's words. One live instance uses `cards-row`.
//
// 🔴 THE PLACEHOLDER GRADIENT IS GONE FROM THE MARKUP, WHICH IS NOT A LOSS. Every old branch drew a
// `<div class="h-80 bg-gradient-to-br …">` when there was no picture. `.content-split__media` is
// always in the tree now and a sheet paints its ground — that is `background*` on a hook, which is
// contract §2's first line. Exactly hero's split (`.hero__media` always present, `<img>` only when
// there is one), and for the same reason: the box is the sheet's, the picture is the content's.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ (#1008 AC5) — see the note in
// `AwardsCertificationsSection.tsx`. Live values, in case a later ticket needs them:
// `text-right-list` 13 · `text-left` 12 · `text-left-stats` 11 · `text-right` 9 ·
// `centered-overlay` 5 · `cards-row` 1.
//
// 🔴 THE PARTS ARE FLAT, one level under the block, because CSS grid only places CHILDREN — the
// media, the headline, the body, the bullet list and the statistics are all siblings. Wrapping text
// in the usual container would let a sheet stack the two but never swap their order or change their
// share of the row, which is the whole mechanism (the note on `HeroSection.tsx` says this at length).
// The `<li>`s and the `<img>` are NOT hooks: contract §1 refuses tag selectors and `.hero__img` is
// deliberately absent for the same reason — the structure layer in `globals.css` owns them, one
// owner per property.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('content-split', block)` (#998's
// `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function ContentSplitSection({ data, block }: ContentSplitSectionProps) {
  return (
    <section
      {...blockAttrs('content-split', block)}
      className="content-split"
      aria-labelledby="content-split-heading"
    >
      <div className="content-split__media">
        {data.imageUrl ? <img src={data.imageUrl} alt={data.headline} /> : null}
      </div>
      <h2 id="content-split-heading" className="content-split__headline">
        {data.headline}
      </h2>
      <p className="content-split__body">{data.content}</p>
      {data.bullets && data.bullets.length > 0 && (
        <ul className="content-split__bullets">
          {data.bullets.map((bullet, index) => (
            <li key={index}>{bullet}</li>
          ))}
        </ul>
      )}
      {data.stats && data.stats.length > 0 && (
        <div className="content-split__stats">
          {data.stats.map((stat, index) => (
            <div key={index} className="content-split__stat">
              <span className="content-split__stat-value">{stat.value}</span>
              <span className="content-split__stat-label">{stat.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
