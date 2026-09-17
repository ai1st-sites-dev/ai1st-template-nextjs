import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface SocialProofSectionProps {
  data: {
    headline: string;
    overallRating: string;
    totalReviews: string;
    platforms?: { name: string; rating: string; reviews: string }[];
    badges?: string[];
    featuredQuote?: { text: string; author: string };
    stats?: { value: string; label: string }[];
    imageUrl?: string;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1031 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch F, and the block whose four branches
// disagreed most about WHAT THEY SHOW.
//
// Four looks went out (`badges`, `review-platforms`, `highlight` and the `rating-bar` fallback),
// selected by `data.variant`. Measured before deleting them, per branch and per field — four
// branches, four different field sets, which is the widest spread in this batch:
//
//     rating-bar          headline · overallRating · totalReviews
//     badges              headline · badges
//     review-platforms    headline · platforms
//     highlight           headline · overallRating · featuredQuote
//
// #1031 put that difference in `block_layout` (four values: `default` — the rating on its own —
// plus `with-platforms`, `with-badges`, `with-quote`).
// 📌 #1341 retired that field. What names the difference today is which optional slots the page
//    actually filled — `data-has-platforms` / `data-has-badges` / `data-has-featuredQuote` on the
//    root element (#1331) — asked of the data instead of of a typed name. 🔴 That hook belongs to
//    the PLATFORM's layout layer (`public/shapes.css`); it is not on the theme contract's §1 list,
//    so a theme sheet cannot select it.
//
// 🔴 BUT THE FOUR FIELD SETS ARE NOT DISJOINT IN REAL DATA, AND THAT CHANGES WHAT THIS BLOCK SHOWS
// TODAY — the loudest consequence in this batch, so it is written here rather than left to be found.
// On the six live sites all 12 instances carry `overallRating` AND `totalReviews`, 11 carry
// `featuredQuote`, 10 carry `platforms`, 6 carry `badges` — while the variant they chose
// (`review-platforms` 6, `highlight` 6) drew exactly one of those. A neutral markup renders what is
// there, so most of these blocks will now show a quote AND the platforms AND the badges where they
// used to show one. The content was always in the page JSON; the old branches were hiding it. If a
// site wants less shown, the answer is to take it out of the page JSON — not to have the component
// silently drop it.
//
// 🔴 THE INVENTED RATING DISTRIBUTION IS GONE, AND IT IS THE BIGGEST THING THIS FILE DELETES. The
// old `rating-bar` branch printed a five-row bar chart from a CONSTANT — `{5: 85%, 4: 10%, 3: 3%,
// 2: 1%, 1: 1%}`, hard-coded in the component, identical on every site that ever used it, with
// `aria-valuenow` on each bar so assistive tech read the invented numbers out as fact. No site's
// data ever reached it. Deleting it is not a migration decision; a stylesheet cannot and must not
// bring it back.
//
// 🔴 THE FIVE STAR SVGs ARE GONE AND THE RATING IS TEXT. Contract §1 refuses tag selectors, so no
// sheet can reach an inline `<svg>`; stars belong on a hook as
// `.social-proof__rating::before { content: ""; background-image: url(data:image/svg+xml,…) }`,
// which is legal (§2 admits `background*`, and `theme-css-lint.js` keeps `data:` URLs legal on
// purpose) and is what the three sheets below do. The accessibility side gets better rather than
// worse: the old markup put the score in an `aria-label` on a `role="img"` div because the stars
// carried no text (#652 had to fight for that label), and now "4.8" and "out of 5" are ordinary
// text that everything can read — screen readers, search engines and AI alike.
//
// 🔴 `/5` AND `reviews` COME FROM THE LOCALE TABLE, NOT FROM THE MARKUP. The old branches wrote
// `{rating}/5 from {n} reviews` and `{n} reviews` in English regardless of the site's language.
// `component-labels.ts` is where the template's own words live; this block now uses it like every
// other block that has words of its own. Two keys were added there — `outOfFive` and `reviews` — in
// all 14 locales rather than in `en` alone: that file's own note says per-key fallback makes the
// English-first shortcut legal, and it is legal, but the fallback's failure is a Chinese page
// quietly printing "reviews", which is the defect being removed here.
//
// 📌 #1341 — this line used to read "`variant` IS STILL WRITTEN AND NO LONGER READ". It is no
//    longer written either: sync-config.js's line that overwrote `data.variant` from the theme
//    went with the rest of that dimension, and a page JSON that still carries the key has it
//    dropped on read (`scripts/blocks.js` §normalizeListSlots), so it never reaches a component.
// 🔴 `variant` IS NO LONGER WRITTEN AND NO LONGER READ (#1008 AC5) — see `AwardsCertificationsSection.tsx`.
// Live: `review-platforms` 6 · `highlight` 6.
//
// 🔴 THE PARTS ARE FLAT, one level under the block, because CSS grid only places CHILDREN. Each
// platform, each badge and the quote are siblings of the headline, so a sheet can put the score in
// its own column, run the badges along one row, or stack everything — without the markup choosing.
// A platform's own three pieces sit inside it and are laid out by the structure layer in
// `globals.css` (contract §1 refuses tag selectors, so no sheet could reach them anyway).
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('social-proof', block)`, never
// `blockAttrs('social-proof')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
// ══ #1376：那个「一排数字」的块并进来了，两个可选槽 `stats` / `imageUrl` ═══════════════════════════
//
// 设计文档 D19 把批次 C 那个专门显示一排数字的块和这个块判成同一类（FlyonUI 的 Social Proof），
// D14 又说「可选槽位空着不算一个新块」⟹ 那个块整个删掉，它唯一的内容（一组数字）变成这里的一个
// 可选槽。老站不迁移：页面 JSON 里还写着那个老块的记录，走 `SectionRenderer.tsx` 的既有兜底消失。
//
// 🔴 **这两个字段的说明写在这儿，不写在上面那个 `data: { … }` 里面 —— 那对花括号里一条注释都不能有。**
// 量主题用的那份夹具页是从这段类型文本现切出来的（`scripts/block-migration/gen-allblocks.js` §fields：
// 在 `data: {` 和它配对的 `}` 之间按顶层的 `;` / `,` 切，每段取第一个 `:` 之前的那串当字段名）。一条
// 注释落在字段前面，切出来的「字段名」就是注释加字段名那一长串，于是全填版夹具里那个槽根本不存在，
// 而它的下场不是红、是一格退化成「报告而不判」（#1362 实测过）。
//
// 🔴 `imageUrl` 这个名字是抄来的，不是随手起的：写入闸 `scripts/lib/image-urls.js` 的 `IMAGE_FIELDS`
// 按【字段名】认「这个值是一张图的地址」。换个名字那道闸就看不见它，AI 编出来的地址会一路写进老板的
// 站里。另外 `scripts/edit-site.js` 的 `## Images` 段也要跟着列一行，否则 `image-urls.test.js` 的两向
// 守卫当场红。
//
// 🔴 两个零件**有则出、无则不出**，排在骨架最后（D14 第 2 条），骨架前面那几个零件一个字节没动。
// 「无则不出」而不是「留个空盒子再藏起来」（hero / content-split 那一族的做法）：那一族的空盒子是留给
// 主题皮画底的钩子，而这两个零件今天没有任何主题皮要画它们 —— 留一个空盒子只会让「可选槽没填」这件事
// 多出一条要在每一种形态里写 `display: none` 的规矩，而每漏一种，老板的页面上就多一条空带子。
//
// 🔴 图放成 `[data-block]` 的**直接子元素**，而且第一个 class 以 `__media` 结尾 —— 这里是**要**被排版
// 意图探针认成「图」的（`scripts/lib/layout-intent.mjs` §isMedia / §mediaEl 只看直接子元素）。塞进别的
// 包装层里，探针就看不见它。代价是 `two-up` / `three-up` 那两副原来写着 `media: none`（= 断言「这个块
// 没有图」），图槽一填就当场红 ⟹ 本票按 #1362 的先例**照实把那两副的 `media` 轴改成 `below`**，并在
// `public/shapes.css` 把图钉在最后一行通栏。不藏图，也不用 `needs` 绕。
//
// 🔴 一条数字的两个零件跟着 `content-split` 的叫法走（`__stat-value` / `__stat-label`），不是
// `__value` / `__label`：这个块已经有 `__rating` / `__reviews` 两个「也是数字」的零件，光秃秃的
// `__value` 在这儿说不清是哪一个。三个新类名都不是契约钩子（主题表选不中它们），跟 #1362 的
// `.faq-accordion__media` 同一条边界：地板在 `public/base.css`，排版在 `public/shapes.css`。
export default function SocialProofSection({ data, locale, block }: SocialProofSectionProps) {
  const labels = getLabels(locale);

  return (
    <section
      {...blockAttrs('social-proof', block)}
      className="social-proof"
      aria-labelledby="social-proof-heading"
    >
      <h2 id="social-proof-heading" className="social-proof__headline">
        {data.headline}
      </h2>
      {data.overallRating && (
        <p className="social-proof__rating">
          {data.overallRating} <span>{labels.outOfFive}</span>
        </p>
      )}
      {data.totalReviews && (
        <p className="social-proof__reviews">{data.totalReviews} {labels.reviews}</p>
      )}
      {data.platforms?.map((platform, index) => (
        <div key={index} className="social-proof__platform">
          <span>{platform.name}</span>
          <span>{platform.rating} {labels.outOfFive}</span>
          <span>{platform.reviews} {labels.reviews}</span>
        </div>
      ))}
      {data.badges?.map((badge, index) => (
        <p key={index} className="social-proof__badge">{badge}</p>
      ))}
      {data.featuredQuote && (
        <blockquote className="social-proof__quote">
          <p>{data.featuredQuote.text}</p>
          <footer className="social-proof__quote-author">{data.featuredQuote.author}</footer>
        </blockquote>
      )}
      {data.stats?.map((stat, index) => (
        <div key={index} className="social-proof__stat">
          <p className="social-proof__stat-value">{stat.value}</p>
          <p className="social-proof__stat-label">{stat.label}</p>
        </div>
      ))}
      {data.imageUrl ? (
        <div className="social-proof__media">
          {/* `<img>` 不是契约钩子，跟 `.hero__img` / `.content-split__media img` 是同一条边界：
              盒子归形态层和主题，图片本身归 `globals.css`，一个属性只有一个主人。 */}
          <img src={data.imageUrl} alt="" />
        </div>
      ) : null}
    </section>
  );
}
