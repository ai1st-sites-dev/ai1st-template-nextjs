import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface NewsletterSignupSectionProps {
  data: {
    headline: string;
    description?: string;
    buttonText?: string;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F.
//
// Four branches went out of here (`card`, `minimal`, `split` and the `inline` fallback), selected by
// `data.variant`. Measured before deleting them: all four read `data.headline` / `data.description` /
// `data.buttonText`, and `minimal` merely skipped the description — dropped content, not different
// content, which is a look (same reading as awards' `banner` above). There was nothing left for a
// content-structure axis to say here, and #1341 retired `block_layout` outright.
//
// 🔴 THE CONTROLS ARE UNREACHABLE FROM A SHEET, NOT "LEFT TO BASE" — the distinction #1027 had to
// draw for the two forms applies here too. Contract §1 refuses tag selectors, so `input` and
// `button` cannot be selected by any theme; they are laid out by the structure layer in
// `globals.css`, which is allowed to select a tag, and they take their border and text colour from
// `currentColor` so they stay legible whatever ground a sheet paints. What a sheet owns here is the
// block, the headline, the description and the form's box.
//
// 🔴 THE FORM STILL DOES NOTHING, AND THAT IS NOT THIS TICKET'S DOING — `action="#"`, the input is
// `readOnly` and the button is `type="button"`. All four old branches were like that. This ticket
// moves markup; wiring a newsletter block to a real list is a product decision nobody has made.
//
// 📌 MEASURED AND OUT OF SCOPE, RECORDED SO THE NEXT READER DOES NOT RE-FIND IT: the one live
// instance of this block (site-bbf7a3d6) writes `subheadline` / `placeholder` / `buttonLabel` /
// `privacyNote` — and this component reads none of those names. It reads `description` /
// `buttonText`. So that block renders its headline, an English default button and nothing else,
// both before and after this change. That is the #1012 family of defect (page JSON and component
// disagree on a field name), it predates this ticket, and it is not in this ticket's scope.
//
// 📌 #1341 — this line used to read "`variant` IS STILL WRITTEN AND NO LONGER READ". It is no
//    longer written either: sync-config.js's line that overwrote `data.variant` from the theme
//    went with the rest of that dimension, and a page JSON that still carries the key has it
//    dropped on read (`scripts/blocks.js` §normalizeListSlots), so it never reaches a component.
// 🔴 `variant` IS NO LONGER WRITTEN AND NO LONGER READ (#1008 AC5 precedent) — the component that
// carried that note went with the four blocks #1372 deleted. Live: 1 instance, `inline`.
export default function NewsletterSignupSection({ data, locale, block }: NewsletterSignupSectionProps) {
  const labels = getLabels(locale);
  const buttonText = data.buttonText || labels.subscribe;

  return (
    <section
      {...blockAttrs('newsletter-signup', block)}
      className="newsletter-signup"
      aria-labelledby="newsletter-heading"
    >
      <h2 id="newsletter-heading" className="newsletter-signup__headline" data-slot="headline">
        {data.headline}
      </h2>
      {data.description && (
        <p className="newsletter-signup__desc" data-slot="description">{data.description}</p>
      )}
      <form action="#" className="newsletter-signup__form">
        <input
          type="email"
          placeholder={labels.enterYourEmail}
          aria-label={labels.emailAddress}
          readOnly
        />
        <button type="button" data-slot="buttonText">{buttonText}</button>
      </form>
    </section>
  );
}
