import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

// 🔴 #1333 —— 表单那一支搬走了。带表单的首屏现在是自己一个块类型 `hero-with-form`
// （`HeroWithFormSection.tsx`），`data.form` 跟着它走，这里不再有这个字段。hero 从此只剩
// 「有图 / 没图」两种内容结构，两种都是下面这同一份 HTML，差别归 `public/shapes.css`。
// 说明写在 interface **外面**是有意的：`scripts/block-migration/gen-allblocks.js` 按文本切这份字段表
// （`fields()`），一条写在里面的注释会被它当成又一个字段名，写进演示站的夹具数据里 —— 实测过一次。
// 🔴 #1374 —— 可选槽 `socialProof`：CTA 下面那条社会证明（头像组 + 评分 + 一句话），出处是 FlyonUI
// hero-3 / hero-4 左栏 CTA 下方那一条（Chris 2026-09-16 在对表里定为「要」）。不填时整块不渲染，
// 页面一个像素不变；形态数不变（仍是那七种），`needs` 一个都不改 —— 它是装饰，没有它每种形态照样成立。
// 🔴 头像那一串是**对象**而不是字符串数组，字段名沿用既有的 `imageUrl` —— 这两点都是量出来的，
// 别"简化"回去：
//   · AI 改站那条路上有一道闸只认 `IMAGE_FIELDS` 里的键、而且**只在值是字符串时**收
//     （`scripts/lib/image-urls.js` §collectImagePositions）。写成 `avatarImages: string[]` 的话，
//     模型编出来的头像地址整条通道对它隐身 —— 正是 #1195 治的那个毛病（老板看见一张裂图）。
//   · `image-urls.test.js` 那道两向守卫从**这份组件**现读 `<img src={…}>` 的叶子字段名，两边差一个
//     就当场红：叫 `imageUrl` 就落在既有的清单与 `edit-site.js` 的 `## Images` 段里，不用新开口子。
//   · 演示站夹具从这个接口合成（`gen-allblocks.js` 的 `synth()`），名字带 image 才会合成出一个真的
//     图片路径 —— `imageUrl` 同样满足。
interface HeroSectionProps {
  data: {
    headline: string;
    subheadline: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
    imageUrl?: string;
    socialProof?: {
      avatars?: { imageUrl?: string }[];
      rating?: string;
      text?: string;
    };
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
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
// 🔴 `variant` IS NO LONGER READ HERE — that is deliberate, do not "fix" it here (AC5).
// 📌 #1341 — it is no longer WRITTEN by us either: sync-config.js used to overwrite `data.variant`
//    from the applied theme's layout table, and that line went with the rest of that dimension. A
//    page JSON that already carries `data.variant` keeps carrying it and nobody reads it.
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('hero', block)`, never
// `blockAttrs('hero')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
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
        {/* 🔴 #1374 —— 这个零件住在 `hero__body` 【里面】是承重的，不是随手放的。#1332 的排版探针只看
            `<section data-block="hero">` 的**直接子元素**（`scripts/lib/layout-intent.mjs:78`），而 hero
            七种形态全写着 `items: "none"` 与 `headline: "none"`。头像组天生是一排同类元素 —— 它或它的
            包装层一旦成了直接子元素（带 `data-block-part` 的包装层也算候选面，`:88-92`），`items-none`
            （`:235`）会让七格一起红；第一个 class 若以 `__title` / `__headline` / `__heading` 结尾，
            `headline-none`（`:276`）同样七格一起红。放在 body 里面，那五根轴一根都不会换读数。
            ⟹ 改这里的人：不许上提成直接子元素、不许加 `data-block-part`、第一个 class 不许以那三个
            后缀（以及 `__media`）结尾。 */}
        {data.socialProof ? (
          <div className="hero__proof">
            {data.socialProof.avatars?.length ? (
              <span className="hero__proof-avatars">
                {data.socialProof.avatars.map((avatar, i) => (avatar?.imageUrl ? (
                  <img key={`${avatar.imageUrl}-${i}`} className="hero__proof-avatar" src={avatar.imageUrl} alt="" />
                ) : null))}
              </span>
            ) : null}
            {data.socialProof.rating ? (
              <span className="hero__proof-rating">{data.socialProof.rating}</span>
            ) : null}
            {data.socialProof.text ? (
              <span className="hero__proof-text">{data.socialProof.text}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
