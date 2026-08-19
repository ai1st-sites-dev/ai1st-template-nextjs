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
//   `.btn-primary`   its COMPUTED ink on `--color-primary-500`   (`.services-list`, `.pricing-table`)
//                    🔴 #1084 — no longer `white text`. The ink is white when white clears 4.5:1 on that
//                    background and pure black when it does not (`scripts/lib/button-ink.js`), so a check
//                    that assumed white would measure a pairing the page does not render — wrong in both
//                    directions (a correct site read as unreadable, and the reverse). What reads this list
//                    is a BROWSER (`scripts/theme-text-bands.mjs`), so it takes whatever the button renders;
//                    the arithmetic side that used to assume white is `scripts/theme-presets.test.js`, and
//                    #1084 changed it to resolve the ink from the palette under test.
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
// 📌 Coverage is reported, because it is not full: it is measured on the HOME page (that is what
// check ① runs against), and which of these a home page renders is the site's own business —
// `.btn-primary` lands there only through a `services-list` or `pricing-table` block. What no
// browser reading covers is covered arithmetically instead: `scripts/theme-presets.test.js` checks
// white-on-primary-500/600 and gray-900-on-accent-400/500 for every curated palette, and proves that
// judge discriminates by running it over the 30-theme registry (11 of them fail it).
// 📌 #1038 r3 起那侧还多做一件事：把**主题表自己声明的**配对（含渐变混出来的颜色）跟色相滑块的
//    31 个取值叠起来一起判 —— 那一节量得到的正是这张单子上的选择器，所以两层量的是同一批字。
const CONTROL_TARGETS = [
  '.btn-primary',
  '.btn-accent',
  '.announcement-bar__link',
  '.services-nav__link',
];

/**
 * 三张单子合起来 = 「一组配色要对哪些字负责」。
 *
 * 🔴 `.btn-primary` / `.btn-accent` 的颜色住在 `globals.css`，**不在主题表里** —— 所以从主题表推
 * 出来的配对里没有它们，纯值层那侧另有一节专门 judge 它们（白字压 primary-500 / gray-900 压
 * accent-400）。这里把它们一起列出来，是为了让「谁被量了」只有一个答案。
 */
const MEASURED_TARGETS = [...TEXT_TARGETS, ...MOVED_TEXT_TARGETS, ...CONTROL_TARGETS];

module.exports = { TEXT_TARGETS, MOVED_TEXT_TARGETS, CONTROL_TARGETS, MEASURED_TARGETS };
