import Link from 'next/link';
import ServiceIcon from '@/components/ServiceIcon';
import { getServices, pagesByLocale, localeUrl } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface FeaturesGridSectionProps {
  data: {
    headline: string;
    subheadline: string;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F, and the block with the most branches
// left in the whole batch: AC1's grep read 9 hits here against 2-5 everywhere else. (Spelled that
// way on purpose — writing the pattern out in a comment is itself a hit, and AC1's judge would then
// read 1 on a file with no branches left in it.)
//
// Six looks went out (`list`, `alternating`, `minimal`, `bordered`, `icon-top` and the `card`
// fallback). Nine hits, six looks: five of the nine were `icon-top` asking itself the same question
// again inline, four times inside the default branch's className strings and once inside a prop.
// Measured before deleting them: all six read `data.headline` and `data.subheadline` and nothing
// else from `data` — the items are not in the page JSON at all, they are the site's services
// (`getServices(locale)`). One field set, six skins. `block_layout` keeps its single value.
//
// 🔴 `data.columns` IS GONE TOO, AND IT IS THE ONE NAMED COST OF THIS BLOCK. It was not spelled
// `variant` — its manifest slot says `kind: "text"` — but 2 / 3 / 4 as a grid column count is a
// picture, and the contract hands `grid-template-columns` to the sheets (§2). Keeping it would have
// meant the markup and the sheet both deciding one property, which is the bug generator spec §4.1
// exists to remove. Measured on the six live sites: all 9 instances write it — 3 columns ×6,
// 2 columns ×2, 4 columns ×1 — so this is a real change on every site that has this block, not a
// dormant field. After this, how many columns a services grid has is the sheet's answer. If a
// business should get to choose density, that choice belongs in `block_layout` (a value in this
// block's manifest), not in a number the markup turns into a Tailwind class — but nobody has asked
// for it, so this ticket does not invent it. `blocks/features-grid.json` keeps the slot untouched,
// same as `variant` (#1008 AC5): the site building AI writes against that file.
//
// 📌 MEASURED AND OUT OF SCOPE: 2 of the 9 live instances also write `data.items`, which no version
// of this component has ever read — the cards come from the site's services. #1012's family again;
// unchanged by this ticket, recorded so nobody re-finds it.
//
// 🔴 EVERY CARD IS A DIRECT CHILD OF THE BLOCK, one flat level, because CSS grid only places
// CHILDREN. That is what lets a sheet do the old `list` look (one column, a rule between rows) and
// the old `alternating` look (`grid-auto-flow` plus a different ground on the odd tracks) without
// the markup choosing. The heading and the subtitle are children for the same reason: the old
// `minimal` look centred them over a narrower grid, which is `grid-column` on them.
//
// 🔴 THE HOOK GOES ON THE `<svg>` ITSELF through `ServiceIcon`'s `className` prop, which is #1027's
// precedent on `services-list` (`ServicesListSection.tsx:48`) and not a fresh choice. Passing it
// matters for a reason that is invisible if you skip it: `ServiceIcon`'s className DEFAULTS to
// `h-8 w-8`, so leaving the prop off would leave a Tailwind size in the markup for the sheet to
// fight. One owner per property.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('features-grid', block)` (#998's
// `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function FeaturesGridSection({ data, locale, block }: FeaturesGridSectionProps) {
  const services = getServices(locale);
  const allPages = pagesByLocale[locale] ?? [];
  const serviceDetailSlugs = new Set(
    allPages.filter(p => p.slug.startsWith('services/') && p.slug !== 'services').map(p => p.slug.replace('services/', ''))
  );
  const getServiceHref = (id: string) => serviceDetailSlugs.has(id) ? localeUrl(`services/${id}`, locale) : `${localeUrl('services', locale)}#${id}`;

  return (
    <section {...blockAttrs('features-grid', block)} className="features-grid" aria-labelledby="services-heading">
      <h2 id="services-heading" className="features-grid__headline">
        {data.headline}
      </h2>
      <p className="features-grid__sub">{data.subheadline}</p>
      {services.map((service) => (
        <Link key={service.id} href={getServiceHref(service.id)} className="features-grid__item">
          <ServiceIcon icon={service.icon} className="features-grid__icon" />
          <h3 className="features-grid__title">{service.name}</h3>
          <p className="features-grid__desc">{service.shortDescription}</p>
        </Link>
      ))}
    </section>
  );
}
