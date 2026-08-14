import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface CtaBannerSectionProps {
  data: {
    headline: string;
    description: string;
    button: { label: string; href: string };
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1018 — ONE MARKUP, AND NOTHING ELSE. Phase 2's second block (hero was #1008).
//
// Five variant trees went out of here: `gradient` (a diagonal gradient), `split` (two columns with the
// button in a tinted box), `dark` (dark ground plus a pattern overlay), `outlined` (a bordered card)
// and the `solid` fallback. What made them five was Tailwind classes — measured before deleting them:
// all five read exactly `data.headline`, `data.description` and `data.button`, one field each, no more
// and no less. Nothing about content structure differed, so nothing here is a content decision:
// **all five were skins**, and skins belong in a stylesheet (spec §4.1, D5).
//
// 🔴 WHY THE OLD `dark` OVERLAY HAS NO HOOK OF ITS OWN. That variant painted a pattern through an extra
// `<div className="absolute inset-0 …">`. A sheet paints the same thing with `background-image` on
// `.cta-banner` itself — one property on the element that is already there — so the empty div is not
// needed, and an empty div in every site's HTML for the benefit of one look is exactly the markup phase
// 2 exists to remove. (`position` is not on the contract's property list, so an overlay is not
// something a sheet could reproduce element-for-element anyway; `::before` is available on every hook
// and gives a sheet an in-flow band, which is what the decoration was doing visually.)
// hero's `.hero__deco` is not the same case: hero's decoration had to be a GRID ITEM the sheet could
// place in the row with the picture and the words, and `::before` cannot be given `order` there.
//
// 🔴 `aria-labelledby` + the heading's id ARE KEPT VERBATIM, including the duplicate-id smell. Sites
// average six of these blocks (#1007), so `id="cta-heading"` can appear more than once on one page —
// that is today's behaviour, and this ticket's promise is "the look moves into CSS", not "accessibility
// changes too". Fixing it means picking a per-block id, which changes the DOM of a block phase 2 has
// not been asked to change yet. Reported instead of quietly altered.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ — the same deliberate state hero is in (#1008 AC5),
// do not "fix" it here. It is also gone from the props type above, which is hero's precedent too
// (`git show origin/main:…/HeroSection.tsx` — its `data` names five fields and `variant` is not one):
// a component that declares a field it never reads is telling the next reader it matters. The field
// keeps arriving in the JSON and React ignores extra keys, so nothing breaks; the manifest
// (`blocks/cta-banner.json`) still declares the slot and the `variants` table, untouched, exactly as
// #1008 left hero's — that file is what the AI writes against, and 32 blocks still use it. Page JSON carries `data.variant`, and sync-config.js still overwrites it from
// the applied theme's `supports` table (the line reading
// `block.data = { ...(block.data || {}), variant: preferred }` — quoted rather than numbered because
// that file moves almost daily). All 30 frozen themes name a cta-banner variant (`gradient` ×9,
// `dark` ×7, `solid` ×6, `outlined` ×4, `split` ×4) and not one of those values reaches the page any
// more; that is the accepted degradation (spec D3 + D12, Chris 2026-08-13) — the old pool is retired
// and the real one is generated in phase 3 against the final contract. Both the field and the overwrite
// stay because the other 32 blocks have not moved yet and they read it through the same path.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('cta-banner', block)`, never `blockAttrs('cta-banner')`.
// #998 puts the page JSON's `block_layout` and `role` on the root element through that second argument.
// Dropping it is silent in every instrument we own: `registry.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it, the build stays green and the page still opens — only
// `data-block-layout` is gone from the tree. #1008 r1 was bounced for exactly that.
export default function CtaBannerSection({ data, block }: CtaBannerSectionProps) {
  return (
    <section {...blockAttrs('cta-banner', block)} className="cta-banner" aria-labelledby="cta-heading">
      <h2 id="cta-heading" className="cta-banner__headline">
        {data.headline}
      </h2>
      <p className="cta-banner__desc">
        {data.description}
      </p>
      {/* 🔴 The button keeps the SITE's button class rather than getting a hook of its own — the same
          boundary hero draws. A theme owns layout; what a call to action looks like is the brand's,
          and it already follows the palette through CSS variables (globals.css @layer components).
          The hook is on the box AROUND it, so a sheet can move the button (the old `split` look put it
          in a column of its own) without being able to restyle every call to action on the site. */}
      <div className="cta-banner__action">
        <Link href={data.button?.href ?? "#"} className="btn-accent text-lg">
          {data.button?.label}
        </Link>
      </div>
    </section>
  );
}
