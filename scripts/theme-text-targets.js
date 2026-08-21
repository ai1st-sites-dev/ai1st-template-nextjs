// theme-text-targets.js — 页面上哪些字要被量对比度。**这份单子只有这一处定义**（#1038 r3）。
//
// 为什么单独一个文件：现在有两个消费者，而它们跑在两层上 ——
//   · `scripts/theme-css-invariants.mjs`（真浏览器）拿它决定去量哪些元素；
//   · `scripts/theme-presets.test.js`（纯值层，不起浏览器）拿它决定一组配色要对哪些字负责。
// 两边各抄一份的结果是「扩了一边、另一边悄悄还是老的」——而失败方向是**变绿**：少量几个选择器，
// 报告照样说 ✅。同一张表两份拷贝正是 #961 / #1002 一路在堵的东西。
//
// 🔴 这个文件是 CommonJS，因为纯值层那侧是 CJS；`.mjs` 那侧用 `createRequire` 读它（它本来就是
//    这么读 `theme-css-lint.js` 的）。下面三段注释是从 `theme-css-invariants.mjs` 原样搬过来的。

// The text elements this checks, and why these: the headline and the sub are the hero's own words,
// and `body` is the page's baseline — a sheet is allowed to touch all three (`.hero__title`,
// `.hero__sub`, `body` are contract hooks), so all three can be broken by one.
const TEXT_TARGETS = ['.hero__title', '.hero__sub'];

// 🔴 #1046 条 9 — IT IS NOT ONLY THE HERO ANY MORE. `TEXT_TARGETS` above is the pair that must be on
// the page every other first-page check is taken on, and it stayed hero-only while phase 2 moved
// block after block into the theme's hands. cta-banner (#1018) and page-header (#1019) carry a
// headline and a subtitle each, a sheet may colour all four, and #966 — the failure this check
// exists for — was white text on a white background. Nothing was looking at them.
//
// Two lists rather than one, because the two questions are different:
//   · TEXT_TARGETS — must be here. Missing is a finding (see the comment in `measureText`).
//   · MOVED_TEXT_TARGETS — measured wherever they turn up. `.page-header__title` is on no home page
//     by construction (it is the sub-pages' heading), so requiring it on the first page would be a
//     permanent red about the sample site rather than about any sheet. They are measured on the
//     other pages too, in the ⑤b loop below, and what was never found anywhere is PRINTED — an
//     unmeasured hook that says nothing is how this check would grow a hole again.
// 📌 「below」「this check」指的是 `theme-css-invariants.mjs` —— 这段注释是跟着单子从那里搬过来的
//    （#1038 r3），它描述的仍是那个消费者的行为。
const MOVED_TEXT_TARGETS = [
  '.cta-banner__headline', '.cta-banner__desc',
  '.page-header__title', '.page-header__sub',
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
const CONTROL_TARGETS = [
  '.btn-primary',
  '.btn-accent',
  '.announcement-bar__link',
  '.services-nav__link',
];

// ── #1100 — AND WHAT THEY LOOK LIKE WITH THE POINTER ON THEM ─────────────────────────────────────
//
// 🔴 WHY A SEPARATE LIST AND NOT FOUR MORE STRINGS IN THE ONE ABOVE. A `:hover` selector cannot be
// measured the way the list above is measured: `locator('.btn-primary:hover')` matches **nothing**
// while nobody is hovering (count = 0), and the loop that consumes `CONTROL_TARGETS` passes
// `required = false` ⟹ it would return early, add no problem, and the run would print the same
// coverage line as before. Measured, before this ticket, on a built page: `.btn:hover` count = 0
// with no pointer, count = 1 after a real `.hover()`. **Four extra strings would have been a green
// that measures nothing** — so the hover state is driven, then photographed, and this list is the
// input to that (different) loop. The selectors here are the RESTING ones; the consumer hovers them
// and labels the reading `<sel>:hover`.
//
// 🔴 WHY `.btn-secondary` IS HERE WHILE IT IS DELIBERATELY ABSENT FROM `CONTROL_TARGETS`. The reason
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

/**
 * 三张单子合起来 = 「一组配色要对哪些字负责」。
 *
 * 🔴 `.btn-primary` / `.btn-accent` 的颜色住在 `globals.css`，**不在主题表里** —— 所以从主题表推
 * 出来的配对里没有它们，纯值层那侧另有一节专门 judge 它们（白字压 primary-500 / gray-900 压
 * accent-400）。这里把它们一起列出来，是为了让「谁被量了」只有一个答案。
 */
const MEASURED_TARGETS = [...TEXT_TARGETS, ...MOVED_TEXT_TARGETS, ...CONTROL_TARGETS];

// 🔴 #1100 —— `HOVER_TARGETS` **故意不进 `MEASURED_TARGETS`**，而这是一条关于另一个消费者的判据：
// 那个数组是给**纯值层**（`theme-presets.test.js` 第 ⑨/⑩ 节 + `theme-contrast.js` 的 `textPairs`）用的
// ——「一张主题表给这些选择器写了什么颜色」。而 hover 的颜色**不在主题表里**，它在 `globals.css`
// （契约 §2 也不许主题表写 `:hover`）⟹ 把它塞进这张单子，`textPairs` 会对每张表多问一个它按构造
// 解不出来的选择器，而那一节的分母自检（`PINNED_RESOLVED_PER_SHEET` = 每张表 8 对）会当场红在
// 一件跟主题表无关的事上。hover 那三对的算术侧判在 `theme-presets.test.js` 的 `judgeButtons`
// （它从 `globals.css` 现解按钮配对，`.btn-x:hover` 那条规则就在那里被读到）。
module.exports = {
  TEXT_TARGETS, MOVED_TEXT_TARGETS, CONTROL_TARGETS, HOVER_TARGETS, MEASURED_TARGETS,
};
