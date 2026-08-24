import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TextBlockSectionProps {
  data: {
    headline?: string;
    content: string;
    attribution?: string;
    items?: string[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F, and one of the three blocks in it
// where the branches really did differ in CONTENT and not only in looks.
//
// Five looks went out (`two-column`, `highlight-box`, `quote`, `with-list` and the `default`
// fallback), selected by `data.variant`. Measured before deleting them, per branch and per field:
//
//     default / two-column / highlight-box    headline · content
//     quote                                   headline · content · attribution
//     with-list                               headline · content · items
//
// Three of the five are the same content drawn three ways — a box with a rule down its left, two
// newspaper columns, plain prose. The other two CARRY SOMETHING MORE, and that is what
// `block_layout` is for (spec §5.2): its manifest goes from one value to three — `default`,
// `quote`, `with-list`. Nothing converts the old `variant` into the new value and nothing should
// (`scripts/blocks.js:21-22`, spec D5): they are two coexisting fields.
//
// 🔴 SO THIS BLOCK RENDERS WHAT THE DATA HAS, NOT WHAT A LAYOUT NAME SAYS. `block_layout` is a hook
// for the SHEET; the markup shows an attribution when there is an attribution and a list when there
// are items. A site that writes `block_layout: "quote"` and no attribution gets a quote-shaped
// stylesheet over prose, which is the right failure — visible, not silent.
//
// 🔴 WHAT NO SHEET CAN REDRAW, AND THIS IS THE ONE REAL LOSS IN THIS BATCH: the old `two-column`
// look set Tailwind's `columns-2`, and CSS `columns` is NOT on contract §2's property list
// (`column-gap` is; the shorthand and `column-count` are not). No sheet can flow this text into two
// newspaper columns. Measured cost on the six live sites: 4 of the 22 text-blocks ask for
// `two-column` today and will read as one column after this. That is the same accepted degradation
// #1018 booked for cta-banner and #1027 for values-grid's numerals — the frozen 30-theme pool is
// being retired and phase 3 generates the real one against the final contract. If two columns turn
// out to matter, the fix is one line in contract §2, not a branch back in here.
// 🔴 THAT SENTENCE IS IN THE PAST TENSE NOW (#1140, from #1083). Both halves of it have happened:
//    🔴 re-taken on 2026-08-23 (#1161): `themes.js` no longer exports one merged table. `themes` is
//    the 80 generated `poolThemes` phase 3 produced; the 30 hand-written ones this paragraph means
//    are the separate `retiredThemes` export and are NOT in `themes`. (The previous version of this
//    note said "exports 110 themes, 30 of which are retiredThemes" — that spread is gone.)
//    So "30" here is NOT a claim about how many themes the registry has; it names the
//    retired set. Re-take it with
//      node -e "const t=require('./scripts/themes.js');
//               console.log(Object.keys(t.themes).length, Object.keys(t.retiredThemes).length)"
//    The measured cost above (4 of the 22 text-blocks on the six live sites) is still the cost of
//    this batch's change and is unaffected by the pool growing — it counts SITES, not themes.
//
// 🔴 THE EM DASH BEFORE THE ATTRIBUTION IS GONE, for a reason worth writing down once for the whole
// batch: contract §2 allows `content` only as the EMPTY string, so punctuation a sheet would want to
// add cannot come from a sheet — and punctuation baked into markup is the markup deciding
// typography. The attribution renders as its own part; a sheet marks it as a citation with type and
// placement. Same call as values-grid's numerals (#1027).
//
// 🔴 `variant`, `background` AND `centered` ARE STILL WRITTEN AND NO LONGER READ. `variant` is
// #1008's AC5 precedent. The other two are not spelled `variant` — their manifest slots say
// `kind: "text"` and `kind: "flag"` — but `background: "gray"` and `centered: true` are a ground and
// a text alignment, i.e. exactly the two things contract §2 hands to a sheet, and the markup was
// turning them into Tailwind classes. Measured on the six live sites so the cost is not a guess:
// 3 of 22 instances write `background: "gray"`, 1 writes `centered: false`, and NO live instance is
// centred today. `blocks/text-block.json` keeps all three slots untouched — that file is what the
// site building AI writes against.
//
// 🔴 EVERY PART IS A DIRECT CHILD OF THE BLOCK, one flat level, because CSS grid only places
// CHILDREN — which is what lets a sheet put the attribution beside the quote rather than under it.
// The `<li>`s are not: contract §1 refuses tag selectors, so list internals are laid out by the
// structure layer in `globals.css` (the same split #1027 drew for `.services-list__features ul`).
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('text-block', block)` (#998's `data-block-layout`,
// invisible to `tsc`; #1008 r1's bounce).
export default function TextBlockSection({ data, block }: TextBlockSectionProps) {
  return (
    <section
      {...blockAttrs('text-block', block)}
      className="text-block"
      aria-labelledby={data.headline ? 'text-block-heading' : undefined}
    >
      {data.headline && (
        <h2 id="text-block-heading" className="text-block__headline">
          {data.headline}
        </h2>
      )}
      <p className="text-block__body">{data.content}</p>
      {data.attribution && (
        <p className="text-block__attribution">{data.attribution}</p>
      )}
      {data.items && data.items.length > 0 && (
        <ul className="text-block__list">
          {data.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
