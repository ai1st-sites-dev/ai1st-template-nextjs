import { brand } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ContactInfoSectionProps {
  data: {
    headline: string;
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1028 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch C, and the only `essential` block in it.
//
// Four branches went out of here — `cards` (the default), `inline`, `map-style` and `banner`. All four
// read exactly `data.headline`, `brand.locations[].label` / `.address` / `.phone` and `brand.email`:
// the same fields, no more and no less. Nothing about content structure differed, so all four were
// skins, and skins belong in a stylesheet (spec §4.1, D5). `block_layout` therefore keeps its single
// value.
//
// 🔴 THE MARKUP BELOW IS THE UNION OF THE FOUR, NOT ANY ONE OF THEM, AND FOR THIS BLOCK THAT IS THE
// WHOLE POINT. Three of the four branches wrapped the phone in `tel:`; the `cards` default printed it
// as plain text inside a summary line. Three printed the address per location; `cards` printed it too
// but dropped the per-location phone link. Taking any single branch as the model would have DELETED a
// way for a customer to reach this business — which is what `essential` means here (`block-roles.json`),
// and is why this ticket's AC-E compares the `tel:` / `mailto:` SET before and after rather than one
// arm's HTML. Measured on the union arm (a page carrying all four old looks): the set of `href="tel:…"`
// and `href="mailto:…"` is unchanged by this migration, and so is the set of address / phone / email
// strings the block renders.
//
// 🔴 THE MAP PLACEHOLDER IS GONE AND NOTHING REPLACES IT IN THE MARKUP. `map-style` drew an empty
// gradient box — a decoration with no content in it — and contract §2 lets a sheet draw exactly that
// (`background` on `.contact-info`, or a part it already has). A `<div>` whose only purpose is to be
// painted is the markup deciding a look, which is the thing this phase removes.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ — hero's, cta-banner's, page-header's and batch B's
// are in the same deliberate state (#1008 AC5), do not "fix" it here. It is gone from the props type
// above, which is all of their precedent: a component that declares a field it never reads is telling
// the next reader it matters. The field keeps arriving in the page JSON and React ignores extra keys,
// so nothing breaks; `blocks/contact-info.json` still declares the slot and its four-key `variants`
// table, untouched — that file is what the site building AI writes against.
//
// 🔴 EACH LOCATION'S THREE LINES ARE CHILDREN OF THE LOCATION, AND THE LOCATIONS ARE CHILDREN OF THE
// BLOCK — one flat level each, because CSS grid and flex only place CHILDREN. That is what lets a
// sheet lay the locations out in a row (the old `banner`), in a column with rules between them (the
// old `inline`), or beside a painted panel (the old `map-style`) without the markup choosing.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('contact-info', block)`, never
// `blockAttrs('contact-info')` (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function ContactInfoSection({ data, block }: ContactInfoSectionProps) {
  return (
    <section {...blockAttrs('contact-info', block)} className="contact-info" aria-labelledby="locations-heading">
      <h2 id="locations-heading" className="contact-info__headline">
        {data.headline}
      </h2>
      {brand.locations.map((location) => (
        <div key={location.label} className="contact-info__location">
          <h3 className="contact-info__label">{location.label}</h3>
          <p className="contact-info__address">{location.address}</p>
          <a href={`tel:${location.phone.replace(/\s/g, '')}`} className="contact-info__phone">
            {location.phone}
          </a>
        </div>
      ))}
      <a href={`mailto:${brand.email}`} className="contact-info__email">
        {brand.email}
      </a>
    </section>
  );
}
