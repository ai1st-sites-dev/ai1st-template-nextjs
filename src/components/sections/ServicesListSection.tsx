import Link from 'next/link';
import ServiceIcon from '@/components/ServiceIcon';
import { getServices, pagesByLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

// 🔴🔴 #1027 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch B. No variant branch to delete here
// either; the move is the other half of the job — the Tailwind classes that decided a look are gone
// and each part carries one BEM hook the three proof sheets dress.
//
// 🔴 THIS BLOCK IS `essential`, AND IT CARRIES A SECOND JOB NOBODY WOULD GUESS FROM ITS MARKUP:
// `SubPage.tsx:14` reads whether a page HAS a `services-list` block and emits the Service structured
// data on that basis (`blockAttrs.ts:37` says the same). That switch reads the page JSON, not the
// DOM — so this rewrite cannot move it, and the reading that proves it is the JSON-LD in the built
// pages coming out byte-identical either side of the change.
//
// 🔴 THE SIX PARTS OF ONE SERVICE ARE SIBLINGS, NOT TWO COLUMNS OF WRAPPERS. The old markup nested
// them in a `grid lg:grid-cols-2` with a left `<div>` and a right `<div>`; that IS the two-column
// look, and CSS grid only places CHILDREN, so making them children of `.services-list__item` is what
// lets a sheet decide one column or two — and which side each part lands on — without the markup
// having an opinion. `hero-media-right.css` puts the features box on the left for exactly that reason.
//
// 🔴 THE `<article id={service.id}>` AND ITS `scroll-mt` ARE NOT COSMETIC. `services-nav` links to
// `#<service.id>`, so the id stays; the scroll offset that keeps the sticky nav from covering the
// heading moves to globals.css (`scroll-margin-top` on `.services-list__item`), because it is a
// property of the structure, not of any theme, and `scroll-margin-*` is not on the contract's list.
//
// 🔴 THE PER-FEATURE TICK `<svg>` IS GONE — a sheet paints a mark with `::before { content: "" }` +
// `background-image`, which is the boundary #1018 drew when it deleted the `dark` variant's overlay.
// The service's OWN icon stays: it comes from services.json, so it is content, not decoration, and
// `.services-list__icon` is the hook the sheet sizes it through.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('services-list', block)`, never
// `blockAttrs('services-list')` (#998's `data-block-layout`, invisible to `tsc`; #1008 r1's bounce).
export default function ServicesListSection({ locale, block }: { locale: string; block?: BlockConfig }) {
  const services = getServices(locale);
  const labels = getLabels(locale);
  const allPages = pagesByLocale[locale] ?? [];
  const serviceDetailSlugs = new Set(
    allPages.filter(p => p.slug.startsWith('services/') && p.slug !== 'services').map(p => p.slug.replace('services/', ''))
  );

  return (
    <div {...blockAttrs('services-list', block)} className="services-list">
      {services.map((service) => (
        <article key={service.id} id={service.id} className="services-list__item">
          <ServiceIcon icon={service.icon} className="services-list__icon" />

          <h2 className="services-list__title">{service.name}</h2>

          <p className="services-list__desc">{service.fullDescription}</p>

          <div className="services-list__actions">
            <Link href={localeUrl('quote', locale)} className="btn-primary">
              {labels.getAQuoteFor} {service.name}
            </Link>
            {serviceDetailSlugs.has(service.id) && (
              <Link href={localeUrl(`services/${service.id}`, locale)} className="btn-secondary">
                {labels.learnMore}
              </Link>
            )}
          </div>

          <div className="services-list__features">
            <h3>{labels.keyFeatures}</h3>
            <ul>
              {service.features.map((feature, i) => (
                <li key={i}>{feature}</li>
              ))}
            </ul>
          </div>

          {service.products.length > 0 && (
            <div className="services-list__products">
              <h3>{labels.productsWeOffer}</h3>
              {service.products.map((product) => (
                <div key={product.name}>
                  <h4>{product.name}</h4>
                  <p>{product.description}</p>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
