// theme-text-targets.js — 页面上哪些字要被量对比度。**这些单子只有这一处定义**（#1038 r3）。
//
// 🔴 #1531 —— 这里住着【两套】单子，回答的是两个不同产物上的问题，所以名字分开、取值也分开：
//
//   | 前缀           | 它问什么                                   | 用哪套类名               | 消费者 |
//   |----------------|--------------------------------------------|--------------------------|--------|
//   | `RENDERED_*`   | 页面上这段字**画出来之后**，对比度够不够    | 新库块 markup 发的类名    | `theme-css-invariants.mjs`（真浏览器，检查 ①） |
//   | `SHEET_HOOK_*` | 这张主题表的**字节里**给这个选择器写了什么色 | 主题表里写着的旧钩子      | `theme-presets.test.js` 第 ⑨a/⑨/⑩ 节、`theme-text-bands.mjs` |
//
// T3（#1425）之后两边分叉了：块的 markup 换成了新库（`.hro-title` / `.cta-body` / `.phn-sub` …），
// 而五张主题表（`public/themes/` 2 张 + `scripts/handwritten-sheets/` 3 张）还没按新框架重生成，
// 字节里**一行新钩子都没有**。用一张单子同时服务两边，必然有一边落空：换成新名字 ⟹ 每张表解出的配对
// 从 8 掉到 0、`PINNED_RESOLVED_PER_SHEET` 只能跟着降，空过与全过在 rc 上同形（#1083 要防的那件事）；
// 留旧名字 ⟹ 浏览器那侧在页面上一个都找不到（#1531 开票时的读数：7 个钩子 `on no page measured`）。
//
// 为什么仍然住一个文件：消费者跑在两层上，两边各抄一份的结果是「扩了一边、另一边悄悄还是老的」——
// 而失败方向是**变绿**：少量几个选择器，报告照样说 ✅。#1425 就在 `.mjs` 里另起过一份
// `FIRST_SCREEN_TEXT`，而这里那份原封不动还是旧名字；#1531 把它搬回来了。
//
// 🔴 这个文件是 CommonJS，因为纯值层那侧是 CJS；`.mjs` 那侧用 `createRequire` 读它（它本来就是
//    这么读 `theme-css-lint.js` 的）。

// ══ 浏览器那一侧：量【渲染结果】，名字跟着块的 markup 走 ══════════════════════════════════════════

// The text elements this checks, and why these: the headline and the sub are the hero's own words.
// 🔴 #1425（T3）换成新 hero 的那一对（`blocks/hero/Section.tsx`），#1531 从 `.mjs` 搬回这里。
const RENDERED_FIRST_SCREEN_TEXT = ['.hro-title', '.hro-sub'];

// 🔴 #1046 条 9 — IT IS NOT ONLY THE HERO ANY MORE. The pair above is the pair that must be on
// the page every other first-page check is taken on, and it stayed hero-only while phase 2 moved
// block after block into the theme's hands. cta-banner (#1018) and page-header (#1019) carry a
// headline and a subtitle each, a sheet may colour all four, and #966 — the failure this check
// exists for — was white text on a white background. Nothing was looking at them.
//
// Two lists rather than one, because the two questions are different:
//   · RENDERED_FIRST_SCREEN_TEXT — must be here. Missing is a finding (see the comment in `measureText`).
//   · RENDERED_MOVED_TEXT — measured wherever they turn up. `.phn-title` is on no home page
//     by construction (it is the sub-pages' heading), so requiring it on the first page would be a
//     permanent red about the sample site rather than about any sheet. They are measured on the
//     other pages too, in the ⑤b loop below, and what was never found anywhere is PRINTED — an
//     unmeasured hook that says nothing is how this check would grow a hole again.
// 📌 「below」「this check」指的是 `theme-css-invariants.mjs` —— 这段注释是跟着单子从那里搬过来的
//    （#1038 r3），它描述的仍是那个消费者的行为。
// 🔴 #1531 —— 新库的 cta / page-header（`blocks/cta/Section.tsx` 的 `.cta-title` / `.cta-body`，
//    `blocks/page-header/Section.tsx` 的 `.phn-title` / `.phn-sub`）。旧名字是 `.cta-banner__headline` /
//    `__desc` / `.page-header__title` / `__sub`，它们仍在下面主题表那张单子上。
const RENDERED_MOVED_TEXT = [
  '.cta-title', '.cta-body',
  '.phn-title', '.phn-sub',
];

