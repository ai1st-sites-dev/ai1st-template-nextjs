import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface DividerSectionProps {
  data: {
    label?: string;
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F, the cheapest of its seven.
//
// Four branches went out of here (`wave`, `gradient-bar`, `icon` and the `line` fallback), selected
// by `data.variant`. Measured before deleting them, the way #1018 / #1019 / #1027 measured theirs:
// every branch reads exactly one field, `data.label`, and three of the four do not even draw it. So
// the difference between them was never content — it was a rule, a bar or a wave, i.e. a picture.
// `block_layout` therefore keeps its single value and the picture moves to the sheets.
//
// 🔴 WHAT NO SHEET CAN REDRAW, SAID OUT LOUD RATHER THAN LEFT TO BE FOUND — nothing, on this block.
// The old `wave` branch shipped an inline `<svg>` path, and that is the one case where "a sheet can
// paint it" needed checking rather than assuming: contract §2 admits `background*`, and
// `theme-css-lint.js` refuses third-party URLs but keeps `data:` legal on purpose ("bytes in the
// sheet, not a request to a third party", the comment at its URL rule). A `background-image:
// url(data:image/svg+xml,…)` on `.divider__rule` is the same wave. `hero-media-top.css` draws it
// that way below, so this is a measured claim and not an argument.
//
// 🔴 THE INVENTED ENGLISH IS GONE, AND THAT IS A FIX RATHER THAN A LOSS. Two of the four branches
// set `aria-label={data.label || 'Section divider'}` — a hard-coded English string on a block whose
// own content is translated, so a Chinese site announced "Section divider" to a screen reader. 16 of
// the 18 dividers on the six live sites carry no label at all, so that string is what almost every
// divider announced today. `role="separator"` is a structural role and is perfectly legal without a
// name; when there IS a label the visible text is the name, which is the ordinary way to give one.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('divider', block)`, never `blockAttrs('divider')`
// (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function DividerSection({ data, block }: DividerSectionProps) {
  return (
    <div {...blockAttrs('divider', block)} className="divider" role="separator">
      {/* Decorative and empty on purpose, exactly like `.hero__deco`: this is the hook a sheet paints
          the rule / bar / wave onto. Anything a reader needs to KNOW goes in the label below. */}
      <span className="divider__rule" aria-hidden="true" />
      {data.label ? <span className="divider__label">{data.label}</span> : null}
    </div>
  );
}
