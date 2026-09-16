import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Award {
  title: string;
  description?: string;
  year?: string;
}

interface AwardsCertificationsSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    awards: Award[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F.
//
// Three branches went out of here (`banner`, `detailed` and the `grid` fallback), selected by
// `data.variant`. Measured before deleting them: all three read `data.headline` and
// `data.awards[].title` / `.year` / `.description`; the only difference in the field set is that
// `banner` skipped `subheadline` and each award's `description` — it DROPPED content rather than
// carrying different content, which is a look, not a content structure (the same reading that made
// `page-header`'s `with-description` a look in #1019). There was nothing left for a content-structure
// axis to say here (#1341 retired `block_layout` outright): a sheet that wants the banner look hides
// those two parts itself.
//
// 🔴 WHAT NO SHEET CAN REDRAW: the star SVG each branch drew next to an award. Contract §2 admits
// `content` only as the empty string, so a sheet cannot put a glyph there — but it CAN do
// `.awards-certifications__item::before { content: ""; background-image: url(data:image/svg+xml,…) }`,
// which is a star and is what the three sheets below do. Nothing is lost here; the note exists
// because "an inline SVG in the markup" is the case where that has to be checked rather than assumed.
//
// 📌 #1341 — this line used to read "`variant` IS STILL WRITTEN AND NO LONGER READ". It is no
//    longer written either: sync-config.js's line that overwrote `data.variant` from the theme
//    went with the rest of that dimension, and a page JSON that still carries the key has it
//    dropped on read (`scripts/blocks.js` §normalizeListSlots), so it never reaches a component.
// 🔴 `variant` IS NO LONGER WRITTEN AND NO LONGER READ — the same deliberate state as hero's,
// cta-banner's, page-header's and batch B's (#1008 AC5). Do not "fix" it here. It is gone from the
// props type above, which is the whole of that precedent: a component that declares a field it never
// reads tells the next reader the field still matters. `blocks/awards-certifications.json` no longer
// declares the slot (#1341 deleted it there); its three-key `variants` table is untouched — that file is what the site building AI writes
// against, and the blocks phase 2 has not reached yet read theirs through the same path. Measured on
// the six live sites: 6 instances, `grid` 4 (a value this component never had a branch for — it fell
// to the default) and `detailed` 2.
//
// 🔴 EVERY PART IS A DIRECT CHILD OF THE BLOCK, one flat level, because CSS grid only places
// CHILDREN. That is what lets a sheet do the old `banner` look — headline on the same row as the
// awards — without the markup choosing (spec §4.1, and the same reason values-grid is flat).
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('awards-certifications', block)`, never
// `blockAttrs('awards-certifications')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
export default function AwardsCertificationsSection({ data, block }: AwardsCertificationsSectionProps) {
  return (
    <section
      {...blockAttrs('awards-certifications', block)}
      className="awards-certifications"
      aria-labelledby="awards-heading"
    >
      <h2 id="awards-heading" className="awards-certifications__headline">
        {data.headline}
      </h2>
      {data.subheadline && (
        <p className="awards-certifications__sub">{data.subheadline}</p>
      )}
      {data.awards?.map((award, index) => (
        <div key={index} className="awards-certifications__item">
          <h3 className="awards-certifications__title">{award.title}</h3>
          {award.year && <p className="awards-certifications__year">{award.year}</p>}
          {award.description && (
            <p className="awards-certifications__desc">{award.description}</p>
          )}
        </div>
      ))}
    </section>
  );
}
