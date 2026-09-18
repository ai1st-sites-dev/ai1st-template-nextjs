import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface CtaBannerSectionProps {
  /** #1361 —— `data.avatars` 是一组头像（可选装饰）。空着时整条带子 `display: none`
   *  （public/shapes.css 末尾那族），元素留着，跟媒体容器空着时的处置逐字同一条（#1337）。
   *  🔴 每一项的图片字段叫 `imageUrl`，跟 hero / content-split / gallery 逐字相同，**这不是随手起的名**：
   *  写入闸 `scripts/lib/image-urls.js` 的 `IMAGE_FIELDS` 按【字段名】认「这个值是一张图的地址」，
   *  换个名字（`avatarImages: string[]` 那种）它对这里按构造失明 —— 模型编出来的外链会落盘。
   *  实测：那一版让 `scripts/lib/image-urls.test.js` 当场红三格。
   *
   *  🔴🔴 **这段话必须待在 `data` 那一层外面，别挪回字段头上。** 全填版夹具是
   *  `scripts/block-migration/gen-allblocks.js` 从这个类型现造的，它的 `fields()`（:16-33）按最外层的
   *  `,` / `;` 切段、拿**第一个冒号**前面那截当字段名，而且**不剥注释**。这段话里有一个
   *  `` `display: none` `` ⟹ 整段注释连同后面那个字段被切成一个名叫
   *  `/** #1361 —— 一组头像（可选装饰）。空着时整条带子 \`display` 的字段，**`avatars` 一次都不出现**。
   *  失败方向是静默的：夹具照样生成、检查 ⑨ 照样全绿，只是那几格量的是「头像不在」的画面 ——
   *  #1361 第一版就是这么交出去的，QA1 在验收标准第 3 条上抓到（同一个洞在 `card-group__features`
   *  上咬过一次，出处见 `scripts/theme-css-invariants-sample-pages.js` 的文件头）。
   *  🔴 注意：不是「别写带冒号的注释」——`fields()` 把注释正文一起算进字段名，所以
   *  **`data` 那一层里任何一条注释都会吃掉它下面那个字段**，有没有冒号只决定名字被截在哪儿。
   *  🔴 还有一条同源的：这段话里**不许出现 `data:` 紧跟一个左花括号**那个写法。定位那一层用的是
   *  `src.match(/data:\s*\{/)` —— 全文第一处命中，写在注释里就把它抢走了，然后从注释里那个括号
   *  开始配对，切出来的字段是**空的**（我改这段注释时第一版就这么写，当场读到 `[]`）。
   *  判据（改完跑一次）：`node scripts/block-migration/gen-allblocks.js` 之后
   *  `site/en/pages/allblocks.json` 里 cta-banner 的 data 键要有 `avatars`，值是三个图片路径。 */
  data: {
    headline: string;
    description: string;
    button: { label: string; href: string };
    avatars?: { imageUrl: string }[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
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
// 📌 #1341 — this line used to read "`variant` IS STILL WRITTEN AND NO LONGER READ". It is no
//    longer written either: sync-config.js's line that overwrote `data.variant` from the theme
//    went with the rest of that dimension, and a page JSON that still carries the key has it
//    dropped on read (`scripts/blocks.js` §normalizeListSlots), so it never reaches a component.
// 🔴 `variant` IS NO LONGER WRITTEN AND NO LONGER READ — the same deliberate state hero is in (#1008 AC5),
// do not "fix" it here. It is also gone from the props type above, which is hero's precedent too
// (`git show origin/main:…/HeroSection.tsx` — its `data` names five fields and `variant` is not one):
// a component that declares a field it never reads is telling the next reader it matters. The key is still
// on disk in older sites, but the build drops it before rendering, so nothing breaks; the manifest
// (`blocks/cta-banner.json`) still carries the `variants` table — that file is what the AI writes
// against.
// 📌 #1341 — the manifest's `variant` SLOT is gone, and so is sync-config.js's line that overwrote
//    `data.variant` from the applied theme's `supports`. A page JSON that already carries
//    `data.variant` keeps carrying it and nobody reads it.
// All 30 frozen themes name a cta-banner variant (`gradient` ×9,
// `dark` ×7, `solid` ×6, `outlined` ×4, `split` ×4) and not one of those values reaches the page any
// more; that is the accepted degradation (spec D3 + D12, Chris 2026-08-13) — the old pool is retired
// and the real one is generated in phase 3 against the final contract. The overwrite is gone (#1341); the manifests
// keep their `variants` tables because that is what the site-building AI writes against.
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('cta-banner', block)`, never
// `blockAttrs('cta-banner')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
export default function CtaBannerSection({ data, block }: CtaBannerSectionProps) {
  return (
    <section {...blockAttrs('cta-banner', block)} className="cta-banner" aria-labelledby="cta-heading">
      <h2 id="cta-heading" className="cta-banner__headline" data-slot="headline">
        {data.headline}
      </h2>
      <p className="cta-banner__desc" data-slot="description">
        {data.description}
      </p>
      {/* 🔴 The button keeps the SITE's button class rather than getting a hook of its own — the same
          boundary hero draws. A theme owns layout; what a call to action looks like is the brand's,
          and it already follows the palette through CSS variables (globals.css @layer components).
          The hook is on the box AROUND it, so a sheet can move the button (the old `split` look put it
          in a column of its own) without being able to restyle every call to action on the site. */}
      <div className="cta-banner__action">
        <Link href={data.button?.href ?? "#"} className="btn-accent text-lg" data-slot="button.label">
          {data.button?.label}
        </Link>
      </div>
      {/* 🔴 #1361 — THE AVATAR STRIP IS LAST IN THE SKELETON, AND THAT IS NOT A STYLE CHOICE.
          `text-left-action-right` puts the description on the left and the buttons on the right by
          letting the grid place them itself (both parts say `grid-column: auto`, public/shapes.css),
          so a part inserted BEFORE them changes which cell each one lands in. A shape that wants the
          faces higher up says so with `order`, which is what the shape layer is for.

          🔴 NO `data-block-part` ON THE WRAPPER. The layout probe's candidate pool goes one level
          INTO such a wrapper (`scripts/lib/layout-intent.mjs`), so a group of same-class faces would
          read as N sibling items — and all five cta-banner shapes declare `items: none`. Hiding the
          box would not save it either: the pool is built from every child, not from the laid-out
          ones (PM measured this on #1358 and ruled it on #1361).

          🔴 The first class may not end in `__media` or `__headline` / `__heading` / `__title`:
          those suffixes are how `layout-intent-vocab.json` decides "this part is the picture" and
          "this part is the heading", and all five shapes here say `media: none`.

          The picture itself is deliberately not a contract hook, the same boundary `.hero__img`
          draws (globals.css): the platform owns the <img>, and for this family it owns the box too
          until a faces recipe exists (PM's ruling ⓐ on #1361). */}
      <div className="cta-banner__avatars">
        {/* 🔴 #1361 r4 — 每一张脸先判有没有地址，没有就**不出这个 `<img>`**（跟 `HeroSection` 的
            `socialProof.avatars` 逐字同一条写法）。`src={a && a.imageUrl}` 那种写法在 `a` 是
            `{}` / `'bare'` 这类条目上得到 `undefined` / 一个不是地址的串，浏览器当场画一个破图 ——
            #1358 r1 退回的是同一个形状（图片带里缺 `imageUrl` 的条目导出成没有 src 的 `<img>`），
            PM 在 #1361 r3 验收里把两票的口径定成同一个：修。 */}
        {(data.avatars ?? []).map((a, i) => (a?.imageUrl ? (
          <img key={`${a.imageUrl}-${i}`} className="cta-banner__avatar" src={a.imageUrl} alt="" />
        ) : null))}
      </div>
    </section>
  );
}
