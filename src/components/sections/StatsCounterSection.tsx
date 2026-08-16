import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Stat {
  value: string;
  label: string;
}

interface StatsCounterSectionProps {
  data: {
    headline?: string;
    stats: Stat[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1028 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch C.
//
// Six branches went out of here — `bar` (the default), `cards`, `gradient`, `icon`, `inline` and
// `dark`. All six read exactly `data.headline` and `data.stats[].value` / `.label`: the same fields,
// no more and no less. Nothing about content structure differed, so all six were skins, and skins
// belong in a stylesheet (spec §4.1, D5). `block_layout` therefore keeps its single value.
//
// 🔴 THE FOUR DECORATIVE SVGs ARE GONE AND A SHEET DRAWS THEM BACK. `icon` picked one of four inline
// SVGs per stat by index; they carried no content (`aria-hidden`) and existed to give each card a
// picture. That is the category #1027 named for values-grid's icons and ticks: a sheet paints them
// with `::before { content: "" }` + `background-image` on `.stats-counter__stat`, both of which §2
// allows. What a sheet cannot draw back is a DIFFERENT picture per stat — the old code cycled through
// four — because a rule cannot count its subjects. Said out loud rather than left to be found; the
// same accepted degradation #1018 and #1027 booked, and the pool being retired in phase 3 is where
// the replacement lands.
//
// 🔴 THE HEADLINE IS AN `<h2>` IN ALL SIX NOW. Four branches used `<h2>`, two (`bar`, `inline`) used
// a small uppercase `<p>` — and "small and uppercase" is `font-size` + `text-transform`, which is
// what a sheet is for. The element the browser puts in the document outline is not a look, so it
// cannot be one of the things a look changes; the two branches that dropped it out of the outline
// were losing an outline entry to get a font size.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ (#1008 AC5's precedent), gone from the props type
// above; `blocks/stats-counter.json` still declares the slot and its six-key `variants` table.
//
// 🔴 THE VALUE AND THE LABEL ARE CHILDREN OF THE STAT, AND THE STATS ARE CHILDREN OF THE BLOCK — one
// flat level each, because CSS grid and flex only place CHILDREN. That is what lets a sheet do the old
// `bar` (a 2×2 / 4-up grid), `inline` (a wrapping row with rules between) and `cards` (bordered boxes)
// looks without the markup choosing.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('stats-counter', block)`, never
// `blockAttrs('stats-counter')` (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function StatsCounterSection({ data, block }: StatsCounterSectionProps) {
  return (
    <section {...blockAttrs('stats-counter', block)} className="stats-counter" aria-label="Statistics">
      {data.headline && <h2 className="stats-counter__headline">{data.headline}</h2>}
      {data.stats?.map((stat, index) => (
        <div key={index} className="stats-counter__stat">
          <p className="stats-counter__value">{stat.value}</p>
          <p className="stats-counter__label">{stat.label}</p>
        </div>
      ))}
    </section>
  );
}