// ── #1038 — AND THE THINGS YOU CLICK ─────────────────────────────────────────────────────────────
//
// 🔴 WHY THIS LIST HAD TO EXIST BEFORE #1038 COULD SHIP. Until now the two selectors above were the
// whole of this check, and `scripts/tweaks.js` says so in its own header: the buttons are not in it.
// #1006 could live with that because it only ever moved a colour ±15° AND put the relative luminance
// back, so the contrast of every shade was pinned by construction (15300 combinations, biggest
// change 0.052). #1038 writes ABSOLUTE values — a palette whose primary-500 is pale makes white
// button text unreadable, and not one word of the old check would have said so.
//
// The selectors are read off `globals.css`'s `@layer components`, and they are the ones whose OWN
// face a palette paints:
//   `.btn-primary`   its COMPUTED ink on its COMPUTED ground   (`.services-list`, `.pricing-table`)
//                    🔴 #1084 — no longer `white text`. The ink is white when white clears 4.5:1 on that
//                    background and pure black when it does not (`scripts/lib/button-ink.js`), so a check
//                    that assumed white would measure a pairing the page does not render — wrong in both
//                    directions (a correct site read as unreadable, and the reverse). What reads this list
//                    is a BROWSER (`scripts/theme-text-bands.mjs`), so it takes whatever the button renders;
//                    the arithmetic side that used to assume white is `scripts/theme-presets.test.js`, and
//                    #1084 changed it to resolve the ink from the palette under test.
//                    🔴 #1091 — AND NO LONGER `--color-primary-500` EITHER. Chris's option D moved the
//                    BUTTON rather than the palette: the ground is `--btn-primary-bg`, the lightest step
//                    from 500 downwards whose chosen ink clears the floor (`button-ink.js` §baseShadeFor,
//                    written into `public/theme.css` by sync-config, read by `globals.css`). Which step a
//                    sheet lands on is that sheet's own answer — most of the pool moves, some stay — so
//                    naming a step HERE is the same mistake #1084 fixed one field over: both ends are
//                    computed per palette now, and a reader who wants the split has to run for it.
//   `.btn-accent`    `gray-900` text on `--color-accent-400` (`.hero__cta`, `.cta-banner__action`)
// plus the two link hooks, which is where a palette's colour lands on a text link.
//
// 🔴 THE BUTTONS ARE NAMED BY THEIR OWN CLASS, NOT BY THE BOX AROUND THEM. The first version of this
// list wrote `.hero__cta .btn-primary` and `.cta-banner__action .btn-primary`, and both of those are
// UNREACHABLE: HeroSection and CtaBannerSection render `btn-accent` (and the hero a `btn-secondary`),
// never `btn-primary` — so two of the six could not have been measured on any page, on any theme,
// ever, and the coverage line said "2/6" as if a page happened not to have them. Scoping also adds a
// second way to go blind for nothing: renaming `.hero__cta` would switch off a button check that has
// no quarrel with the rename. What a palette paints is the button's own face, so ask for that.
//
// 🔴 `.btn-secondary` IS DELIBERATELY NOT HERE, and the reason is a reading, not taste. That button
// is TRANSPARENT: what sits behind its words is the hero's own background, which `.hero__title` and
// `.hero__sub` already measure, and which no palette owns. Measuring it anyway gave an unstable
// answer — same bytes, same page, three runs: 9.68:1, then 2.47:1, then 4.39:1. A transparent box
// over a gradient has no one background, so "the worst dominant colour" lands on whichever band
// happens to clear the 5% share that run. It also came out under 4.5:1 on the CURRENT shipped state
// with no presets at all, so keeping it would have made this a gate about the theme sheets rather
// than about the palette — and a check that goes red on a correct site gets switched off.
//
// 🔴 THESE ARE MEASURED IF PRESENT, WHICH IS NOT THE SAME LICENCE THE LIST ABOVE HAS — a hero is on
// every page this runs against, a `services-nav` is not. The vacuous-green that leniency invites is
// closed by the rule under it: if NONE of them is on the page, that is a finding, not a pass.
// 📌 Coverage is reported, because it is not full — and 🔴 **#1091 changed WHAT it is not full of.**
// Until then these four were measured on the HOME page alone, and the note here said so; the reason
// was that `.btn-primary` lands on a home page only through a `services-list` or `pricing-table`
// block, which this sample site's home page has none of, so the run printed `🔴 on no page measured`
// for it every time. #1091 opened the ⑤b loop's line, so they are now measured on EVERY page that
// loop opens (`theme-css-invariants.mjs`, the `for (const sel of CONTROL_TARGETS)` call inside it) —
// what is still not full is the page cap and the hooks this sample site puts on no page at all, and
// the run counts both onto its own "pages measured for check ①" line rather than asserting them here.
// What no browser reading covers is covered arithmetically instead: `scripts/theme-presets.test.js`
// resolves each button's pair out of `globals.css` for the palette under test — since #1084 the ink,
// since #1091 the primary button's ground as well — and proves that judge discriminates by running it
// over the WHOLE registry — 110 themes as of 2026-08-21（origin/main 7be6d585）, of which 11 fail it. (#1134: this read
// "the 30-theme registry"; 30 has been the size of the RETIRED batch alone since #1016 added the
// 80-theme pool. The 11 is for the four button pairs including `.btn-accent:hover` = gray-900 on
// accent-500 — naming the pairs matters: swap that one for white-on-accent-500 and the same ruler
// over the same registry reads 109. Re-measure rather than quoting this number.)
// 📌 #1038 r3 起那侧还多做一件事：把**主题表自己声明的**配对（含渐变混出来的颜色）跟色相滑块的
//    31 个取值叠起来一起判 —— 那一节量得到的正是这张单子上的选择器，所以两层量的是同一批字。
// 🔴 #1531 —— 上面这段写的是旧库那四个，今天浏览器那侧只剩 `.btn-primary`。另外三个各判了一次，
//    判据是「删一个检查项要满足它守的东西已经没了」：
//      `.btn-accent`              新库 17 个块的 markup 里 0 处（按钮全是 Bootstrap 的 `btn btn-primary` /
//                                 `btn-outline-primary` / `btn-link`）。`globals.css` 还定义着它，但没有
//                                 一个块发它 ⟹ 页面上没有这张脸可量。删。
//      `.announcement-bar__link`  announcement-bar 块随旧库删了，公告条那个区 #1425 也退役了。删。
//      `.services-nav__link`      services-nav 块随旧库删了。删。
//    这三个仍在下面主题表那张单子上 —— 那一侧问的是表的字节，表里还写着它们。
//    复算「新库没有一个块发它」：
//      git grep -cE 'btn-accent|announcement-bar__|services-nav__' -- templates/nextjs/blocks   （0 = 没有）
const RENDERED_CONTROLS = [
  '.btn-primary',
];

