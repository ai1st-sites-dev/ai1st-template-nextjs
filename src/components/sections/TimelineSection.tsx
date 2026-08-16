import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TimelineEvent {
  year: string;
  title: string;
  description: string;
}

interface TimelineSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    events: TimelineEvent[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1028 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch C.
//
// Four branches went out of here — `vertical` (the default), `horizontal`, `compact` and `milestone`.
// All four read exactly `data.headline` / `data.subheadline` and `data.events[].year` / `.title` /
// `.description`: the same fields, no more and no less. Nothing about content structure differed, so
// all four were skins, and skins belong in a stylesheet (spec §4.1, D5). `block_layout` therefore
// keeps its single value.
//
// 🔴 ONE OF THE FOUR WAS PRINTING EACH EVENT'S WORDS ONLY HALF THE TIME, AND THAT ENDS HERE. The
// default `vertical` look put the events on alternating sides of a centre line by rendering the title
// and description inside `index % 2 === 0 ? <left> : <empty>` and again in the mirror — so the DOM
// carried an empty `<div>` for every event, and the words appeared once. The neutral markup renders
// each event once; a sheet does the alternation with `grid-column` on `.timeline__event`. This is not
// a change of content: the same words appear the same number of times. It is one fewer way for a look
// to be built out of empty boxes.
//
// 🔴 THE CENTRE LINE AND THE YEAR BADGE'S CIRCLE ARE GONE AND A SHEET DRAWS THEM BACK. Both were
// empty absolutely-positioned `<div>`s or a shape made of Tailwind classes on the year. `border` on
// `.timeline__event`, `border-radius` + `background` on `.timeline__year` and `::before { content: "" }`
// are all in §2 — an empty div is the markup deciding a look.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ (#1008 AC5's precedent), gone from the props type
// above; `blocks/timeline.json` still declares the slot and its four-key `variants` table.
//
// 🔴 THE EVENTS ARE CHILDREN OF THE BLOCK AND THEIR THREE PARTS ARE CHILDREN OF THE EVENT — one flat
// level each, because CSS grid and flex only place CHILDREN. That is what lets a sheet do the old
// `horizontal` (a scrolling row), `compact` (a list with rules between) and `milestone` (bordered
// cards with a huge year) looks without the markup choosing.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('timeline', block)`, never `blockAttrs('timeline')`
// (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function TimelineSection({ data, block }: TimelineSectionProps) {
  return (
    <section {...blockAttrs('timeline', block)} className="timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="timeline__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="timeline__sub">{data.subheadline}</p>}
      {data.events?.map((event, index) => (
        <div key={index} className="timeline__event">
          <p className="timeline__year">{event.year}</p>
          <h3 className="timeline__title">{event.title}</h3>
          <p className="timeline__desc">{event.description}</p>
        </div>
      ))}
    </section>
  );
}
