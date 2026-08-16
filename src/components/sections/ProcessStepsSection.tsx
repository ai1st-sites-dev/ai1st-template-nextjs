import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Step {
  title: string;
  description: string;
}

interface ProcessStepsSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    steps: Step[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1028 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch C.
//
// Five branches went out of here — `horizontal` (the default), `vertical`, `cards`, `zigzag` and
// `icon-strip`. Four of the five read exactly `data.headline` / `data.subheadline` and
// `data.steps[].title` / `.description`.
//
// 🔴 THE FIFTH, `icon-strip`, READ ONE FIELD FEWER: it never rendered `step.description`. That is a
// SUBSET, not a different set — which is why this block stayed in batch C rather than moving to the
// judgement batch with testimonials and announcement-bar (#1031) — but it is not free, and the ticket
// wrote the disposition down rather than leaving it to be found: the markup below takes the UNION, so
// a site that used to wear `icon-strip` now has a paragraph it did not have, and the three phase-1
// sheets take it away again with `display: none` on `.process-steps__desc`. That rule is legal
// because this block is `optional` (`src/lib/sections/block-roles.json`) — contract §3's last line
// refuses `display: none` only under `[data-role="essential"]` (`theme-css-lint.js`'s own pass for
// it), and §4 skips rather than judges a box the browser laid out nowhere. Measured cost of the
// union: `icon-strip` appears 0 times in the 6 real site configs, and 5 of the 30 registry themes ask
// for it through `supports` — which is the second producer of a variant value that #1028's PM review
// established (`sync-config.js` applies the theme's `supports` OVER the page JSON's `variant`), and
// the reason this cost is stated in themes rather than in pages.
//
// 🔴 THE STEP NUMBER STAYS IN THE MARKUP, AND THIS IS THE ONE PLACE THIS BATCH DEPARTS FROM
// values-grid's precedent (#1027). There the numeral went away with the branch, because ONE of five
// looks printed it and contract §2 allows `content` to be the empty string only, so no sheet could
// draw it back. Here ALL FIVE printed `{index + 1}` — a numeral in a circle, in a badge, at the head
// of a row. A thing every look showed is not one look's decoration; dropping it would be this
// migration deleting content, and no sheet could restore it. It is a part of its own
// (`.process-steps__num`), so a sheet that wants the old `icon-strip` strip-without-numbers can hide
// it the same way it hides the description.
//
// 🔴 THE CONNECTOR LINES ARE GONE AND A SHEET DRAWS THEM BACK. Four of the five branches drew a rule
// between steps with an absolutely-positioned `<div>` — an empty box whose only purpose was to be
// painted. `border` on `.process-steps__step` and `::before { content: "" }` + `background` are both
// in §2, and an empty div is the markup deciding a look.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ (#1008 AC5's precedent), gone from the props type
// above; `blocks/process-steps.json` still declares the slot and its five-key `variants` table.
//
// 🔴 THE STEPS ARE CHILDREN OF THE BLOCK AND THEIR THREE PARTS ARE CHILDREN OF THE STEP — one flat
// level each, because CSS grid and flex only place CHILDREN. That is what lets a sheet do the old
// `zigzag` (alternating columns through `grid-column`), `vertical` (one column) and `horizontal`
// (a 4-up row) without the markup choosing.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('process-steps', block)`, never
// `blockAttrs('process-steps')` (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function ProcessStepsSection({ data, block }: ProcessStepsSectionProps) {
  return (
    <section {...blockAttrs('process-steps', block)} className="process-steps" aria-labelledby="process-heading">
      <h2 id="process-heading" className="process-steps__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="process-steps__sub">{data.subheadline}</p>}
      {data.steps?.map((step, index) => (
        <div key={index} className="process-steps__step">
          <span className="process-steps__num">{index + 1}</span>
          <h3 className="process-steps__title">{step.title}</h3>
          <p className="process-steps__desc">{step.description}</p>
        </div>
      ))}
    </section>
  );
}
