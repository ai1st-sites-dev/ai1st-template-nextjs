import Link from 'next/link';
import { pagesByLocale, localeUrl } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ServiceRelatedPagesSectionProps {
  data: {
    serviceSlug: string;
    headline: string;
    subheadline?: string;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1027 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch B, the least exposed block in it
// (0.05 instances per site, #1007) — and the one with a trap in it for whoever measures the batch:
//
// 🔴 IT RENDERS NOTHING WHEN THE SITE HAS NO SUB-PAGES UNDER THE SLUG (`return null`, below). A
// fixture that does not put two pages under `<serviceSlug>/` measures this block by measuring an
// empty string, in both arms, and calls it unchanged. `scripts/block-migration/README.md` says the
// same thing about the same block; the fixture for this ticket carries `services/alpha` and
// `services/beta` for that reason.
//
// 🔴 THE CARDS ARE CHILDREN OF THE BLOCK, beside the headline and the subtitle rather than inside a
// wrapper — CSS grid only places CHILDREN, so this is what lets a sheet run them in two columns or
// three, and put the heading across the top with `grid-column: 1 / -1`. hero's `.hero__deco` is
// placed the same way (#991).
//
// 🔴 THE ARROW `<svg>` IS GONE. "Learn more" is content and stays; the arrow beside it was decoration,
// and a sheet draws that with `::before` / `::after` — #1018's boundary when it deleted the `dark`
// variant's overlay div.
//
// 🔴 THE CARD'S OWN PARTS CARRY NO CLASS — the structure layer reaches them through the card hook
// (`.service-related-pages__card h3`, globals.css). That is page-header's precedent for the crumb
// `<ol>`/`<li>` (#1019): a sheet decides where the card sits and how big it is; what a card IS
// belongs to the structure layer.
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('service-related-pages', block)`, never
// `blockAttrs('service-related-pages')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.generated.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
export default function ServiceRelatedPagesSection({ data, locale, block }: ServiceRelatedPagesSectionProps) {
  const allPages = pagesByLocale[locale] ?? [];
  const relatedPages = allPages.filter(
    (p) => p.slug.startsWith(`${data.serviceSlug}/`) && p.slug !== data.serviceSlug
  );

  if (relatedPages.length === 0) return null;

  return (
    <section {...blockAttrs('service-related-pages', block)} className="service-related-pages" aria-labelledby="related-pages-heading">
      <h2 id="related-pages-heading" className="service-related-pages__headline" data-slot="headline">
        {data.headline}
      </h2>
      {data.subheadline && (
        <p className="service-related-pages__sub" data-slot="subheadline">{data.subheadline}</p>
      )}
      {relatedPages.map((page) => (
        <Link key={page.slug} href={localeUrl(page.slug, locale)} className="service-related-pages__card">
          <h3>{page.title}</h3>
          <p>{page.description}</p>
          <span>Learn more</span>
        </Link>
      ))}
    </section>
  );
}
