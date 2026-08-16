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
// a site that used to wear `icon-strip` now has a paragraph it did not have.
//
// 🔴 #1042 REVERSED #1028's DISPOSITION, AND THE REASON IS WHY NOBODY SHOULD WRITE THAT RULE AGAIN.
// #1028 had the three phase-1 sheets take the paragraph back off with `display: none` on
// `.process-steps__desc`. Those three rules are GONE. Two readings killed them:
//   ① A CSS rule cannot tell which branch a site used to be on. The rule was unconditional, so it hit
//      EVERY site wearing that sheet. Across the 30 registry themes `process-steps` splits
//      horizontal 8 · vertical 7 · zigzag 5 · cards 5 · icon-strip 5 — so hiding it cost 25 themes a
//      paragraph of real content to spare 5 themes an extra one. In the 6 real site configs the block
//      appears 31 times with 140 steps, and all 140 carry a description. And after the migration
//      "a site that wears icon-strip" is not a thing any more: the sheet decides the look, not the
//      variant, so the premise the rule was built on no longer exists.
//   ② "Legal because this block is `optional`" did not hold either. A page JSON may legally raise a
//      block's `role` to `essential` (spec §4.6 permits raising, never lowering), which makes the root
//      `data-role="essential"` — and the unconditional rule still matched it, while the runtime check
//      still went green.
// `icon-strip` appears 3 times in the 6 real site configs — 13 steps between them, and all 13 carry
// a description (`site-943130a2/.../services/root-canal.json`,
// `site-bbf7a3d6/.../services/home-evaluation.json` in both en and zh). Those 13 paragraphs were
// hidden too, by the very rule that named icon-strip as the reason for hiding. On top of that, 5 of
// the 30 registry themes ask for the variant through `supports` — the second producer of a variant
// value that #1028's PM review established (`sync-config.js` applies the theme's `supports` OVER the
// page JSON's `variant`), and the reason this cost is stated in themes rather than in pages.
//
// 🔴 THAT COUNT USED TO READ "0 times", AND HOW IT GOT THERE IS THE POINT OF THIS NOTE. All three
// instances live under `pages/services/`, and a scan of `pages/*.json` — one level, no recursion —
// finds none of them: `find` reads 90 page files where a flat glob reads 43. "Nobody uses icon-strip"
// was then exactly the premise that made hiding its paragraph look free in #1028. So the corrected
// number is not a footnote to the argument above, it is the argument: sites DO use this variant, and
// their content was being hidden along with everyone else's. Count block instances by recursing into
// `pages/**` — this repo has now paid for that twice (#1036, and here).
//
// 🔴 THE STEP NUMBER STAYS IN THE MARKUP, AND THIS IS THE ONE PLACE THIS BATCH DEPARTS FROM
// values-grid's precedent (#1027). There the numeral went away with the branch, because ONE of five
// looks printed it and contract §2 allows `content` to be the empty string only, so no sheet could
// draw it back. Here ALL FIVE printed `{index + 1}` — a numeral in a circle, in a badge, at the head
// of a row. A thing every look showed is not one look's decoration; dropping it would be this
// migration deleting content, and no sheet could restore it. It is a part of its own
// (`.process-steps__num`), so a sheet that wants the old `icon-strip` strip-without-numbers has a
// hook to work with. 🔴 But do NOT reach for an unconditional `display: none` on it — that is exactly
// the shape #1042 had to remove above, and the numeral has the same property the description does:
// every one of the five old branches printed it, so every site has real content there.
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
