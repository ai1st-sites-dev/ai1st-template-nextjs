import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderSectionProps {
  data: {
    title: string;
    subtitle?: string;
    breadcrumbs?: Breadcrumb[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1019 — ONE MARKUP, AND NOTHING ELSE. Phase 2's third block (hero #1008, cta-banner #1018).
//
// Four variant trees went out of here: `minimal` (a white ground with an underlined heading),
// `centered` (the dark gradient, text centred), `with-description` (the same gradient in two columns)
// and the `default` fallback. What made them four was Tailwind classes — measured before deleting
// them, because the name of one of them argues the opposite: all four read exactly `data.title`,
// `data.subtitle` and `data.breadcrumbs`, the same three fields, no more and no less.
//
// 🔴 `with-description` IS A SKIN, AND THAT IS THE ONE WORTH SAYING OUT LOUD. Its name reads like a
// content decision — "this one has a description" — so classifying by name would have given this
// block two content shapes it does not have. It renders the SAME `data.subtitle` the other three
// render; what differed was where the subtitle sat (a second column instead of under the heading).
// Where a part sits is a sheet's business. So this block never got a content-structure axis, and all
// four looks are drawn by the sheets (spec §4.6 D5, and #1018's reading before it).
// 📌 #1341 retired that axis (`block_layout`) for every block, so there is nothing to classify into
//    any more.
//
// 📌 #1341 — this line used to read "`variant` IS STILL WRITTEN AND NO LONGER READ". It is no
//    longer written either: sync-config.js's line that overwrote `data.variant` from the theme
//    went with the rest of that dimension, and a page JSON that still carries the key has it
//    dropped on read (`scripts/blocks.js` §normalizeListSlots), so it never reaches a component.
// 🔴 `variant` IS NO LONGER WRITTEN AND NO LONGER READ — the same deliberate state hero and cta-banner are
// in (#1008 AC5), do not "fix" it here. It is also gone from the props type above, which is both of
// their precedent: a component that declares a field it never reads is telling the next reader it
// matters. The key is still on disk in older sites, but the build drops it before rendering (#1341), so nothing breaks;
// the manifest (`blocks/page-header/manifest.json`) still carries the `variants` table — that file is what the
// site building AI writes against.
// 📌 #1341 — two things that used to be in this paragraph are gone: the manifest's `variant` SLOT
//    (the `variants` table itself stays, it feeds the prompt), and sync-config.js's line that
//    overwrote `data.variant` from the applied theme's `supports`. A page JSON that already carries
//    `data.variant` keeps carrying it and nobody reads it; the block path never did.
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('page-header', block)`, never
// `blockAttrs('page-header')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.generated.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
//
// 🔴 THE THREE PARTS ARE SIBLINGS, NOT NESTED. CSS grid only places CHILDREN, so the old
// `with-description` two-column look is a sheet writing `grid-column` on `.page-header__title` and
// `.page-header__sub` — impossible if a `<div class="container">` sat between them and the block.
// The breadcrumb list keeps its own <ol>/<li> inside `.page-header__crumbs` because those are the
// block's CONTENT (a list is a list); how the row is laid out is the structure layer's, in globals.css.
export default function PageHeaderSection({ data, block }: PageHeaderSectionProps) {
  return (
    <section {...blockAttrs('page-header', block)} className="page-header">
      {data.breadcrumbs && (
        <nav aria-label="Breadcrumb" className="page-header__crumbs">
          <ol>
            {data.breadcrumbs?.map((crumb, i) => (
              <li key={i}>
                {i > 0 && <span aria-hidden="true">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} data-slot={`breadcrumbs.${i}.label`}>{crumb.label}</Link>
                ) : (
                  <span data-slot={`breadcrumbs.${i}.label`}>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h1 className="page-header__title" data-slot="title">{data.title}</h1>
      {data.subtitle && (
        <p className="page-header__sub" data-slot="subtitle">{data.subtitle}</p>
      )}
    </section>
  );
}