// ── #1100 — AND WHAT THEY LOOK LIKE WITH THE POINTER ON THEM ─────────────────────────────────────
//
// 📌 #1531 —— 这张单子跟上面那张同属浏览器那一侧（它只被 hover 着量，没有主题表那一侧的消费者），
//    本票没动它的取值。`.btn-secondary` / `.btn-accent` 今天在新库 markup 里同样是 0 处，所以真正
//    被 hover 着量到的只有 `.btn-primary`（每页那行 `buttons hovered on …: 1/3` 读得到）；它该不该
//    跟着收窄是另一件事，不在 #1531 射程里。
// 🔴 WHY A SEPARATE LIST AND NOT FOUR MORE STRINGS IN THE ONE ABOVE. A `:hover` selector cannot be
// measured the way the list above is measured: `locator('.btn-primary:hover')` matches **nothing**
// while nobody is hovering (count = 0), and the loop that consumes `RENDERED_CONTROLS` passes
// `required = false` ⟹ it would return early, add no problem, and the run would print the same
// coverage line as before. Measured, before this ticket, on a built page: `.btn:hover` count = 0
// with no pointer, count = 1 after a real `.hover()`. **Four extra strings would have been a green
// that measures nothing** — so the hover state is driven, then photographed, and this list is the
// input to that (different) loop. The selectors here are the RESTING ones; the consumer hovers them
// and labels the reading `<sel>:hover`.
//
// 🔴 WHY `.btn-secondary` IS HERE WHILE IT IS DELIBERATELY ABSENT FROM `RENDERED_CONTROLS`. The reason
// it is excluded above is a reading about its RESTING state and only about that: it is transparent,
// so "the colour behind its words" is the hero's own background and three runs of the same bytes gave
// 9.68 / 2.47 / 4.39. On hover its background is a solid `--btn-primary-bg` — one colour, stable,
// and owned by the palette. The exclusion's own justification therefore does not reach this state.
// (The same split appears one file over: `globals.css`'s `.hero__cta .btn-secondary { color:
// currentColor }` is right for the resting state and wrong for hover, which is why #1100 added a
// `:hover` rule beside it.)
//
// 🔴 The two link hooks are NOT here: `globals.css` gives neither `.announcement-bar__link` nor
// `.services-nav__link` a `:hover` rule (grep: zero), and a theme sheet may not write one (§2 of the
// CSS contract). Hovering them would photograph the resting colours a second time and report it as a
// hover reading — a pairing no visitor ever sees, dressed up as one they do.
const HOVER_TARGETS = [
  '.btn-primary',
  '.btn-secondary',
  '.btn-accent',
];

