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
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
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
// content decision — "this one has a description" — so classifying by name puts it in `block_layout`
// and gives this block two content shapes it does not have. It renders the SAME `data.subtitle` the
// other three render; what differed was where the subtitle sat (a second column instead of under the
// heading). Where a part sits is a sheet's business. So `block_layout` stays a single value and all
// four looks are drawn by the three proof sheets (spec §4.6 D5, and #1018's reading before it).
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ — the same deliberate state hero and cta-banner are
// in (#1008 AC5), do not "fix" it here. It is also gone from the props type above, which is both of
// their precedent: a component that declares a field it never reads is telling the next reader it
// matters. The field keeps arriving in the page JSON and React ignores extra keys, so nothing breaks;
// the manifest (`blocks/page-header.json`) still declares the slot and its four-key `variants` table,
// untouched, exactly as #1008 left hero's and #1018 left cta-banner's — that file is what the site
// building AI writes against, and 31 blocks still use it. sync-config.js also still overwrites
// `data.variant` from the applied theme's `supports` table (the line reading
// `block.data = { ...(block.data || {}), variant: preferred }` — quoted rather than numbered because
// that file moves under other tickets almost daily). Both stay because the other 31 blocks have not
// moved yet and they read it through the same path.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('page-header', block)`, never
// `blockAttrs('page-header')`. #998 puts the page JSON's `block_layout` and `role` on the root element
// through that second argument. Dropping it is silent in every instrument we own: `registry.ts` types
// the components as `ComponentType<any>`, so `tsc` cannot see it, the build stays green and the page
// still opens — only `data-block-layout` is gone from the tree. #1008 r1 was bounced for exactly that,
// and it is invisible on a block that carries no `block_layout`, which is every block on every site
// today (`blockAttrs.ts:76` only emits the attribute when the JSON wrote one).
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
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h1 className="page-header__title">{data.title}</h1>
      {data.subtitle && (
        <p className="page-header__sub">{data.subtitle}</p>
      )}
    </section>
  );
}
