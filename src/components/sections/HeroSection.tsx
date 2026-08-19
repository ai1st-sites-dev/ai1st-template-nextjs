import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import HeroLeadForm from './HeroLeadForm';
import type { BlockConfig } from '@/lib/types/config';

// 🔴 `data.form` 只有 `block_layout: "with-form"` 那条路读它（表单的按钮文案 / 成功提示，#1065）。
// 说明写在 interface **外面**是有意的：`scripts/block-migration/gen-allblocks.js` 按文本切这份字段表
// （`fields()`），一条写在里面的注释会被它当成又一个字段名，写进演示站的夹具数据里 —— 实测过一次。
interface HeroSectionProps {
  data: {
    headline: string;
    subheadline: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
    imageUrl?: string;
    form?: { buttonText?: string; successMessage?: string };
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1008 — ONE MARKUP, AND NOTHING ELSE. Phase 2's first block, finishing what #991 started.
//
// #991 added the markup below behind a themeCss check and deleted nothing; that switch was never on in
// production (no code writes `css` into theme.json), so every site still rendered one of nine variant
// trees. This ticket deleted those nine and the switch with them. There is one tree now, and where its
// parts go is a stylesheet's business.
//
// 🔴 WHAT THIS COST, ON PURPOSE (spec D3 + D12, Chris 2026-08-13): all 30 of the old themes name a hero
// variant (`gradient-overlay` ×5, `light-split` ×4, `minimal` ×4, `left` ×4, `split` ×3,
// `light-editorial` ×3, `video-style` ×3, `light-showcase` ×3, `centered` ×1) and not one of those
// values reaches the page any more. The old pool is frozen and retired; the real pool is generated in
// phase 3 against the final contract. Until then a site's hero is base.css's look (#1001 — plain, but
// readable) or one of the three proof sheets in public/themes/.
//
// 🔴 `variant` IS STILL WRITTEN AND NO LONGER READ — that is deliberate, do not "fix" it here (AC5).
// Page JSON carries `data.variant`, and sync-config.js still overwrites it from the applied theme's
// layout table (the line reading `block.data = { ...(block.data || {}), variant: preferred }` — quoted
// rather than numbered because that file moves under other tickets almost daily; it was :484 when this
// comment was first written and :485 by the time the ticket was delivered, two commits later).
// Both stay, because the other 33 blocks have not moved yet and they read it through the
// same path. For hero specifically the field is inert until phase 3's pool gives it a meaning again.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('hero', block)`, never `blockAttrs('hero')`.
// #998 put the page JSON's `block_layout` and `role` on the root element through that second argument,
// and hero is the ONE block phase 2 has moved to neutral markup, i.e. exactly the block a theme sheet
// has to be able to name by content shape. Dropping the argument is silent in every instrument we own:
// `registry.ts` types the components as `ComponentType<any>`, so `tsc` cannot see it, the build stays
// green, and the page still opens — only `data-block-layout` is gone from the tree. QA2 caught this in
// r1 (the r1 bytes were cut from a pre-#998 copy of this file).
//
// 🔴 WHY media AND body ARE SIBLINGS AND NOT NESTED: CSS grid only places CHILDREN. Wrapping them in
// the usual `<div class="container">` would let a sheet stack them but never swap their order or give
// one of them a different share of the row, which is exactly the difference the three sheets show.
// Flat is not tidiness here, it is the whole mechanism.
//
// 🔴 THE ROLE MARKS ARE LOAD-BEARING, NOT DECORATION (spec §4.2). `essential` is what a theme may never
// hide, and the invariant checker reads the computed display of exactly these attributes — with no
// `data-role` in the tree that check passes by having nothing to look at.
export default function HeroSection({ data, block }: HeroSectionProps) {
  return (
    <section {...blockAttrs('hero', block)} className="hero">
      {/* Decorative only, and empty on purpose: the contract gives sheets ::before/::after on this
          hook to draw with. Anything a reader needs to KNOW belongs in the body below, where the
          structured data and the translations can see it. */}
      <div className="hero__deco" data-role="optional" aria-hidden="true" />
      <div className="hero__media" data-role="optional">
        {data.imageUrl ? (
          <img className="hero__img" src={data.imageUrl} alt={data.headline} />
        ) : null}
      </div>
      <div className="hero__body" data-role="essential">
        <h1 className="hero__title">{data.headline}</h1>
        <p className="hero__sub">{data.subheadline}</p>
        <div className="hero__cta">
          {/* 🔴 The buttons keep the SITE's button classes rather than getting hooks of their own.
              A theme owns layout; what a primary button looks like is the brand's, and it already
              follows the palette through CSS variables (globals.css @layer components). Giving
              sheets a hook here would let one of the 30 themes quietly restyle every call to
              action on the site, which is a much bigger promise than "the picture moves". */}
          <Link href={data.ctaPrimary?.href ?? '#'} className="btn-accent text-lg">
            {data.ctaPrimary?.label}
          </Link>
          <Link href={data.ctaSecondary?.href ?? '#'} className="btn-secondary text-lg">
            {data.ctaSecondary?.label}
          </Link>
        </div>
      </div>
      {/* 🔴 #1065 — 第八个部件，只有站自己在页面 JSON 里说「这块 hero 是带表单的那种」才出现。
          判据是 `block_layout`（轴一，内容结构，归站）——**不是**主题的 `supports.hero`（那是主题在
          声明「我给这种形态写了造型」，spec D4 的方向）。两者搞反的后果是主题替站决定了这个站的
          首屏收不收客人的联系方式，而那是内容结构，不是外观（08-12 spec D5 / 08-18 spec D3）。

          🔴 它是 `.hero` 的**直接子元素**，跟 media / body 平级。这跟本文件上面那条「media 和 body
          为什么不套一层」是同一件事：网格只摆得动直接子元素，套一层这个表单就再也换不到别的位置。 */}
      {block?.block_layout === 'with-form' ? <HeroLeadForm data={data.form} /> : null}
    </section>
  );
}