// ══ 主题表那一侧：读【表的字节】，名字跟着主题表走 ══════════════════════════════════════════════

/**
 * 「一张主题表要对哪些字负责」—— 纯值层（`theme-presets.test.js` 第 ⑨a/⑨/⑩ 节 + `theme-contrast.js`
 * 的 `textPairs`）拿它去**主题表的字节里**找「这张表给这个选择器写了什么颜色」，`theme-text-bands.mjs`
 * 拿它记渐变几何（那份读数也是按表存的）。
 *
 * 🔴 #1531 —— **主题表按新框架重生成之前，它只能是旧名字。** 五张表里一行新钩子都没有（#1531 PM 复算：
 * 5/5 全是 0），换成新名字这张单子就一对都解不出来。它不是浏览器那侧的「旧版」，是另一个问题的答案。
 * 🔴 **什么时候该换**：任意一张主题表里出现了上面 `RENDERED_*` 的文字钩子。这条判据不是只写在这里 ——
 * `theme-presets.test.js` §⑨a 每次都跑它（`renderedHooksInSheet`），出现了就报红，叫人来换这张单子。
 * 手算一次：
 *   for f in templates/nextjs/public/themes/*.css templates/nextjs/scripts/handwritten-sheets/*.css; do
 *     echo "$f $(grep -cE '\.(hro-title|hro-sub|cta-title|cta-body|phn-title|phn-sub)([^a-zA-Z0-9_-]|$)' "$f")"; done
 *   （每行都是 0 = 还不该换）
 *
 * 🔴 `.btn-primary` / `.btn-accent` 的颜色住在 `globals.css`，**不在主题表里** —— 所以从主题表推出来的
 * 配对里没有它们，纯值层那侧另有一节专门 judge 它们（`judgeButtons`）。这里把它们一起列出来，是为了
 * 让「这一侧谁被量了」只有一个答案（`PINNED_MEASURED_TARGETS` 逐个钉着这 10 个）。
 */
const SHEET_HOOK_TARGETS = [
  '.hero__title', '.hero__sub',
  '.cta-banner__headline', '.cta-banner__desc',
  '.page-header__title', '.page-header__sub',
  '.btn-primary', '.btn-accent',
  '.announcement-bar__link', '.services-nav__link',
];

const RENDERED_TEXT_HOOK_RE = new RegExp(
  `\\.(${[...RENDERED_FIRST_SCREEN_TEXT, ...RENDERED_MOVED_TEXT].map((s) => s.slice(1)).join('|')})(?![\\w-])`,
);
/**
 * 「该换了」的那条判据本身：一张主题表的字节里，浏览器那侧的文字钩子出现了几行。
 * 选择器后面跟的必须不是名字字符，`.cta-title-x` 这类不算。
 * @param {string} css
 * @returns {number}
 */
const renderedHooksInSheet = (css) => css.split('\n').filter((l) => RENDERED_TEXT_HOOK_RE.test(l)).length;

// 🔴 #1100 —— `HOVER_TARGETS` **故意不进 `SHEET_HOOK_TARGETS`**，而这是一条关于另一个消费者的判据：
// 那个数组是给**纯值层**用的 ——「一张主题表给这些选择器写了什么颜色」。而 hover 的颜色**不在主题表里**，
// 它在 `globals.css`（契约 §2 也不许主题表写 `:hover`）⟹ 把它塞进这张单子，`textPairs` 会对每张表多问
// 一个它按构造解不出来的选择器，而那一节的分母自检（`PINNED_RESOLVED_PER_SHEET` = 每张表 8 对）会当场红在
// 一件跟主题表无关的事上。hover 那三对的算术侧判在 `theme-presets.test.js` 的 `judgeButtons`
// （它从 `globals.css` 现解按钮配对，`.btn-x:hover` 那条规则就在那里被读到）。
module.exports = {
  // 浏览器那一侧
  RENDERED_FIRST_SCREEN_TEXT, RENDERED_MOVED_TEXT, RENDERED_CONTROLS, HOVER_TARGETS,
  // 主题表那一侧
  SHEET_HOOK_TARGETS, renderedHooksInSheet,
};
