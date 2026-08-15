import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ValuesGridSectionProps {
  data: {
    headline: string;
    items: { title: string; description: string }[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1027 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch B.
//
// 🔴 THIS BLOCK DID HAVE VARIANTS, AND THE TICKET SAID IT DID NOT — because its appearance word is
// not spelled `variant`. Five branches went out of here: `icon` (a decorative SVG per item),
// `highlight` (the first item large, the rest in a row), `minimal` (no cards, a short accent rule
// under each title), `numbered` (a numeral in a circle) and the `checkmark` fallback. They were
// selected by `data.style`, and `blocks/values-grid.json` says in as many words what that field is:
// `"style": { "kind": "variant" }`, `"variantKey": "style"`, five entries under `variants`. So the
// disposition is #1007's standing one for a `kind: "variant"` slot, not a fresh judgement.
//
// Measured before deleting them, the way #1018 and #1019 measured theirs: all five read exactly
// `data.headline` and `data.items[].title` / `.description` — the same fields, no more and no less.
// Nothing about content structure differed, so all five were skins, and skins belong in a stylesheet
// (spec §4.1, D5). `block_layout` therefore keeps its single value.
//
// 🔴 ONE THING NO SHEET CAN REDRAW, SAID OUT LOUD RATHER THAN LEFT TO BE FOUND: the old `numbered`
// look printed `{index + 1}` into the markup, and contract §2 allows `content` to be the EMPTY STRING
// only — so a theme can draw a badge but cannot put a numeral in it. The numbers are gone with the
// branch. That is the same accepted degradation #1018 booked when the 30 frozen sheets' cta-banner
// variant values stopped reaching the page (spec D3 + D12): the old pool is being retired and phase 3
// generates the real one against the final contract. The per-item tick and the six decorative icons
// are NOT in that category — a sheet paints those with `::before { content: "" }` + `background-image`.
//
// 🔴 `style` IS STILL WRITTEN AND NO LONGER READ — hero's, cta-banner's and page-header's `variant`
// are in the same deliberate state (#1008 AC5), do not "fix" it here. It is gone from the props type
// above, which is all three of their precedent: a component that declares a field it never reads is
// telling the next reader it matters. The field keeps arriving in the page JSON and React ignores
// extra keys, so nothing breaks; `blocks/values-grid.json` still declares the slot and its five-key
// `variants` table, untouched — that file is what the site building AI writes against, and the blocks
// phase 2 has not reached yet still read theirs through the same path.
//
// 🔴 TITLE AND DESCRIPTION ARE CHILDREN OF THE ITEM, AND THE ITEMS ARE CHILDREN OF THE BLOCK — one
// flat level each, because CSS grid only places CHILDREN. That is what lets a sheet do the old
// `highlight` look (`.values-grid__item:first-child` is not a legal selector, but a sheet CAN give
// every item a different span through `grid-auto-flow` / `grid-column`) and the old `minimal` look
// (drop the card's border and background) without the markup choosing.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('values-grid', block)`, never
// `blockAttrs('values-grid')` (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function ValuesGridSection({ data, block }: ValuesGridSectionProps) {
  return (
    <section {...blockAttrs('values-grid', block)} className="values-grid" aria-labelledby="values-heading">
      <h2 id="values-heading" className="values-grid__headline">
        {data.headline}
      </h2>
      {data.items?.map((item, index) => (
        <div key={index} className="values-grid__item">
          <h3 className="values-grid__title">{item.title}</h3>
          <p className="values-grid__desc">{item.description}</p>
        </div>
      ))}
    </section>
  );
}
