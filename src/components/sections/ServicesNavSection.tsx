import { getServices } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

// 🔴🔴 #1027 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch B, and the smallest block in it.
//
// 🔴 THIS BLOCK IS `essential` (blocks/services-nav.json), because it is how a visitor reaches each
// service (`blockAttrs.ts:38`). Its links point at `#<service.id>`, which is the id `services-list`
// puts on each of its items — the two blocks are one feature, and a rename on either side breaks it
// silently. Neither id moved in this ticket.
//
// 🔴 `position: sticky` STAYS IN globals.css AND CANNOT MOVE TO A SHEET. Contract §2 admits no value
// of `position`, `sticky` included, and says why in its own words. So does the scrolling behaviour of
// the row (`overflow-x: auto`), which is what keeps a phone from growing a horizontal scrollbar when
// a business has eight services. Both are structure, and the structure layer is the one file allowed
// to write them. A sheet still owns everything a theme should own here: the bar's padding, ground and
// border, and each link's shape, size and colour.
//
// 🔴 THE TWO WRAPPER `<div>`s ARE GONE. They existed to hold `container-width` and the flex row; both
// are now the sheet's business (`display` / `gap` / `padding` on `.services-nav`), and CSS grid and
// flex only place CHILDREN — with the wrappers there, a sheet could not have laid the links out at
// all. This is the same reason page-header's three parts are siblings (#1019).
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('services-nav', block)`, never
// `blockAttrs('services-nav')` (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function ServicesNavSection({ locale, block }: { locale: string; block?: BlockConfig }) {
  const services = getServices(locale);
  return (
    <section {...blockAttrs('services-nav', block)} className="services-nav" aria-label="Service quick navigation">
      {services.map((service) => (
        <a key={service.id} href={`#${service.id}`} className="services-nav__link">
          {service.name}
        </a>
      ))}
    </section>
  );
}
