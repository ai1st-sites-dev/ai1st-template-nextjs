import { brand } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ContactInfoSectionProps {
  data: {
    headline: string;
    imageUrl?: string;
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1028 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch C, and the only `essential` block in it.
//
// Four branches went out of here — `cards` (the default), `inline`, `map-style` and `banner`. All four
// read exactly `data.headline`, `brand.locations[].label` / `.address` / `.phone` and `brand.email`:
// the same fields, no more and no less. Nothing about content structure differed, so all four were
// skins, and skins belong in a stylesheet (spec §4.1, D5). There was nothing left for a
// content-structure axis to say here, and #1341 retired `block_layout` outright.
//
// 🔴 THE MARKUP BELOW IS THE UNION OF THE FOUR, NOT ANY ONE OF THEM, AND FOR THIS BLOCK THAT IS THE
// WHOLE POINT. Three of the four branches wrapped the phone in `tel:`; the `cards` default printed it
// as plain text inside a summary line. Three printed the address per location; `cards` printed it too
// but dropped the per-location phone link. Taking any single branch as the model would have DELETED a
// way for a customer to reach this business — which is what `essential` means here (`block-roles.json`),
// and is why this ticket's AC-E compares the `tel:` / `mailto:` SET before and after rather than one
// arm's HTML. Measured on the union arm (a page carrying all four old looks): the set of `href="tel:…"`
// and `href="mailto:…"` is unchanged by this migration, and so is the set of address / phone / email
// strings the block renders.
//
// 🔴 THE MAP PLACEHOLDER IS GONE AND NOTHING REPLACES IT IN THE MARKUP. `map-style` drew an empty
// gradient box — a decoration with no content in it — and contract §2 lets a sheet draw exactly that
// (`background` on `.contact-info`, or a part it already has). A `<div>` whose only purpose is to be
// painted is the markup deciding a look, which is the thing this phase removes.
//
// 📌 #1341 — this line used to read "`variant` IS STILL WRITTEN AND NO LONGER READ". It is no
//    longer written either: sync-config.js's line that overwrote `data.variant` from the theme
//    went with the rest of that dimension, and a page JSON that still carries the key has it
//    dropped on read (`scripts/blocks.js` §normalizeListSlots), so it never reaches a component.
// 🔴 `variant` IS NO LONGER WRITTEN AND NO LONGER READ — hero's, cta-banner's, page-header's and batch B's
// are in the same deliberate state (#1008 AC5), do not "fix" it here. It is gone from the props type
// above, which is all of their precedent: a component that declares a field it never reads is telling
// the next reader it matters. The key is still on disk in older sites, but the build drops it before rendering (#1341),
// so nothing breaks; `blocks/contact-info/manifest.json` no longer declares the slot (#1341) but still carries its four-key `variants`
// table, untouched — that file is what the site building AI writes against.
//
// 🔴 EACH LOCATION'S THREE LINES ARE CHILDREN OF THE LOCATION, AND THE LOCATIONS ARE CHILDREN OF THE
// BLOCK — one flat level each, because CSS grid and flex only place CHILDREN. That is what lets a
// sheet lay the locations out in a row (the old `banner`), in a column with rules between them (the
// old `inline`), or beside a painted panel (the old `map-style`) without the markup choosing.
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('contact-info', block)`, never
// `blockAttrs('contact-info')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.generated.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
// ══ #1382：一个可选图槽 `imageUrl` + 一个可选媒体零件 + 一种形态 `media-side-grid` ═══════════════
//
// 对表 FlyonUI 的 contact-us-1（左实景图 + 右联系方式）。三样**同一张票一起 ship**：没有零件形态画不
// 出来，没有形态零件没人用。
//
// 🔴 **这个字段的说明写在这儿，不写在上面那个 `data: { … }` 里面 —— 那对花括号里一条注释都不能有。**
// 量主题用的那份夹具页是从这段类型文本现切出来的（`scripts/block-migration/gen-allblocks.js` §fields：
// 在 `data: {` 和它配对的 `}` 之间按顶层的 `;` / `,` 切，每段取第一个 `:` 之前的那串当字段名）。一条
// 注释落在字段前面，切出来的「字段名」就是注释加字段名那一长串，于是全填版夹具里那个槽根本不存在 ——
// 而它的下场不是红，是那一格的 media 轴退化成「报告而不判」（#1362 实测过）。
//
// 🔴 `imageUrl` 这个名字是抄来的，不是随手起的：写入闸 `scripts/lib/image-urls.js` 的 `IMAGE_FIELDS`
// 按【字段名】认「这个值是一张图的地址」。换个名字那道闸就看不见它，AI 编出来的地址会一路写进老板的
// 站里。另外 `scripts/edit-site.js` 的 `## Images` 段也要跟着列一行，否则 `image-urls.test.js` 的两向
// 守卫当场红。
//
// 🔴 零件**有则出、无则不出**，排在骨架最后（D14 第 2 条），前面几个零件一个字节没动。
//
// 🔴 **不能改成「只在 `media-side-grid` 这一副才渲染这个零件」** —— PM 裁定给的两个选项里那一个在
// 这里走不通，实测过机制：量主题那道检查是**在浏览器里逐个把 `data-shape` 换成 manifest 里的每一种**
// （`scripts/theme-css-invariants.mjs` §`el.setAttribute('data-shape', x)`），而静态产物里的 DOM 是
// 构建时定死的 —— 按形态条件渲染的话，`media-side-grid` 那一格根本没有图可量，`media: side` 整条
// 退化成「报告而不判」，本票要的那个读数就没了。所以零件恒在（图填了就在），藏与不藏归形态层。
//
// 🔴 第一个 class 以 `__media` 结尾是**故意**的：`media-side-grid` 的 `layout_intent.media` 写着 `side`，
// 而排版意图探针认「哪个零件是图」看的就是这个后缀，并且只看 `[data-block]` 的**直接子元素**
// （`scripts/lib/layout-intent.mjs` §isMedia / §mediaEl）。塞进别的包装层里，探针就量不到它。
//
// 🔴 `data-role="optional"` 跟 `.hero__media` / `.hero__deco` 是同一条，而在这个块上它是**承重**的：
// `contact-info` 是 `essential` 块（`block-roles.json`），而契约 §3 说 essential 块里带内容的零件
// 一律不许被藏 —— 检查 ② 的探针按 `hasText || hasMedia || hasLink` 收零件，这个 div 里有 `<img>`
// 所以它收。下面那条「另外三种形态把它藏起来」于是会被判成违约（实测过：
// `"contact-info__media" … is hidden by div.contact-info__media { display: none } … contract §3`）。
// 探针自己留的出口就是这个属性（`.filter((el) => !el.closest('[data-role="optional"]'))`，跑完会把
// 跳过的零件名字打出来），语义也正好对：这张图是装饰，客人靠它联系不到这门生意。
//
// 🔴 **另外三种形态写着 `media: none`（= 断言「这个块【没有】图」），所以那三种必须让这个零件真的
// 不参与排版。** 这件事由 `public/shapes.css` 管：那里给这个零件写了一条**块级默认 `display: none`**，
// 只有 `[data-shape="media-side-grid"]` 那一段把它放出来。为什么是默认隐藏 + 单点放出，而不是给那三种
// 各写一条 `display: none`：将来有人加第 5 种形态时，「忘了给新形态也写一条」这件事是**静默**的 ——
// 图会在一个写着 `media: none` 的形态上冒出来。默认隐藏把这个方向反过来：忘了写，图就不出现，而
// ⑨ 的 `media-side` 断言会当场点名（探针判「在不在版面里」用的是 `display !== 'none'`，#1337）。
export default function ContactInfoSection({ data, block }: ContactInfoSectionProps) {
  return (
    <section {...blockAttrs('contact-info', block)} className="contact-info" aria-labelledby="locations-heading">
      <h2 id="locations-heading" className="contact-info__headline" data-slot="headline">
        {data.headline}
      </h2>
      {brand.locations.map((location) => (
        <div key={location.label} className="contact-info__location">
          <h3 className="contact-info__label">{location.label}</h3>
          <p className="contact-info__address">{location.address}</p>
          <a href={`tel:${location.phone.replace(/\s/g, '')}`} className="contact-info__phone">
            {location.phone}
          </a>
        </div>
      ))}
      <a href={`mailto:${brand.email}`} className="contact-info__email">
        {brand.email}
      </a>
      {data.imageUrl ? (
        <div className="contact-info__media" data-role="optional">
          {/* `<img>` 不是契约钩子，跟 `.hero__img` / `.content-split__media img` 是同一条边界：
              盒子归形态层和主题，图片本身归 `globals.css`，一个属性只有一个主人。 */}
          <img src={data.imageUrl} alt="" />
        </div>
      ) : null}
    </section>
  );
}
