// theme-css-invariants.mjs — the things that must still be true after a theme is applied
// (#991; the fifth and the tightening of the first two are #992; #996 added the lead-on-the-first-screen
// and touch-target rules spec §5.5 already stated, and a second reading of the fifth.)
//
//   node scripts/theme-css-invariants.mjs http://127.0.0.1:8991 [page …]
//
// The first argument is the site's home page: every check below is measured on it. The rest are the
// site's OTHER pages, and check ⑤ — does the theme's own sheet have a rule for each hook in the markup —
// is measured on those too (#1023). With none given they are read off the site's own /sitemap.xml, so
// the ordinary call stays a one-argument one.
//
// Exit 0 = they all hold. Exit 1 = at least one does not. Exit 2 = could not take the reading.
//
// The contract's static half (scripts/theme-css-lint.js) can only say the sheet is well-formed. It
// cannot say the page came out readable, and that distinction is the whole reason this file exists:
// #966 shipped three themes whose first screen was white text on a white background. Every rule in
// them was legal. It took a person looking at a picture.
//
// 🔴 THE BACKGROUND IS READ OFF THE RENDERED PIXELS, NOT OFF `background-color`.
// Walking up the tree for the first non-transparent `background-color` is what the obvious
// implementation does, and it answers `rgba(0,0,0,0)` for exactly the case that matters here: two of
// the three phase-1 sheets paint the hero with a `linear-gradient`, which lives in `background-image`
// and leaves `background-color` transparent. That version would have reported "cannot measure" on
// the sheets it was written for. So: photograph the element's own box.
//
// 🔴 AND THE TEXT COLOUR IS READ OFF THE PIXELS TOO — BY TAKING THE PICTURE TWICE (#992 r4).
// Every earlier version worked out what colour the words WOULD come out, from the properties it
// knew about: first the declared `color`, then declared × the ancestor chain's `opacity` × the
// alpha. Each version was defeated by the next whitelisted property that also changes what reaches
// the screen — `filter: opacity(.9)` renders text a person reads without trouble, and the version
// that multiplied opacities reported "the words are not on the screen" (QA3 measured 8987 dark
// pixels in that title box). The list of properties that can do this is not something to enumerate:
// `filter` alone has ten functions, and `color-mix`, blend modes and backdrop filters are all one
// contract revision away. So the checker stops predicting. It photographs the box, makes just this
// element's words transparent, photographs it again, and calls the pixels that CHANGED the text.
// Whatever painted them, they are the text; whatever is in the second picture, that is what the
// text sits on.
//
// 🔴 IT CHECKS THE WORST OF THE DOMINANT COLOURS, NOT JUST THE COMMONEST. A gradient behind a
// heading is legal and normal; the question is never "is the average readable" but "is the WORST end
// readable". Taking only the modal colour would pass a gradient that runs into the text colour at
// one end — which is #966's failure with an extra step.
import { createRequire } from 'node:module';
import { PLAYWRIGHT_MODULE } from './theme-gallery/paths.mjs';

// theme-css-lint.js is CommonJS. `createRequire` rather than a named import from it: named imports
// out of CJS work only when Node's lexer can see the shape of `module.exports`, and that is a
// property of how that file happens to be written today, not something this file should depend on.
const { HOOK_CLASSES } = createRequire(import.meta.url)('./theme-css-lint.js');
// 🔴 #1038 r3 — 被量的选择器搬去 `scripts/theme-text-targets.js`，因为现在有第二个消费者：
// `scripts/theme-presets.test.js` 在纯值层上判「一组配色要对哪些字负责」。两边各留一份的失败方向
// 是变绿（少量几个选择器，报告照样 ✅），所以这张表只留一处定义。三张单子各自的理由跟着搬过去了。
const { TEXT_TARGETS, MOVED_TEXT_TARGETS, CONTROL_TARGETS } =
  createRequire(import.meta.url)('./theme-text-targets.js');

const { chromium } = await import(PLAYWRIGHT_MODULE);
// jimp 0.22 is CommonJS with a default export (`Jimp.read`). Named-importing `{ Jimp }` gets
// undefined here and the failure surfaces a hundred lines later as "cannot read read of undefined".
const Jimp = (await import('jimp')).default;

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('usage: node scripts/theme-css-invariants.mjs <baseUrl> [page …]   e.g. http://127.0.0.1:8991');
  console.error('       页面不给就从站点自己的 /sitemap.xml 读(#1023)');
  process.exit(2);
}

// The path half of a URL, for naming a page in a reading. `/` when there is none, so the home page has a
// name rather than an empty string.
const pathOf = (u) => {
  try { return new URL(u, baseUrl).pathname || '/'; } catch { return String(u); }
};

const MIN_CONTRAST = 4.5;
const MIN_BODY_PX = 14;

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// The alpha in `rgba(r,g,b,a)` / `rgb(r g b / a)`, 1 when there isn't one. `color: transparent`
// computes to `rgba(0, 0, 0, 0)`, whose first three numbers are a perfectly readable black.
function alphaOf(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1;
}
// 30 over three channels ≈ one antialiasing step, not a second colour. Used both for "is this pixel
// that colour" and for "did this pixel change when the words were taken away".
const SAME_COLOUR = 30;
// How many pixels in this box are one of `targets`.
function pixelsNear(img, targets) {
  let n = 0;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scanTextPixel(x, y, idx) {
    for (const t of targets) {
      const d = Math.abs(this.bitmap.data[idx] - t[0])
        + Math.abs(this.bitmap.data[idx + 1] - t[1])
        + Math.abs(this.bitmap.data[idx + 2] - t[2]);
      if (d <= SAME_COLOUR) { n++; return; }
    }
  });
  return n;
}
// The pixels that changed between the same box photographed with its words and without them. That
// set IS the text, whatever colour the browser decided to paint it and by whatever route.
function wordPixels(withWords, withoutWords) {
  const a = withWords.bitmap.data;
  const b = withoutWords.bitmap.data;
  const count = withWords.bitmap.width * withWords.bitmap.height;
  const mask = new Uint8Array(count);
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    const p = i * 4;
    const d = Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]);
    if (d > SAME_COLOUR) { mask[i] = 1; n += 1; }
  }
  return { mask, n };
}
// Group an image's pixels into colours, optionally only where `mask` says. Quantise to 8 levels per
// channel: antialiasing turns one background into hundreds of near-identical colours, and counting
// them separately would leave the real background looking rare. 32 is coarse enough to merge those
// and fine enough not to merge a colour with the text. 🔴 Each group reports its AVERAGE, not the
// first pixel that landed in it — a group spans 32 levels, and picking one member to stand for it
// makes the reading depend on scan order (QA1 measured a 1.81:1 that way, on a page a person can
// read: the group's first pixel was an antialiased edge of the very text it was being compared to).
function coloursOf(img, mask) {
  const groups = new Map();
  const { width, height, data } = img.bitmap;
  for (let i = 0; i < width * height; i += 1) {
    if (mask && !mask[i]) continue;
    const p = i * 4;
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const e = groups.get(key);
    if (e) { e.n += 1; e.sum[0] += r; e.sum[1] += g; e.sum[2] += b; } else {
      groups.set(key, { n: 1, sum: [r, g, b] });
    }
  }
  return [...groups.values()]
    .map((e) => ({ n: e.n, rgb: e.sum.map((s) => Math.round(s / e.n)) }))
    .sort((x, y) => y.n - x.n);
}
function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return parts.slice(0, 3);
}

/* global document, getComputedStyle, window, requestAnimationFrame */
// 🔴 The four blocks below hand functions to `page.evaluate`, so their bodies run in the BROWSER,
// not in node. Same declaration `scripts/theme-gallery/shoot.mjs:41` carries, for the same reason:
// without it eslint's no-undef reports `document` and `getComputedStyle` as typos.

const problems = [];
const readings = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const res = await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 }).catch((e) => {
  console.error(`🔴 could not load ${baseUrl}: ${e.message}`);
  return null;
});
if (!res || !res.ok()) {
  console.error(`🔴 ${baseUrl} did not answer with a page (${res ? res.status() : 'no response'})`);
  await browser.close();
  process.exit(2);
}
// 🔴 Wait for the web font before measuring anything. A fresh browser's first navigation can paint
// with the fallback face, and every box below is measured off laid-out text. Same line, same reason,
// as scripts/theme-gallery/shoot.mjs:62 — and it is not theoretical: a screenshot comparison written
// during this ticket read 68004 differing pixels on one run and 0 on the next until it waited here.
await page.evaluate(() => document.fonts.ready);

// 🔴 EVERY QUESTION BELOW IS ASKED OF THE WHOLE ANCESTOR CHAIN, NEVER OF ONE ELEMENT'S OWN
// PROPERTY (#992). `opacity` is inherited by effect, not by value: `.hero__body { opacity: 0 }` —
// one declaration, every token of it on the contract's whitelist — leaves `.hero__title` computing
// `display: block`, `visibility: visible`, `opacity: 1`, its own colour unchanged and its box the
// right size, while the browser paints nothing at all. Measured on the shipped checker: all four
// invariants "held" on a hero with 0 text pixels out of 69215. That is #966 again, from inside the
// whitelist, so what these checks read has to be the effect on the screen.
// 🔴 #1043 — NAMED, BECAUSE A NAVIGATION WIPES IT. This used to be an inline `page.evaluate` run once,
// on the first page, which was enough while every check that used it also ran only there. Check ②
// now runs on the site's other pages too (②c), and `window.__effective is not a function` is what a
// fresh document answers — measured, on the first run of this change.
const INSTALL_EFFECTIVE = () => {
  window.__effective = (n) => {
    let opacity = 1;
    let hiddenBy = null;
    let zeroedBy = null;
    const name = (e) => e.tagName.toLowerCase()
      + (e.getAttribute && e.getAttribute('class') ? '.' + e.getAttribute('class').trim().split(/\s+/).join('.') : '');
    for (let e = n; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const own = parseFloat(cs.opacity);
      if (!zeroedBy && own === 0) zeroedBy = `${name(e)} { opacity: 0 }`;
      opacity *= Number.isNaN(own) ? 1 : own;
      if (!hiddenBy && (cs.display === 'none' || cs.visibility === 'hidden')) {
        hiddenBy = `${name(e)} { ${cs.display === 'none' ? 'display: none' : 'visibility: hidden'} }`;
      }
    }
    return { opacity, hiddenBy, zeroedBy, self: name(n) };
  };
};
await page.evaluate(INSTALL_EFFECTIVE);

// Photograph `el` with its own words made transparent and nothing else about the page touched —
// whatever `opacity`, `filter` or gradient is acting on this box goes on acting on it, so the
// second picture is exactly "this box, minus the letters".
async function withoutWords(el, shoot) {
  await el.evaluate((n) => n.setAttribute('data-inv-probe', ''));
  const style = await page.addStyleTag({
    // 🔴 TRANSITIONS ARE TURNED OFF IN THE SAME RULE THAT BLANKS THE WORDS, AND THAT IS LOAD-BEARING
    // (#1049). Taking the colour away STARTS A TRANSITION on anything that has one, and the second
    // picture is then taken while the words are still most of the way to being painted — so the two
    // pictures come back the same and the reading is "these words are not on the screen" about text
    // a person can read perfectly. Measured on this repo's sample site with the `hero-media-right`
    // sheet: `.btn-accent` carries `transition-property: all; transition-duration: .15s` from
    // globals.css, and "Get Started" — dark on a green button, plainly legible in the screenshot —
    // came back as 0 painted pixels. The same cause makes `getComputedStyle(el).color` answer with
    // the OLD colour while the transition runs, which is why even an inline `!important` looks
    // inert when you go asking why. Check ① never met this because the two elements it measures
    // (`.hero__title`, `.hero__sub`) have no transition; ②e photographs whatever a block contains.
    content: '*, *::before, *::after { transition: none !important; animation: none !important }'
      + ' [data-inv-probe], [data-inv-probe] * { color: transparent !important;'
      + ' -webkit-text-fill-color: transparent !important }',
  });
  // One frame for the style recalculation to land before the camera opens.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  try {
    return await shoot();
  } finally {
    // Both undone before anything else is measured: the rule would otherwise sit in
    // `document.styleSheets`, which check ⑤ reads, and the attribute in the markup that ⑤ walks.
    await style.evaluate((n) => n.remove());
    await el.evaluate((n) => n.removeAttribute('data-inv-probe'));
  }
}

// ── ① the words are on the screen, and readable where they are ─────────────────────────────────
const movedTextMeasured = new Map();   // selector → [where …]
// One target on the page the browser is looking at now. `required` decides what "it is not here"
// means; everything after that is the same measurement either way.
// 🔴 #1038 把第三张单子接进来：CONTROL_TARGETS（按钮和链接）。它跟 MOVED_TEXT_TARGETS 一样是
//    「在哪出现就在哪量」，所以走的是同一个 `required = false`；不同的是**它自己那条兜底**（见下面
//    ① 末尾那一段）：一个都没量到是 finding，不是通过。为此这个函数返回布尔 —— 量成了 true，
//    早退的每一条 false。#1046 与 #1038 各自把这个循环抽成过函数（`measureText` / `measureContrast`），
//    合并时留 main 已经上线的这一份，本票那份只贡献返回值和第三张单子。
const measureText = async (sel, where, required) => {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) {
    // 🔴 A missing target is NOT a pass. This checker's whole job is to fail loudly, and "the
    // element I was going to measure is not there" is the shape a vacuous green takes.
    if (required) problems.push(`contrast: "${sel}" is not on ${where} — nothing was measured for it`);
    return false;
  }
  if (!required) {
    if (!movedTextMeasured.has(sel)) movedTextMeasured.set(sel, []);
    movedTextMeasured.get(sel).push(where);
  }
  const colorRaw = await el.evaluate((n) => getComputedStyle(n).color);
  const color = parseRgb(colorRaw);
  const box = await el.boundingBox();
  // 🔴 #996 — TWO DIFFERENT FAILURES USED TO SHARE ONE SENTENCE ("no measurable colour or box"), and
  // the reader could not tell which. `color: color-mix(in srgb, white 50%, black)` is a colour this
  // parser cannot read while the box is perfectly fine, and the message sent people looking at layout.
  // Refusing to measure is still the right direction in both cases — it is the wording that was wrong.
  if (!color) {
    problems.push(`contrast: "${sel}" on ${where} — this checker cannot read its computed colour, so no ratio was `
      + `measured (the value is ${colorRaw}). Its box is fine`
      + `${box ? ` (${Math.round(box.width)}×${Math.round(box.height)}px)` : ''}.`);
    return false;
  }
  if (!box || box.width < 2 || box.height < 2) {
    problems.push(`contrast: "${sel}" on ${where} has no measurable box`
      + `${box ? ` — it is ${Math.round(box.width)}×${Math.round(box.height)}px, under 2px on a side`
        : ' — the element has no layout box at all'}`);
    return false;
  }
  // How much of that colour actually reaches the screen: the ancestor chain's opacities multiplied
  // together, times the alpha in the text's own `color`. Both are ways to write "this text is not
  // really there" without touching `display`, and a ratio computed from a colour nobody can see is
  // a reading about a page that does not exist.
  const eff = await el.evaluate((n) => window.__effective(n));
  const painted = eff.opacity * alphaOf(colorRaw);
  const img = await Jimp.read(await el.screenshot({ type: 'png' }));
  const total = img.bitmap.width * img.bitmap.height;
  // The declared colour's pixels. Only used for the `painted <= 0` reading below, where it is the
  // plain statement "not one pixel of these words is anywhere in this box".
  const declaredPx = pixelsNear(img, [color]);
  if (painted <= 0) {
    // Nothing of this text reaches the screen. Named as the declaration that did it, because
    // "contrast is 1:1" sends the reader looking at colours when the cause is an opacity three
    // elements up. `eff.zeroedBy` is that element, spelled the way the sheet spells it.
    problems.push(`visibility: "${sel}" on ${where} is not painted at all — ${eff.zeroedBy || `effective opacity ${painted}`}`
      + ` (text pixels ${declaredPx}/${total}, cumulative opacity ${eff.opacity}, colour ${colorRaw})`);
    return false;
  }
  // The same box again with only this element's words made transparent. `-webkit-text-fill-color`
  // is set alongside `color` because it wins over `color` where both apply, and the descendant
  // selector is there because a child with its own `color` does not inherit ours.
  const bare = await withoutWords(el, () => el.screenshot({ type: 'png' })).then((b) => Jimp.read(b));
  if (bare.bitmap.width !== img.bitmap.width || bare.bitmap.height !== img.bitmap.height) {
    // Fail loud: the two pictures have to be of the same box or the comparison below is nonsense,
    // and "I could not compare them" is not a pass.
    problems.push(`visibility: "${sel}" on ${where} changed size between the two pictures `
      + `(${img.bitmap.width}x${img.bitmap.height} vs ${bare.bitmap.width}x${bare.bitmap.height}) — not measured`);
    return false;
  }
  const words = wordPixels(img, bare);
  // Backgrounds come from the picture WITHOUT the words, so the text cannot be mistaken for its own
  // background. The old version took them from the picture with the text in it and dropped any
  // candidate within 1.5:1 of the text to compensate — a guess that failed both ways: an
  // antialiasing group of the text itself sat just outside 1.5:1 and became the "background".
  const backgrounds = coloursOf(bare, null).filter((c, i) => i === 0 || c.n / total >= 0.05);
  if (words.n === 0) {
    // 🔴 THIS IS THE #966 SHAPE. Taking the words away changed nothing, so there were no words on
    // the screen: white on white, `filter: opacity(0)`, text pushed out of its own box. Said as the
    // finding rather than as an apology — a reader who thinks the instrument gave up goes looking
    // for a bug in the checker instead of at the page.
    problems.push(`visibility: "${sel}" on ${where} paints nothing that can be told apart from what is behind `
      + `it — taking its words away changes 0 of ${total} pixels in its box `
      + `(declared colour ${colorRaw}, background rgb(${backgrounds[0].rgb}))`);
    return false;
  }
  // The colour the words came out. Among the groups of changed pixels, the one furthest from the
  // background is the middle of the strokes; the rest are antialiased edges on their way to the
  // background, and judging by them would fail a page that reads perfectly. Groups under 2% of the
  // text are left out so one stray pixel cannot stand for the words.
  const strokes = coloursOf(img, words.mask).filter((c) => c.n >= Math.max(4, words.n * 0.02));
  const textRgb = (strokes.length ? strokes : coloursOf(img, words.mask))
    .reduce((a, b) => (contrast(b.rgb, backgrounds[0].rgb) > contrast(a.rgb, backgrounds[0].rgb) ? b : a))
    .rgb;
  let worst = Infinity;
  let worstRgb = backgrounds[0].rgb;
  for (const cand of backgrounds) {
    const ratio = contrast(textRgb, cand.rgb);
    if (ratio < worst) { worst = ratio; worstRgb = cand.rgb; }
  }
  readings.push(`  ${sel} on ${where}: text painted rgb(${textRgb}) (declared ${colorRaw}) on rgb(${worstRgb}) `
    + `= ${worst.toFixed(2)}:1 · text pixels ${words.n}/${total}`);
  if (worst < MIN_CONTRAST) {
    problems.push(`contrast: "${sel}" on ${where} is ${worst.toFixed(2)}:1 against rgb(${worstRgb}) — below ${MIN_CONTRAST}:1`
      + ` (measured on the colour it came out, rgb(${textRgb}); declared ${colorRaw})`);
  }
  // 🔴 量成了才回 true。上面每一条早退都回 false —— CONTROL_TARGETS 那段靠这个数「量到了几个」，
  //    而「一个都没量到」是 finding。漏掉这一行的话它恒回 undefined ⟹ 那段每次都报「一个都没量到」。
  return true;
};

// The pair that must be here, on the page every first-page check is taken on.
for (const sel of TEXT_TARGETS) await measureText(sel, pathOf(baseUrl), true);
// And the moved blocks that happen to be on this page as well (cta-banner usually is; page-header is not).
for (const sel of MOVED_TEXT_TARGETS) await measureText(sel, pathOf(baseUrl), false);

// #1038 — the buttons and the links, on whichever of them this page actually renders.
//
// 🔴 AND A FLOOR UNDER THE LENIENCY. Measuring "whichever are present" is how a check quietly stops
// checking: a rename of `.btn-accent` in globals.css would leave every one of these absent and this
// section would print nothing and pass. So the number measured is REPORTED (a reader can see it went
// from two to zero) and zero is a finding.
{
  const measured = [];
  for (const sel of CONTROL_TARGETS) {
    if (await measureText(sel, pathOf(baseUrl), false)) measured.push(sel);
  }
  if (measured.length === 0) {
    problems.push('contrast: none of the buttons or links this checks is on the page '
      + `(looked for ${CONTROL_TARGETS.join(', ')}) — so nothing was measured about what a visitor `
      + 'clicks. A home page with a hero and no `.btn-accent` is the first thing to look at.');
  } else {
    readings.push(`  buttons/links measured: ${measured.length}/${CONTROL_TARGETS.length} — ${measured.join(', ')}`);
  }
}

// ── ② essential content is not hidden ───────────────────────────────────────────────────────────
// 🔴 READ OFF THE CHAIN, NOT OFF THE ELEMENT. The old version asked each essential element for its
// own `display` / `visibility`, which is exactly the reading that stayed green while the hero's
// words were invisible: `opacity` never appeared in it, and an ancestor's `display: none` is not
// this element's `display` either (it computes to whatever the sheet says — the browser simply
// never lays the subtree out).
//
// 🔴 #1043 — AND IT LOOKS INSIDE THE BLOCK, NOT ONLY AT ITS ROOT. `$$eval('[data-role="essential"]')`
// returns the block's own element; `data-role` is written once, by `blockAttrs`, onto that element.
// So a sheet that leaves the root alone and hides a PART of it was invisible to this check. QA3
// measured it on #1028: two lines in a sheet —
//     .contact-info__phone { display: none }
//     .contact-info__email { display: none }
// — and the page came out with both `tel:` links and the `mailto:` at 0×0 while the static check, the
// contract check AND this file all printed ✅. `contact-info` is `essential`, so the one thing a
// customer needs off that page (how to reach the business) was gone with every gate green.
//
// 🔴 THE PARTS ARE JUDGED ON THREE THINGS, AND THIS IS THE WHOLE LIST: the part's own box (0 wide or
// 0 high), the effective opacity of its whole ancestor chain, and a `display: none` or a
// `visibility: hidden` anywhere on that chain — `__effective` above plus one getBoundingClientRect,
// and nothing else. That is enough to stop anyone having to enumerate the spellings WITHIN those
// three: `display: none` and `max-height: 0` and an ancestor's `opacity: 0` arrive by different
// declarations and are all read off the result. Measured on `.contact-info__phone` in the allblocks
// fixture, `ocean-blue` + `hero-media-left`, 1440×900:
//     .contact-info__phone { display: none }        box 0×0            → reported
//     .contact-info__phone { visibility: hidden }   (off the chain)    → reported
//     .contact-info { opacity: 0 }                  (off the chain)    → reported, 7 findings
//     .contact-info__phone { max-height: 0 }        box 576×0          → reported
//
// 🔴 THOSE THREE READ THE PART'S BOX AND NOTHING ELSE — NOT WHERE THE BOX IS, NOT WHETHER ANYTHING
// CUT IT AWAY, NOT WHETHER A SINGLE PIXEL OF THE WORDS WAS PAINTED. Every one of these left this
// check SILENT while the phone number was gone from the page (same fixture, same part, one rule at
// a time), which is why #1049 added ②d and ②e below:
//     { filter: opacity(0) }                     box 576×27, computed opacity 1 — the static half
//                                                catches this one by name
//     { clip-path: inset(100%) }                 box 576×27 — the static half catches it too, as a
//                                                property that is not on §2's whitelist at all
//     { margin-top: -9999px }                    box at document y −6943; the text sits at y −6940,
//                                                off the top of the page, unreachable by scrolling
//     { margin-left: -9999px }                   box at document x −9907
//     .contact-info { max-height: 1px }          the PART's box is untouched at 576×27, and the root
//                                                is only ever asked about opacity and display, so
//                                                this check sees nothing — while `.contact-info`'s
//                                                own `overflow: hidden` (globals.css, #1028) leaves
//                                                0 readable pixels. One line, out of two rules that
//                                                are each correct on their own
//     { max-height: 1px; overflow: hidden }      box 576×1, nothing readable inside it
// 🔴 THE THREE ABOVE ARE STILL THE WHOLE LIST FOR THE *BOX*; the seven writings are now caught by ②d
// (where the text ended up, and what is left of it after every clipping ancestor) and ②e (how many
// pixels of it were painted). What THIS paragraph's three still buy is a named cause — "hidden by
// div.contact-info { display: none }" points at the declaration, where ②d/②e can only point at the
// effect. Keep all five: none of them subsumes another.
//
// 🔴 ONLY PARTS THAT HAVE SOMETHING IN THEM ARE JUDGED, and that is not leniency — it is the
// difference between "the theme hid it" and "the app rendered it empty". `.contact-form__error` and
// `.contact-form__success` are in the markup on every page and carry no text until a form is
// submitted; a check that failed on a zero-height empty div would go red on a correct site, and a
// check that goes red on correct sites gets switched off. So: text content, or an <img>, or a link
// with an href — something a customer could have read or clicked.
const ESSENTIAL_PARTS_PROBE = () => [...document.querySelectorAll('[data-role="essential"]')]
  .flatMap((block) => {
    const blockName = block.getAttribute('data-block') || block.className || 'essential block';
    return [...block.querySelectorAll('[class*="__"]')]
      .filter((el) => {
        const hasText = (el.textContent || '').trim().length > 0;
        const hasMedia = el.tagName === 'IMG' || el.querySelector('img');
        const hasLink = el.tagName === 'A' ? el.getAttribute('href') : el.querySelector('a[href]');
        return hasText || hasMedia || hasLink;
      })
      .map((el) => {
        const eff = window.__effective(el);
        const r = el.getBoundingClientRect();
        return {
          block: blockName,
          where: (el.getAttribute('class') || el.tagName).trim().split(/\s+/)[0],
          width: Math.round(r.width),
          height: Math.round(r.height),
          opacity: eff.opacity,
          hiddenBy: eff.hiddenBy,
          zeroedBy: eff.zeroedBy,
          text: (el.textContent || '').trim().slice(0, 40),
        };
      });
  });

// ── ②d/②e the probe: every run of text an essential block owns, where it ended up, and what is ────
//      left of it after the clipping ancestors and the edge of the scrollable document
//
// 🔴 THE UNIT IS A RUN OF TEXT, NOT AN ELEMENT'S BOX — that difference is the whole point (#1049).
// `max-height: 1px` on a block does not make the block 1px: Tailwind's `box-sizing: border-box`
// plus the block's own `padding: 80px 64px` floor it at 160px, measured, and its headline goes on
// being perfectly readable. The four runs BELOW the headline are the ones that disappear. An
// element-box reading answers "is this box small" and cannot tell those apart; `Range.getClientRects()`
// over the element's own text nodes answers "where are these words", one rect per line box.
//
// 🔴 WHY A THRESHOLD PER LINE RATHER THAN AN AREA FOR THE WHOLE RUN: "the theme cut this paragraph
// short" is a design decision (the first lines are whole), and "the theme squeezed every line into a
// slit" is hiding. Those two have the same total area. A run is reported when NO line of it keeps
// `min(that line's own height, MIN_BODY_PX)` of visible height — MIN_BODY_PX is the contract's own
// number (§4 "Body text ≥ 14px", the same constant check ④ judges by), not one invented here, and
// taking the line's own height when it is smaller is what stops a legitimately small caption from
// being reported for being small.
//
// 🔴 THE ONE EXEMPTION IS AN ATTRIBUTE, AND THAT IS WHY IT CANNOT BE ABUSED BY A THEME. A carousel's
// off-screen slides, a closed mobile drawer and a collapsed accordion panel are all "text with no
// visible area", and a check that reported them would be red on a correct site — a check that is red
// on correct sites gets switched off, which this repo has paid for. What separates them from hiding
// is that the author SAID SO in the markup: `aria-hidden="true"`, the `hidden` attribute, an
// `aria-expanded="false"` control naming the element through `aria-controls`, or — since #1056 — a
// native `<details>` with no `open` attribute above it. A theme is a
// stylesheet, and CSS cannot write an attribute (contract §1 refuses attribute selectors off the
// hook list and `content` may only be the empty string), so this exemption is out of a theme's
// reach by construction. It is also exactly what a screen reader is told, so the rule it enforces is
// "a run of text is either there for everyone or gone for everyone".
// 🔴 It is not optional, either: `QuoteFormSection.tsx` and `ContactFormSection.tsx` each render a
// honeypot field as `aria-hidden="true"` + `left: -9999px`, inside `quote-form` / `contact-form`,
// which are `essential`. Without the exemption this check is red on a site nobody has themed.
//
// ══ #1056: THE COLLAPSED ACCORDION PANEL NAMED THREE LINES UP WAS THE ONE FORM NOT RECOGNISED ════
// The list above already said a collapsed accordion panel must not be reported, and this repo's own
// FAQ is exactly that — `FaqAccordionSection.tsx:65` renders each question as a native `<details>`
// with no `open`, which has needed no `aria-expanded` control since it stopped being a `useState`
// widget. So the panel text fell through every branch and was judged as ordinary body text, in both
// directions at once (PM measured both on `a14e39e7`, /allblocks.html of the sample site):
//   · ②e handed `.faq-accordion__answer` an ink score — 12.20 / 16.41 / 16.57 / 17.00 / 17.15 across
//     the three shipped sheets. A number saying "a customer can read this comfortably", about words
//     `checkVisibility({checkOpacity: true, checkVisibilityCSS: true})` answers `false` for.
//   · ②d called it hiding on sheets whose geometry differs: #1051's generated candidates were
//     stopped by `gates.js` with "laid out where a customer could see it … but not one pixel of it
//     is painted", 3 runs in each of 3 candidates.
//
// 🔴 THE EXEMPTION IS THE CLOSED `<details>`, NOT THE BLOCK. Open the panel and those same words are
// body text a customer reads, so a theme hiding them still has to be reported — which is why this is
// a walk up the ancestors asking about `open`, not a class name on a skip list.
// 🔴 AND IT STOPS AT THE `<summary>`: the question stays on screen while the panel is closed, so the
// walk remembers which child it came up through and lets the summary's own text keep being measured.
// Measured on the same page: `.faq-accordion__question` goes on getting an ink score after this
// change, and only `.faq-accordion__answer` stops.
const ESSENTIAL_TEXT_PROBE = () => {
  const name = (e) => e.tagName.toLowerCase()
    + (e.getAttribute && e.getAttribute('class') ? '.' + e.getAttribute('class').trim().split(/\s+/).join('.') : '');
  // Document coordinates throughout: `getBoundingClientRect` is relative to wherever the page happens
  // to be scrolled, and taking a screenshot scrolls it. Same reason check ②b adds `window.scrollY`.
  const docBox = (r) => ({ x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height });
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x;
    const h = Math.min(a.y + a.h, b.y + b.h) - y;
    return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
  };
  const collapsed = [...document.querySelectorAll('[aria-controls][aria-expanded="false"]')];
  const exemptedBy = (el) => {
    // `from` is the child this walk came up through — `null` on the first step, when `e` IS the
    // element that owns the text. It exists for the `<details>` branch below and nothing else.
    for (let e = el, from = null; e; from = e, e = e.parentElement) {
      if (e.getAttribute('aria-hidden') === 'true') return `${name(e)} carries aria-hidden="true"`;
      if (e.hasAttribute('hidden')) return `${name(e)} carries the hidden attribute`;
      // A closed native `<details>` hides everything under it EXCEPT its own first `<summary>` —
      // that one is the control a visitor clicks and is on screen the whole time. So the branch is
      // not "am I inside a closed <details>", it is "am I inside the part of it that is closed":
      // coming up through the summary is the one way past this. `:scope > summary` picks the first
      // such child, which is the only one the element treats as its control (any later `<summary>`
      // is ordinary panel content, and is hidden with the rest).
      if (e.tagName === 'DETAILS' && !e.hasAttribute('open')
          && from !== e.querySelector(':scope > summary')) {
        return `${name(e)} is a <details> with no open attribute, and this text is in the panel it keeps closed`;
      }
      if (e.id) {
        const ctrl = collapsed.find((c) => (c.getAttribute('aria-controls') || '').trim().split(/\s+/).includes(e.id));
        if (ctrl) {
          return `${name(e)} is named by ${name(ctrl)}'s aria-controls and that control says aria-expanded="false"`;
        }
      }
    }
    return null;
  };
  // Every element that can cut this text away. `overflow` is asked of all three axes because
  // `overflow-x: hidden` alone computes `overflow: hidden auto` and a check reading only the shorthand
  // would miss it. The clip is taken as the border box: the padding box is the exact answer, and the
  // difference can only make this check MORE forgiving, which is the safe direction for a check whose
  // false reds are the failure mode.
  //
  // 🔴 THE WALK STARTS AT THE ELEMENT ITSELF, NOT AT ITS PARENT, and that is not an off-by-one — an
  // element's own `overflow` clips its OWN text, and starting at the parent is a hole exactly the
  // width of the rule that is easiest to write. Measured on /allblocks.html of this repo's sample
  // site, before this line said `el`: `.contact-info__phone { max-height: 10px; overflow: hidden }`
  // squeezed a 24px line of the phone number into a 10px slit and the whole check came back rc=0 —
  // ②d never applied the clip, and ②e passed because the tops of the digits still painted some
  // pixels. That is the very case ②d's per-line threshold exists to name ("the theme squeezed every
  // line into a slit"), so the criterion was sound and only the walk was short. An element whose
  // overflow is hidden but whose box already fits its text intersects to a no-op, so this costs
  // nothing on a correct page (measured: the 117-run baseline is unchanged).
  const clippersOf = (el) => {
    const out = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        out.push({ who: `${name(e)} { overflow: ${cs.overflow} }`, rect: docBox(e.getBoundingClientRect()) });
      }
    }
    return out;
  };
  // Where a visitor can actually get to. Negative document coordinates and anything past
  // scrollWidth/scrollHeight are unreachable by scrolling, which is what `margin-left: -9999px` buys.
  const reachable = {
    x: 0,
    y: 0,
    w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
  };
  return [...document.querySelectorAll('[data-role="essential"]')].map((block) => {
    const blockName = block.getAttribute('data-block')
      || (block.getAttribute('class') || block.tagName).trim().split(/\s+/)[0];
    const runs = [];
    for (const el of [block, ...block.querySelectorAll('*')]) {
      // Only the text this element OWNS — its direct text-node children. Walking `textContent`
      // instead would report an ancestor and every descendant for the same words.
      const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (texts.length === 0) continue;
      const lines = [];
      for (const t of texts) {
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const r of range.getClientRects()) lines.push(docBox(r));
      }
      const clippers = clippersOf(el);
      const measured = lines.map((line) => {
        let vis = line;
        let cutBy = null;
        for (const c of clippers) {
          vis = intersect(vis, c.rect);
          if (!cutBy && (vis.w <= 0 || vis.h <= 0)) cutBy = c.who;
        }
        vis = intersect(vis, reachable);
        if (!cutBy && (vis.w <= 0 || vis.h <= 0)) {
          cutBy = 'it sits outside the part of the document that can be scrolled to';
        }
        const alive = vis.w > 0 && vis.h > 0 && vis.h >= Math.min(line.h, 14);
        return { line, vis, cutBy, alive };
      });
      runs.push({
        block: blockName,
        where: (el.getAttribute('class') || el.tagName).trim().split(/\s+/)[0],
        text: texts.map((t) => t.textContent.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 40),
        exempt: exemptedBy(el),
        lines: measured.length,
        alive: measured.filter((m) => m.alive).length,
        rawArea: Math.round(measured.reduce((n, m) => n + m.line.w * m.line.h, 0)),
        visArea: Math.round(measured.reduce((n, m) => n + m.vis.w * m.vis.h, 0)),
        at: measured.length ? { x: Math.round(measured[0].line.x), y: Math.round(measured[0].line.y) } : null,
        cutBy: (measured.find((m) => m.cutBy) || {}).cutBy || null,
        // What ②e photographs. Only the lines that survived ②d — a run ②d already reported does not
        // need a second finding, and the rectangles of the others are empty anyway.
        visRects: measured.filter((m) => m.alive).map((m) => m.vis),
      });
    }
    return { block: blockName, runs };
  });
};

// ── the page has to STOP MOVING before either dimension is measured ─────────────────────────────
// 🔴 THIS IS NOT TIDINESS, IT IS THE DIFFERENCE BETWEEN A READING AND A FALSE RED, and it cost a
// round to find. ②d measures where a run of text is; ②e photographs the block it lives in — and
// `el.screenshot()` SCROLLS THE PAGE, which is what makes a `loading="lazy"` image above that block
// finally load. Measured on /allblocks.html of this repo's sample site, before this function existed:
// `quote-form`'s box was at document y 4577.6 when the geometry was read and 91px lower when it was
// photographed, so every rectangle pointed at the wrong rows of the picture and
// `quote-form__intro` — a line of text a person can read perfectly — was reported as "not one pixel
// painted". The picture proved it: its top 91 rows were the block ABOVE quote-form.
// So: turn every lazy image eager and wait for it, wait for the web fonts, then let the browser lay
// out twice. Cheap (one evaluate per page) and it makes the two readings comparable by construction.
const settlePage = async () => {
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img')];
    for (const i of imgs) i.loading = 'eager';
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((done) => {
      i.addEventListener('load', done, { once: true });
      i.addEventListener('error', done, { once: true });
    }))));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
};

// The sentence every ②d/②e finding ends with. PM's requirement on this ticket: a person reading the
// red has to be told, in the red itself, that the exemption was considered and did not apply — and
// therefore what to write in the markup if this text really is meant to be off right now.
const NOT_EXEMPT = 'It was not skipped: neither it nor any ancestor carries aria-hidden="true" or the '
  + 'hidden attribute, no aria-expanded="false" control names it through aria-controls, and it is not '
  + 'in the closed panel of a <details> — so as far as the markup says, this text is on right now';

// ── ②d where the text ended up, and what is left of it ──────────────────────────────────────────
function judgeEssentialText(reading, where) {
  const found = [];
  for (const b of reading) {
    for (const r of b.runs) {
      if (r.exempt) continue;
      if (r.alive > 0) continue;
      const cause = r.lines === 0 || r.rawArea === 0
        ? `the words have no box of their own at all (${r.lines} line box(es), ${r.rawArea}px² before any clipping)`
        : `${r.cutBy || 'nothing a visitor can reach is left of it'} — ${r.rawArea}px² of text, `
          + `${r.visArea}px² of it reachable`;
      found.push(`visibility${where}: the text in "${r.where}" inside the essential block "${r.block}" `
        + `("${r.text}") is on the page but nowhere a customer could read it: 0 of ${r.lines} line(s) keep `
        + `${MIN_BODY_PX}px of visible height${r.at ? ` (first line at document ${r.at.x},${r.at.y})` : ''}. `
        + `${cause}. Contract §3. ${NOT_EXEMPT}.`);
    }
  }
  return found;
}

// ── ②e how many pixels of that text were actually painted ───────────────────────────────────────
// 🔴 THIS DIMENSION NAMES NO PROPERTY, WHICH IS THE POINT. `opacity: 0.0001`, `filter: opacity(0)`,
// `clip-path: inset(100%)` and `color: transparent` are four spellings of one outcome, and #1043
// established where the other road ends: mutating around the words a detector KNOWS never catches
// the writings that grow out of the allowed set. So the reading is the outcome — photograph the
// block, photograph it again with its own words made transparent, and count how many pixels changed
// inside each run's visible rectangle. Zero means those words were not on the screen. Same
// construction check ① has used since #966, applied per run of text instead of per hero element.
//
// 🔴 IT RUNS ONLY ON RUNS ②d PASSED. A run ②d already reported is somewhere unreachable, and asking
// a camera about it would either report it twice or fail to photograph it at all.
//
// ══ #1050: "SOME PIXELS CHANGED" IS NOT THE SAME ANSWER AS "A PERSON CAN READ IT" ════════════════
// `painted === 0` alone was the whole judgement until #1050, and it leaves a band this wide open.
// Measured on the sample site (/allblocks.html, ocean-blue + hero-media-left, 1440×900), one rule
// added to the sheet and nothing else touched — the phone number in the `essential` contact-info
// block, one line of 16px text, 2816px² of visible rectangle:
//
//     rule on .contact-info__phone    ②e before #1050   ink vs ground   pixels painted
//     ── none (the sheet as shipped)         pass           6.19:1        1097/2816
//        filter: blur(2px)                   pass           2.81:1        2141/2816
//        filter: blur(4px)                   pass           2.18:1        2684/2816
//        filter: blur(8px)                   pass           1.68:1        2816/2816
//        filter: blur(12px)                  pass           1.31:1        2815/2816
//        filter: blur(20px)                  pass           1.16:1        2619/2816
//        filter: blur(30px)                  pass           1.10:1        1039/2816
//        filter: blur(50px)                  FAIL             —              0/2816
//
// The last row is the only one the old judgement caught, and it is caught for an accidental reason:
// 50px happens to spread the ink until literally nothing is left. Photographed, everything from
// blur(4px) down is a shapeless smudge on the blue — not one digit of a phone number a customer is
// meant to dial — and all of it was a pass.
//
// 🔴 THE COUNT OF PAINTED PIXELS CANNOT BE THE THRESHOLD, and that last column is why. It goes UP as
// the text gets less readable: the untouched sheet paints 1097 of 2816, and blur(8px) — which no one
// can read — paints ALL 2816. Blurring does not remove ink, it spreads it. So every "at least N
// pixels" or "at least X% of the rectangle" rule ranks the unreadable row ABOVE the correct one, and
// the more unreadable it gets the better it scores, until the ink finally runs out. The column that
// falls all the way down is the contrast between the colour the ink came out and what is behind it.
// That is the one judged.
//
// 🔴 AND IT IS NOT check ①'s 4.5:1. This reading is taken on ARBITRARY runs of body text, not on the
// two big hero elements check ① was tuned for: a thin 16px stroke is mostly antialiased edge, which
// pulls the measured ink toward the ground even on a page that reads perfectly. The lowest any
// untouched sheet comes out, measured over all three of them:
//
//     the site CI builds (create-site skipAI, 5 pages)   8.84:1   contact-form__note
//     the 8-page fixture this ticket used                5.00:1   btn-primary in services-list
//
// 4.5 would leave the fixture half a point of room, and the first sheet to dip under it turns CI red
// on a page nobody can fault. A check that reddens correct pages is a check someone switches off.
//
// 🔴 WHY 2.5. It is half the LOWER of those two floors, and it lands in the gap the pictures show:
// the digits survive blur(2px) (2.81) and are gone by blur(3px) (2.39) — so the number refuses the
// first radius at which this phone number stops being a phone number, and still leaves 2× the room
// under everything a real sheet does today. 🔴 The reach of those floors: two sample sites under
// three sheets. Neither is a statement about customer sites, and no check runs there.
// Corpus, arithmetic and how to re-take it: `docs/reference/theme-css-contract.md` §4.
const MIN_ESSENTIAL_INK_CONTRAST = 2.5;

// The colour a run of text came out, and the worst thing it sits on — check ①'s construction
// (#992 r4) narrowed from "this element's box" to "these rectangles", because a run is some lines
// inside a block's picture and the rest of that picture is other people's text.
//
// `rects` are in document coordinates and `origin` is the block picture's top-left, also in document
// coordinates; both come from the caller, which already had to line the two up to count pixels.
// Returns null when there is nothing to measure — the caller says so rather than calling it a pass.
function inkContrast(img, bare, mask, rects, origin) {
  const { width, height } = img.bitmap;
  const inRects = new Uint8Array(width * height);
  let area = 0;
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x - origin.x));
    const y0 = Math.max(0, Math.floor(rect.y - origin.y));
    const x1 = Math.min(width, Math.ceil(rect.x + rect.w - origin.x));
    const y1 = Math.min(height, Math.ceil(rect.y + rect.h - origin.y));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * width + x;
        if (!inRects[i]) { inRects[i] = 1; area += 1; }
      }
    }
  }
  if (area === 0) return null;
  const ink = new Uint8Array(width * height);
  let painted = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (inRects[i] && mask[i]) { ink[i] = 1; painted += 1; }
  }
  if (painted === 0) return { painted: 0, area, ratio: null, textRgb: null, groundRgb: null };
  // Grounds come from the picture WITHOUT the words, so the text is never mistaken for its own
  // background — check ①'s reason, unchanged. The 5% cut is against the rectangles' area rather
  // than the block's: a colour covering 5% of one line is a ground, 5% of the whole block is not.
  const grounds = coloursOf(bare, inRects).filter((c, i) => i === 0 || c.n / area >= 0.05);
  // The stroke groups, then the one FURTHEST from the commonest ground: the middle of the letters.
  // Antialiased edges are on their way to the background and judging by them fails pages that read
  // perfectly. Under 2% of the ink is left out so one stray pixel cannot stand for the words.
  const all = coloursOf(img, ink);
  const strokes = all.filter((c) => c.n >= Math.max(4, painted * 0.02));
  const textRgb = (strokes.length ? strokes : all)
    .reduce((a, b) => (contrast(b.rgb, grounds[0].rgb) > contrast(a.rgb, grounds[0].rgb) ? b : a))
    .rgb;
  let ratio = Infinity;
  let groundRgb = grounds[0].rgb;
  for (const cand of grounds) {
    const r = contrast(textRgb, cand.rgb);
    if (r < ratio) { ratio = r; groundRgb = cand.rgb; }
  }
  return { painted, area, ratio, textRgb, groundRgb };
}

async function judgeEssentialPaint(reading, where) {
  const found = [];
  const blocks = await page.$$('[data-role="essential"]');
  for (let i = 0; i < reading.length; i += 1) {
    const b = reading[i];
    const candidates = b.runs.filter((r) => !r.exempt && r.alive > 0 && r.visRects.length > 0);
    if (candidates.length === 0) continue;
    const el = blocks[i];
    if (!el) {
      // Fail loud: the probe saw a block this handle list does not have, so nothing was measured.
      found.push(`visibility${where}: the essential block "${b.block}" was in the reading but could not be `
        + 'photographed (no element handle for it) — check ②e was not measured on it');
      continue;
    }
    const box = await el.evaluate((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    });
    // 🔴 THE PICTURE IS TAKEN BY DOCUMENT RECTANGLE, NOT BY ELEMENT, and that is the second half of
    // the same lesson as `settlePage()` above. `el.screenshot()` scrolls the element into view and
    // works out its clip from where the page then is; measured on /allblocks.html, once the four
    // blocks before it had each been photographed, `quote-form`'s picture came back 91px off — its
    // top rows were the END OF THE BLOCK ABOVE, while the element's box (asked before and after) had
    // not moved by a pixel, so no staleness guard could have caught it. The same block photographed
    // on its own came back right, which is why this only shows up in a full run.
    // `page.screenshot({ clip, fullPage: true })` takes the clip in DOCUMENT coordinates — the same
    // coordinates the text rectangles are in — so the mapping below is exact by construction rather
    // than by trust. Measured on all 8 essential blocks of that page: the two methods agree on 5 and
    // disagree on 3 (contact-info 5542px, quote-form 93724px, map-area 6672px), and it is this one
    // that agrees with the block photographed alone.
    const shootBox = () => page.screenshot({
      type: 'png', fullPage: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h },
    });
    let img;
    let bare;
    try {
      img = await Jimp.read(await shootBox());
      bare = await Jimp.read(await withoutWords(el, shootBox));
    } catch (e) {
      found.push(`visibility${where}: the essential block "${b.block}" could not be photographed `
        + `(${e.message.split('\n')[0]}) — check ②e was not measured on it, which is not the same as passing`);
      continue;
    }
    const { width, height } = img.bitmap;
    if (bare.bitmap.width !== width || bare.bitmap.height !== height) {
      found.push(`visibility${where}: the essential block "${b.block}" changed size between the two `
        + `pictures (${width}×${height} vs ${bare.bitmap.width}×${bare.bitmap.height}) — not measured`);
      continue;
    }
    // The two pictures have to be OF the box the rectangles are measured against, or every count
    // below is off by however far they disagree. 2px of tolerance for the browser's own rounding.
    if (Math.abs(width - box.w) > 2 || Math.abs(height - box.h) > 2) {
      found.push(`visibility${where}: the picture of the essential block "${b.block}" is ${width}×${height} `
        + `while its box is ${Math.round(box.w)}×${Math.round(box.h)} — the two do not line up, so check ②e `
        + 'was not measured on it');
      continue;
    }
    // 🔴 AND ASK AGAIN AFTERWARDS. `settlePage()` above removes the cause that was measured, but a
    // rectangle that no longer means anything is the one failure this dimension must never turn into
    // a red on a correct site — so the box is re-read once the pictures are taken, and a block that
    // moved is reported as NOT MEASURED rather than judged. Two pixels of tolerance for rounding.
    const boxAfter = await el.evaluate((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    });
    if (Math.abs(boxAfter.x - box.x) > 2 || Math.abs(boxAfter.y - box.y) > 2
      || Math.abs(boxAfter.w - box.w) > 2 || Math.abs(boxAfter.h - box.h) > 2) {
      found.push(`visibility${where}: the essential block "${b.block}" moved while it was being `
        + `photographed (${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)} `
        + `→ ${Math.round(boxAfter.x)},${Math.round(boxAfter.y)} ${Math.round(boxAfter.w)}×${Math.round(boxAfter.h)}), `
        + 'so the picture and the text rectangles are of two different layouts — check ②e was not '
        + 'measured on it, which is not the same as passing');
      continue;
    }
    const { mask } = wordPixels(img, bare);
    for (const r of candidates) {
      const ink = inkContrast(img, bare, mask, r.visRects, box);
      if (!ink) {
        // No rectangle left to look at once it was mapped onto the picture. Not a pass: ②d said
        // this run was reachable, so the two disagree and that is worth a line rather than silence.
        found.push(`visibility${where}: the text in "${r.where}" inside the essential block "${r.block}" `
          + `("${r.text}") has ${r.visArea}px² of reachable text by check ②d, but none of it lands inside `
          + 'the picture of its own block — check ②e was not measured on it, which is not the same as '
          + 'passing.');
        continue;
      }
      // #1050 — kept on the run so the reading line below can print the corpus. The day someone
      // wants to move MIN_ESSENTIAL_INK_CONTRAST, every number that decides it is already on screen.
      r.ink = ink;
      if (ink.painted === 0) {
        found.push(`visibility${where}: the text in "${r.where}" inside the essential block "${r.block}" `
          + `("${r.text}") is laid out where a customer could see it — ${r.alive} of ${r.lines} line(s), `
          + `${r.visArea}px² — but not one pixel of it is painted: photographing the block with and `
          + 'without its own words changes 0 pixels inside that text. That is what opacity: 0.0001, '
          + `filter: opacity(0), clip-path: inset(100%) and color: transparent all look like. `
          + `Contract §3. ${NOT_EXEMPT}.`);
        continue;
      }
      // #1050 — the ink IS on the screen; the question this half asks is whether any of it came out
      // as letters. Said as "smeared / washed out" rather than "low contrast" because the cause is
      // usually not a colour: the reading that made this check exist was `filter: blur(30px)`, whose
      // declared `color` is untouched and perfectly legible.
      if (ink.ratio < MIN_ESSENTIAL_INK_CONTRAST) {
        found.push(`visibility${where}: the text in "${r.where}" inside the essential block "${r.block}" `
          + `("${r.text}") is painted, but not as anything a customer could read: the ink came out `
          + `rgb(${ink.textRgb}) against rgb(${ink.groundRgb}) behind it = ${ink.ratio.toFixed(2)}:1, `
          + `under ${MIN_ESSENTIAL_INK_CONTRAST}:1 (${ink.painted} of ${ink.area}px² changed when its own `
          + 'words were taken away). That is what filter: blur(20px), a colour that matches the '
          + 'background, and a gradient painted over the words all look like — the words are still '
          + `there, spread or washed out until no letter is left. Contract §3. ${NOT_EXEMPT}.`);
      }
    }
  }
  return found;
}

// One reading line per page for ②d/②e — counts, not adjectives, so "checked and clean" can be told
// apart from "there was nothing on this page to check". The per-line survival counts are here on
// purpose (PM, #1049): the day someone wants to tighten MIN_BODY_PX, the corpus is already printed.
function textReading(reading, where) {
  const runs = reading.flatMap((b) => b.runs);
  const exempt = runs.filter((r) => r.exempt);
  const partly = runs.filter((r) => !r.exempt && r.alive > 0 && r.alive < r.lines);
  return `  ${where} — runs of text inside essential blocks: ${runs.length}`
    + ` · fully reachable: ${runs.filter((r) => !r.exempt && r.alive === r.lines).length}`
    + ` · partly cut: ${partly.length}${partly.length ? ` (${partly.map((r) => `${r.where} ${r.alive}/${r.lines} lines`).join(', ')})` : ''}`
    + ` · nowhere reachable: ${runs.filter((r) => !r.exempt && r.alive === 0).length}`
    + ` · skipped because the markup says they are off: ${exempt.length}`
    + `${exempt.length ? ` (${exempt.map((r) => `${r.where} — ${r.exempt}`).join('; ')})` : ''}`
    // #1050 — the ink readings ②e took, as numbers. "Clean" with no number under it cannot be told
    // from "nothing was photographed here", and the lowest one is what MIN_ESSENTIAL_INK_CONTRAST
    // has to stay under: whoever tightens it needs to see how much room three shipped sheets leave.
    + (() => {
      const inks = runs.filter((r) => r.ink && r.ink.ratio !== null);
      if (!inks.length) return ' · ink measured on: none of them';
      const worst = inks.reduce((a, b) => (b.ink.ratio < a.ink.ratio ? b : a));
      return ` · ink measured on ${inks.length} of them (how far what got painted is from what is behind`
        + ` it, ${MIN_ESSENTIAL_INK_CONTRAST}:1 is the floor) · lowest "${worst.where}" in "${worst.block}"`
        + ` ${worst.ink.ratio.toFixed(2)}:1 · all: `
        + inks.map((r) => `${r.where} ${r.ink.ratio.toFixed(2)}`).join(', ');
    })();
}

const ESSENTIAL_PROBE = () => ({
  roots: [...document.querySelectorAll('[data-role="essential"]')].map((n) => {
    const eff = window.__effective(n);
    return {
      display: getComputedStyle(n).display,
      visibility: getComputedStyle(n).visibility,
      opacity: eff.opacity,
      hiddenBy: eff.hiddenBy,
      zeroedBy: eff.zeroedBy,
      where: n.getAttribute('class') || n.tagName,
    };
  }),
  parts: window.__essentialParts(),
});

// Turn one page's reading into findings. Named, because ②c hands the very same one to a browser
// standing on each of the site's other pages — one definition of what this question means (the same
// reason check ⑤'s `classAuditInBrowser` is a named const).
function judgeEssential(reading, where) {
  const found = [];
  for (const e of reading.roots) {
    if (e.hiddenBy) {
      found.push(`visibility${where}: [data-role="essential"] "${e.where}" is hidden by ${e.hiddenBy}`);
    } else if (e.opacity === 0) {
      found.push(`visibility${where}: [data-role="essential"] "${e.where}" is invisible — ${e.zeroedBy} `
        + '(its own computed display and visibility say nothing about this)');
    }
  }
  for (const p of reading.parts) {
    const why = p.hiddenBy ? `hidden by ${p.hiddenBy}`
      : p.opacity === 0 ? `invisible — ${p.zeroedBy}`
        : (p.width === 0 || p.height === 0) ? `laid out ${p.width}×${p.height}` : null;
    if (why) {
      found.push(`visibility${where}: "${p.where}" inside the essential block "${p.block}" is ${why}`
        + ` — it carries content a theme may never hide ("${p.text}"), contract §3`);
    }
  }
  return found;
}

await page.evaluate(`window.__essentialParts = ${ESSENTIAL_PARTS_PROBE.toString()}`);
const essentialReading = await page.evaluate(ESSENTIAL_PROBE);
const essentials = essentialReading.roots;
if (essentials.length === 0) {
  problems.push('visibility: the page has no [data-role="essential"] at all — this check had '
    + 'nothing to look at, which is not the same as passing');
}
readings.push(`  essential elements: ${essentials.length}`
  + essentials.map((e) => ` · "${e.where}" opacity ${e.opacity}`).join('')
  + ` · parts with content inside them: ${essentialReading.parts.length}`);
problems.push(...judgeEssential(essentialReading, ''));
// ②d/②e on this page. Installed and judged right here rather than folded into ESSENTIAL_PROBE
// because ②e needs a camera, which lives in node, not in the document.
await page.evaluate(`window.__essentialText = ${ESSENTIAL_TEXT_PROBE.toString()}`);
await settlePage();
const textReadingHome = await page.evaluate(() => window.__essentialText());
problems.push(...judgeEssentialText(textReadingHome, ''));
problems.push(...await judgeEssentialPaint(textReadingHome, ''));
readings.push(textReading(textReadingHome, pathOf(baseUrl)));
// Which pages this check actually covered — printed at the bottom next to check ⑤'s page list, so
// "essential content is not hidden" states its own reach instead of leaving it to be assumed.
const essentialPagesMeasured = [pathOf(baseUrl)];

// ── ②b the lead block is on the first screen ────────────────────────────────────────────────────
// 🔴 #996 — spec §5.5 has said this since #991 and nothing implemented it, which QA3 demonstrated on
// #992 r3 with a sheet that is entirely legal: `.hero { margin-top: 2500px }` pushes the hero off the
// first screen, and all five invariants stayed green — the words ARE readable, they are just nowhere
// a visitor will look. `[data-role="lead"]` is the theme-independent way of asking "what is the first
// thing this page is about" (HeroSection sets it on the <section>).
// 🔴 MEASURED IN DOCUMENT COORDINATES, NOT VIEWPORT ONES. `getBoundingClientRect()` is relative to
// wherever the page happens to be scrolled, and check ① above has already scrolled it: taking an
// element's screenshot scrolls it into view. Measured on the driving mutation for this very check
// (`.hero { margin-top: 2500px }`, the sheet QA3 used on #992 r3): the viewport-relative version read
// `top 41px` and passed — the hero really was 2500px down the page, and the reading was taken from
// 2535px down. Adding `window.scrollY` back makes the number mean "how far into the page is this",
// which is the question, and it cannot be moved by anything the checker did earlier.
const leads = await page.$$eval('[data-role="lead"]', (nodes) => nodes.map((n) => {
  const r = n.getBoundingClientRect();
  return {
    top: r.top + window.scrollY,
    bottom: r.bottom + window.scrollY,
    height: r.height,
    where: n.getAttribute('class') || n.tagName,
  };
}));
const viewportH = await page.evaluate(() => window.innerHeight);
if (leads.length === 0) {
  problems.push('first screen: the page has no [data-role="lead"] at all — this check had nothing to '
    + 'look at, which is not the same as passing');
}
for (const l of leads) {
  readings.push(`  lead "${l.where}": top ${Math.round(l.top)}px, bottom ${Math.round(l.bottom)}px `
    + `(viewport height ${viewportH}px)`);
  // Some of it has to be inside the first screen. `top < viewportH` alone would pass an element that
  // starts above the fold and ends above it too (a sheet can pull a block up as easily as push it down).
  if (!(l.top < viewportH && l.bottom > 0 && l.height > 0)) {
    problems.push(`first screen: [data-role="lead"] "${l.where}" is not in the first screen — its box `
      + `is ${Math.round(l.top)}px..${Math.round(l.bottom)}px against a ${viewportH}px viewport, so a `
      + 'visitor sees none of it without scrolling');
  }
}

// ── ②c the hero's call-to-action is big enough to hit ───────────────────────────────────────────
// 🔴 #996 — the other rule spec §5.5 states and nothing measured. 44px is the size a finger needs
// (the number the platform guidelines settled on); a sheet can shrink a button with `padding` or
// `font-size`, both on the contract's whitelist, without touching anything the other checks read.
// 📌 Scope is the hero's own buttons on purpose. Every other block still renders the old markup, so
//    measuring the whole page would be judging things no theme can style yet (phase 2 moves them).
const MIN_TOUCH_PX = 44;
const ctaCount = await page.locator('.hero__cta').count();
if (ctaCount === 0) {
  problems.push('touch target: the page has no ".hero__cta" — this check had nothing to look at, '
    + 'which is not the same as passing');
} else {
  const buttons = await page.$$eval('.hero__cta a, .hero__cta button', (nodes) => nodes.map((n) => {
    const r = n.getBoundingClientRect();
    return { w: r.width, h: r.height, label: (n.textContent || '').trim().slice(0, 30) || n.tagName };
  }));
  if (buttons.length === 0) {
    problems.push('touch target: ".hero__cta" is on the page but contains no <a> or <button> — '
      + 'nothing was measured');
  }
  readings.push(`  hero buttons: ${buttons.map((b) => `"${b.label}" ${Math.round(b.w)}×${Math.round(b.h)}`)
    .join(' · ') || '(none)'}`);
  for (const b of buttons) {
    if (b.w < MIN_TOUCH_PX || b.h < MIN_TOUCH_PX) {
      problems.push(`touch target: hero button "${b.label}" is ${Math.round(b.w)}×${Math.round(b.h)}px `
        + `— below ${MIN_TOUCH_PX}px on ${b.w < MIN_TOUCH_PX && b.h < MIN_TOUCH_PX ? 'both sides'
          : b.w < MIN_TOUCH_PX ? 'width' : 'height'}`);
    }
  }
}

// ── ③ no sideways scroll ────────────────────────────────────────────────────────────────────────
// 🔴 THE COMPARISON IS AGAINST THE VIEWPORT, NOT AGAINST `body.clientWidth`. The obvious version of
// this check — `body.scrollWidth` vs `body.clientWidth` — cannot fail: when a sheet widens the body,
// BOTH numbers grow together. QA2 drove it on #991 r1 with a sheet that is entirely legal (`body` is a
// contract hook, `width` is on the whitelist):
//
//     body { width: 2400px }
//       body.scrollWidth 2400 / body.clientWidth 2400        ← the old check: "all four hold"
//       documentElement.clientWidth 1440, window.innerWidth 1440
//       window.scrollTo(3000,0) → scrollX 877                ← the page really does drag sideways
//
// And the reverse: overflow inside the hero cannot escape (`.hero { overflow: hidden }` in globals.css
// holds it, measured 1440/1440 with `.hero__media { width: 3000px }`). So the one route a legal sheet
// has to a sideways-scrolling page was exactly the route the old comparison was blind to.
const scroll = await page.evaluate(() => ({
  bodyScroll: document.body.scrollWidth,
  docScroll: document.documentElement.scrollWidth,
  viewport: document.documentElement.clientWidth,
  innerWidth: window.innerWidth,
}));
readings.push(`  scrollWidth body ${scroll.bodyScroll} / doc ${scroll.docScroll} vs viewport `
  + `${scroll.viewport} (window.innerWidth ${scroll.innerWidth})`);
const widest = Math.max(scroll.bodyScroll, scroll.docScroll);
if (widest > scroll.viewport) {
  problems.push(`sideways scroll: widest of body.scrollWidth ${scroll.bodyScroll} / `
    + `documentElement.scrollWidth ${scroll.docScroll} is ${widest} > viewport ${scroll.viewport}`);
}

// ── ④ body text is big enough ───────────────────────────────────────────────────────────────────
for (const sel of ['body', '.hero__sub']) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) {
    problems.push(`type size: "${sel}" is not on the page`);
    continue;
  }
  const px = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  readings.push(`  ${sel} font-size: ${px}px`);
  if (!(px >= MIN_BODY_PX)) problems.push(`type size: "${sel}" is ${px}px — below ${MIN_BODY_PX}px`);
}

// ── ⑤ every class on the page has a rule somewhere ──────────────────────────────────────────────
// #971 item 19, which #991 said this checker already subsumed. It did not: neither script had ever
// read the built HTML's class list (grep: 0 hits). It lives here rather than as a script of its own
// because the browser answers it without any of the parsing this needs on disk — escaped selectors
// (`.md\:flex`), rules inside `@media`, and `<style>` blocks in the page are all just entries in
// document.styleSheets.
//
// What it is for: a class in the markup with no rule anywhere is an unstyled page — #967's white
// first screen was exactly that shape (`bg-primary-950`, a colour the palette did not have), and
// the other four checks pass straight through it: black text on white has fine contrast, nothing is
// hidden, nothing scrolls sideways, the type is 16px. It is the failure that looks healthy.
//
// 🔴 #996 — AND THE SAME QUESTION ASKED OF THE THEME SHEET ALONE, WHICH IS A SECOND READING, NOT A
// REPLACEMENT. spec §5.5 narrows the HOOK half of this invariant to "the theme's own stylesheet has a
// rule for it", because a hook that only base.css styles (#1001) is a theme that forgot to dress the
// block — and the reading above cannot see that: base.css is a loaded stylesheet, so it satisfies it.
// The narrow reading alone would be a step back, though: #967's page was blank because the TAILWIND
// bundle came out empty while the theme sheet was fine, and only the wide reading above catches that
// (measured then: 112 of the page's 119 classes named). Two shapes, two readings, both kept.
//
// 📌 Which sheet is "the theme's": the one served at `/theme.css`. #996 wrote "the one under
//    `/themes/`" and left a note saying this is the line that changes when #1002 moves it — this is
//    that change (#1002 AC9). There is no `<link href="/themes/<id>.css">` any more: the block-layout
//    sheet's bytes are pasted INTO `/theme.css` together with the palette, so `/themes/` matches
//    nothing and the check reported "no stylesheet under /themes/ is loaded at all" on every dressed
//    site — an invariant that can only fail is worth as little as one that can only pass.
//    `/custom.css` (this site's own tweaks, #1006) and `/base.css` (#1001) are deliberately NOT the
//    theme's sheet: the point of this second reading is that neither the floor nor the site's own
//    overrides may stand in for a rule the theme was supposed to write.
const THEME_SHEET_PATH = '/theme.css';
// 📌 Only the CLASS hooks are asked for, and only the ones actually in the markup: `body`,
//    `[data-block]`, `[data-role]` and `[data-region-layout]` are contract hooks too, but no theme
//    selects them today, so requiring them would be inventing a rule nobody agreed to.
// 🔴 #1018 — READ FROM `theme-css-lint.js`, NOT COPIED (the import is at the top of this file). This
//    list used to be written out right here, and when cta-banner moved it stayed on phase 1's seven
//    hero names: delete every cta-banner rule from a theme sheet and this check still printed
//    `hooks in the markup: 7 · not dressed by the theme: 0` and exited 0 — the check passing while
//    checking nothing, which is exactly the shape spec §8 says it exists to catch. 31 more blocks are
//    going to lean on it.
//
// 📌 Both halves of the 2026-08-14 collision are kept here on purpose (#1018 r3, rebased onto #1002's
//    ship): the list is derived, AND the callback still takes `themeSheetPath` as its second argument
//    so #1002's `/theme.css` predicate below survives. Either half dropped is a check that stops
//    answering — the derived list without #1002's path finds no theme sheet at all, and #1002's path
//    with a hardcoded list never asks about any block past hero.
//
// 🔴 #1023 — AND THE SAME QUESTION IS ASKED OF EVERY PAGE OF THE SITE, NOT OF THIS ONE PAGE (⑤b, at the
//    bottom of this file). That is why the callback is a named const rather than the inline arrow it was:
//    ⑤b hands the very same one to a browser standing on a different page, so there is one definition of
//    what this question means. Until #1023 only the home page was ever looked at, and a home page carries
//    hero and cta-banner and nothing else — so `page-header`, which this sample site puts on four of its
//    five pages and on none of its first one, could have every rule deleted from all three sheets while
//    this check printed `hooks in the markup: 11 · not dressed by the theme: 0` and exited 0. That is
//    measured, not feared: QA2 did it on #1019. 30 more blocks are still to move (#1007) and most of them
//    are not home-page blocks either, so the blind spot was about to become the normal case.
const classAuditInBrowser = ([hookClasses, themeSheetPath]) => {
  const declared = new Set();
  const declaredByTheme = new Set();
  const themeSheets = [];
  let unreadableSheets = 0;
  const collect = (rules, into) => {
    for (const r of rules) {
      if (r.selectorText) {
        for (const m of r.selectorText.matchAll(/\.((?:\\.|[-\w -￿])+)/g)) {
          const name = m[1].replace(/\\(.)/g, '$1');
          declared.add(name);
          if (into) into.add(name);
        }
      }
      if (r.cssRules) collect(r.cssRules, into); // @media, @supports, @layer …
    }
  };
  for (const sheet of document.styleSheets) {
    // The theme's own sheet is the one at the fixed path (#1002). base.css (#1001) and custom.css
    // (#1006) are deliberately NOT it: the point of the second reading is that neither the floor nor
    // the site's own overrides may stand in for a rule the theme was supposed to write.
    let isTheme = false;
    try {
      isTheme = !!sheet.href && new URL(sheet.href, window.location.href).pathname === themeSheetPath;
      if (isTheme) themeSheets.push(new URL(sheet.href, window.location.href).pathname);
    } catch { isTheme = false; }
    let rules;
    try { rules = sheet.cssRules; } catch { unreadableSheets++; continue; } // cross-origin (fonts)
    collect(rules, isTheme ? declaredByTheme : null);
  }
  const used = new Map();
  for (const el of document.querySelectorAll('[class]')) {
    for (const c of (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) {
      if (!used.has(c)) used.set(c, el.tagName.toLowerCase());
    }
  }
  return {
    unreadableSheets,
    sheets: document.styleSheets.length,
    used: used.size,
    orphans: [...used.entries()].filter(([c]) => !declared.has(c)).map(([c, tag]) => `${tag}.${c}`),
    themeSheets,
    // The hooks actually present in this page's markup, and which of them the theme sheet dresses.
    hooksOnPage: hookClasses.filter((c) => used.has(c)),
    hooksMissingFromTheme: hookClasses.filter((c) => used.has(c) && !declaredByTheme.has(c)),
  };
};
// The reading for the page every check above measured. It is REPORTED at ⑤b rather than here, together
// with the other pages' — one hook that four pages are missing a rule for is one finding, not four, and a
// finding that repeats itself four times is one nobody finishes reading. The reading itself has to be
// taken here, while this is the page the browser is standing on.
const audits = [{ where: pathOf(baseUrl), audit: await page.evaluate(classAuditInBrowser, [HOOK_CLASSES, THEME_SHEET_PATH]) }];

// ── ⑥ the order things are painted in is the order the DOM has them in ─────────────────────────
// #1011 — a screen reader and the Tab key walk the DOM. A sheet that changes what a person SEES
// first without moving a byte of markup makes those two different pages, and every check above stays
// green: the words are readable, nothing is hidden, nothing scrolls sideways.
//
// 🔴 IT DOES NOT ASK WHICH PROPERTIES CAN DO THIS. Four rounds of this ticket tried to write that
// list and missed something each time — `order`, then a `flex-flow` spelling, then `margin` from a
// different group of §2 altogether. §4 above already reached the same conclusion about colour ("the
// set of properties that change what colour reaches the screen is not something to enumerate") and
// answered it the same way: don't predict, read the finished page. So this compares two orders and
// never looks at a declaration.
//
// 🔴 WHAT IT COVERS, AND THAT LINE IS THE DESIGN'S, NOT THIS FILE'S: spec §7.4 "骨 vs 皮" (:731)
// puts which blocks and in what order on the site's side of the fence, and the shape of a block on
// the theme's. So: the page's regions (`<body>`'s own children) and the blocks inside them — all in
// ONE sequence, see the note in `collectOrder` for why one and not one per layer. Reordering the PARTS
// inside a block (`.hero__media` before `.hero__body`) is what all three phase-1 sheets do with
// `order`, and it stays legal.
//
// 🔴 THE COMPARISON IS (y, THEN x), NOT y ALONE. Measured by PM on the real build: with the blocks
// laid out in a row, all four sit at y=76 with x running backwards — y alone reads "same order" on a
// page whose reading order is reversed. Nothing legal can do that today (`main` is not a hook, and
// `body`'s Tailwind classes out-specify it) but the reading costs nothing and is not built on those
// two facts staying true.
//
// 🔴 AN ELEMENT WITH NO BOX IS NOT COMPARED AND IS NOT A FAILURE, AND THE ONES SKIPPED ARE NAMED.
// `[data-role="optional"] { display: none }` is legal (§3 only refuses it on `essential`) and is what
// these themes hide the eight `rhythm.hide` blocks with. Such an element answers y=0, x=0 — sorting
// on that alone sends it to the front and reports a swap a person cannot see, and a check that cries
// wolf gets loosened. `getClientRects().length === 0` is the first half of the question, because it is
// the browser's own answer to "was this laid out at all".
// 🔴 The second half is that it has some extent, and it is not theoretical: Next appends
// `<next-route-announcer style="position:absolute">` as `<body>`'s LAST child, and it is laid out
// (`getClientRects().length` 1) at y=0, x=0 with width and height 0. On the untouched build, with no
// sheet of any kind added, the first version of this check reported it painted before `<main>` and
// before `<footer>` — two false reds at each of three viewports, on a page nobody had touched.
// Nothing with zero extent in both directions puts anything anywhere a person can see it. A box that
// is 1440×0 still sits at a real place in the flow, so `height: 0` and `max-height: 0` — like
// `visibility: hidden` and `opacity: 0` — go on being compared.
const ORDER_VIEWPORTS = [{ w: 1440, h: 900 }, { w: 768, h: 1024 }, { w: 375, h: 812 }];
// 🔴 Metadata elements are left out rather than skipped-and-named: `<script>` and friends can never
// have a box, so naming them every run would bury the skips that matter (the ones above).
const NON_RENDERED = ['script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'base'];
const collectOrder = (nonRendered) => {
  const label = (n) => {
    const block = n.getAttribute('data-block');
    if (block) return `[data-block="${block}"]`;
    const region = n.getAttribute('data-region-layout');
    const tag = n.tagName.toLowerCase();
    return region ? `<${tag} data-region-layout="${region}">` : `<${tag}>`;
  };
  const skip = new Set(nonRendered.map((t) => t.toUpperCase()));
  // 🔴 ONE SEQUENCE FOR THE WHOLE PAGE, NOT ONE PER LAYER (#1011 r2, found by QA3 on the real build).
  // The first version compared the regions among themselves and the blocks among themselves, and never
  // put a region and a block in the same sequence. So this got through it green:
  //     [data-role="essential"] { margin-bottom: -1000px }          (legal, static checker rc=0)
  // the footer was painted at y 1565 and the contact form at y 1827 — a visitor scrolls past the whole
  // footer, copyright line included, and THEN meets the form, while the Tab key and a screen reader
  // still have the form first. Region order stayed ascending (header → main → footer) and no block
  // moved relative to another block, so both groups were in order and neither of them was wrong: the
  // pair that swapped had one member in each group, and that pair was never compared.
  //
  // The regions, the blocks inside them, and their nested blocks are not ancestors of one another once
  // the ancestors are dropped (below), and elements that are not ancestors of one another can all go
  // into one sequence. Which is also the plain reading of what this check is for: a person sees ONE
  // page, not a region layer and a block layer.
  const regions = [...document.body.children].filter((n) => !skip.has(n.tagName));
  const candidates = [...new Set([...regions, ...document.querySelectorAll('[data-block]')])];
  // 🔴 An element that CONTAINS another candidate is dropped, and this is what makes the single
  // sequence legitimate: `<main>`'s box spans every block in it, so `main` vs its own blocks is a
  // comparison about nothing (and a block pulled above main's top would be reported as swapped with
  // its own parent). The inner element already says where that subtree was painted. Same rule handles a
  // block nested inside another block, which is why nothing needs to know whether phase 2 nests them.
  const seq = candidates
    .filter((n) => !candidates.some((m) => m !== n && n.contains(m)))
    // DOM order — the set is disjoint after that filter, so this is a total order. `window.Node`
    // rather than a bare `Node`: this function is a string sent to the browser, and the repo's eslint
    // config knows `document` / `window` but not the rest of the DOM globals (same trap as the
    // playwright specs). A bare `Node` fails `npm run lint:scripts`, not the run.
    .sort((a, b) => ((a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1));
  const items = seq.map((n, i) => {
    const box = n.getBoundingClientRect();
    return {
      label: label(n),
      dom: i,
      boxed: n.getClientRects().length > 0 && (box.width > 0 || box.height > 0),
      // Viewport coordinates, which are document coordinates here because the caller has put the page
      // back at the top and checks below that it really went (see the scroll note in the loop).
      y: Math.round(box.top),
      x: Math.round(box.left),
    };
  });
  const main = document.querySelector('main');
  return {
    items,
    hasMain: !!main,
    blocks: main ? main.querySelectorAll('[data-block]').length : 0,
    scrollY: window.scrollY,
    scrollX: window.scrollX,
  };
};
// Remembered so the page is handed back at the size the checks above measured it at — same reason
// `withoutWords` undoes its probe: whatever gets appended after this check must not silently inherit
// a 375px-wide page.
const orderViewport = await page.viewportSize();
// 🔴 THE WIDTHS ARE NOT A FIXED LIST — the page's own stylesheets say what they have to be
// (#1011 r3, found by QA2 on the real build). §2 lets a sheet write `@media (min-width: …)` with any
// value it likes, so the three viewports above cover every threshold up to 1440 — a threshold at or
// below the widest width measured is active while that width is measured — and nothing above it.
// Measured on the real build: `@media (min-width: 1920px) { [data-region-layout="slim-row"]
// { order: -1 } }` is legal (static checker rc=0) and paints the footer at y=0, above the header and
// every block, on an ordinary 1920×1080 desktop — while this check read rc=0 and said so.
// A wider fixed list cannot fix that: 1921 evades a list ending at 1920. What closes it is that the
// sheet has to DECLARE the threshold to use it, so the thresholds are readable, and each one that sits
// above the base widths gets its own measurement.
const breakpoints = await page.evaluate((maxBase) => {
  const conds = new Set();
  let unreadable = 0;
  const walk = (rules) => {
    for (const r of rules) {
      const cond = r.conditionText ?? (r.media && r.media.mediaText);
      if (typeof cond === 'string' && cond) conds.add(cond);
      if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { unreadable += 1; continue; } // cross-origin (fonts)
    walk(rules);
  }
  // The length is resolved by the browser, not by a unit table in this file: a probe element given the
  // same length as its `width` answers in pixels, so `em` / `rem` / `calc(40em + 10px)` — all legal in
  // a single `(min-width: …)` condition, and the static checker passes them — come out right.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:0;font-size:16px';
  document.body.appendChild(probe);
  const above = [];
  const unresolved = [];
  const notAWidth = [];
  for (const cond of conds) {
    const m = /^\s*\(\s*min-width\s*:\s*(.+?)\s*\)\s*$/i.exec(cond);
    if (!m) { notAWidth.push(cond); continue; }
    probe.style.width = '';
    probe.style.width = m[1];
    const px = probe.style.width ? probe.getBoundingClientRect().width : NaN;
    if (!Number.isFinite(px)) { unresolved.push(cond); continue; }
    // At or below the widest base width it is already exercised there; only the ones above need a
    // viewport of their own.
    if (Math.ceil(px) > maxBase) above.push({ cond, w: Math.ceil(px) });
  }
  probe.remove();
  return { above, unresolved, notAWidth, unreadable };
}, Math.max(...ORDER_VIEWPORTS.map((v) => v.w)));
// ── #1046 条 18 — IS THERE ANYTHING ON THIS PAGE THAT COULD TIE A DISTANCE TO THE WINDOW? ────────
//
// The grown-window stage below reports "the gap between A and B closes as the window widens" as a
// violation, on the reasoning that only a window-relative length makes a distance shrink monotonically.
// It cannot tell that apart from PLAIN CONTENT REFLOW — text that wraps one line fewer as the window
// grows — and it says so itself, two readings further down, in the list of what it does not cover.
// Measured on #1036's allblocks fixture with `hero-media-left`: `testimonials → divider` reads 845px at
// 3072 and 787px at 6144, which extrapolates to the pair meeting at about 47828px, while this stage
// never opens a window past 8192. Two readings from the same tree said what it really was: not one
// window-relative length in the three sheets, `base.css` or `globals.css`, and the only `100vh` in the
// whole built site is `min-h-screen` on <body> — a region, not a block.
//
// So the finding gets a second half. The claim is "this page ties that distance to the window", and a
// page with no window-relative length anywhere cannot be doing that — whatever else is moving. Without
// a length to point at it is a reading, not a violation. 🔴 The absence is only as good as what could
// be read: sheets this script may not open are counted and the sentence says so, so "found none" never
// gets to mean "there are none" when some were unreadable.
// 🔴 AND IT ASKS WHETHER THAT LENGTH IS ON ANYTHING INSIDE THE PAGE, NOT JUST WHETHER IT EXISTS.
// The first version of this counted every window-relative length in every sheet, and on the demo site
// that is 1: `.min-h-screen { min-height: 100vh }`, which the app puts on <body>. A height on <body>
// cannot shrink the distance between two of its grandchildren as the window widens — so counting it
// would have left the #1036 case reported exactly as before, and this check would have been an
// elaborate way of changing nothing. What has to be true for the claim is that some element OTHER than
// <html>/<body> is being given such a length. That is a question the browser can answer directly.
const windowRelative = await page.evaluate(() => {
  // `vw`/`vh` and their small/large/dynamic spellings, `vmin`/`vmax`, and the three functions that can
  // bend two straight lines into a V. `min-width:` cannot match `\bmin\(` — the `-` breaks the word.
  const RE = /(?:^|[^\w-])\d*\.?\d+(?:vw|vh|vmin|vmax|svw|svh|svmin|svmax|lvw|lvh|lvmin|lvmax|dvw|dvh|dvmin|dvmax)\b|\b(?:clamp|min|max)\(/i;
  const hits = [];
  const onlyRoot = [];        // has such a length, but reaches nothing below <body>
  let unreadable = 0;
  let unmatchable = 0;        // a selector this browser will not run (an @-rule shape, a typo)
  const walk = (rules, sheetName) => {
    for (const r of rules) {
      if (r.style && r.cssText && RE.test(r.cssText)) {
        const text = `${sheetName}: ${r.cssText.slice(0, 160)}`;
        let reaches = 0;
        try {
          for (const n of document.querySelectorAll(r.selectorText)) {
            if (n !== document.documentElement && n !== document.body) reaches += 1;
          }
        } catch { unmatchable += 1; reaches = 1; }   // cannot tell ⟹ count it, the safe direction
        if (reaches > 0) { if (hits.length < 8) hits.push(text); } else if (onlyRoot.length < 8) onlyRoot.push(text);
      }
      if (r.cssRules) walk(r.cssRules, sheetName);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { unreadable += 1; continue; }
    walk(rules, sheet.href ? new URL(sheet.href).pathname : '(inline <style>)');
  }
  return { hits, onlyRoot, unreadable, unmatchable };
});

// One viewport per distinct threshold. 🔴 The cap is announced rather than applied quietly: a page that
// declares fifty breakpoints would otherwise take fifty measurements, and a silently dropped one reads
// exactly like a covered one.
const EXTRA_VIEWPORT_CAP = 12;
const wanted = [...new Map(breakpoints.above.map((b) => [b.w, b])).values()].sort((a, b) => a.w - b.w);
const extraViewports = wanted.slice(0, EXTRA_VIEWPORT_CAP).map((b) => ({ w: b.w, h: 900, cond: b.cond }));
const droppedViewports = wanted.slice(EXTRA_VIEWPORT_CAP);
// ONE reading at ONE width, called by the loop below and by the grown-window stage after it. Two copies
// of "measure, then compare" would be two definitions of what this invariant means, and the second copy
// is where the drift starts.
const orderReading = async (vp) => {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  // 🔴 BACK TO THE TOP FIRST, AND `behavior: 'instant'` IS THE WHOLE POINT. The checks above scroll
  // the page (taking an element's screenshot scrolls it into view) and `globals.css:7` sets
  // `scroll-behavior: smooth`, so a plain `scrollTo(0, 0)` starts an ANIMATION and the reading right
  // after it is taken from wherever the page still is. It matters because the header is
  // `position: sticky`: from a scrolled page it reports itself at the top of the viewport, which in
  // document coordinates is the middle of the page. Measured on `.hero { margin-top: 2500px }` — a
  // sheet this check must pass — the animated version read the header at y 2535 against `<main>` at
  // y 76 and called it a swap.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  // Two frames: one for the resize and the scroll to reflow, one to be sure layout has settled.
  await page.evaluate(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(done));
  }));
  const at = `${vp.w}×${vp.h}`;
  // 🔴 A derived width has to prove it does what it was derived for. The threshold came out of a probe
  // element, so a wrong answer would be silent: the viewport gets set, the block never activates, and
  // the run reads exactly like a covered one. `matchMedia` asks the browser the same question the
  // browser answers when it applies the rule.
  if (vp.cond && !await page.evaluate((c) => window.matchMedia(c).matches, vp.cond)) {
    return { at, w: vp.w, h: vp.h, conditionInactive: true };
  }
  const { items, hasMain, blocks, scrollY, scrollX } = await page.evaluate(collectOrder, NON_RENDERED);
  if (scrollY !== 0 || scrollX !== 0) {
    return { at, w: vp.w, h: vp.h, scrolledTo: `${scrollX}, ${scrollY}` };
  }
  // DOM order still, so the gaps below are between DOM-neighbours.
  const boxed = items.filter((it) => it.boxed);
  const painted = [...boxed]
    // Array.prototype.sort is stable, so items that land on the same (y, x) keep their DOM order
    // and are not reported as swapped. That is the `transparent-overlay` header, which sits at the
    // same y=0 as the block under it — a tie is not a swap.
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const swaps = [];
  for (let i = 0; i < painted.length; i += 1) {
    for (let j = i + 1; j < painted.length; j += 1) {
      if (painted[i].dom > painted[j].dom) {
        swaps.push(`${painted[i].label} is painted before ${painted[j].label} (at y ${painted[i].y}`
          + `, x ${painted[i].x} vs y ${painted[j].y}, x ${painted[j].x}) but comes after it in the DOM`);
      }
    }
  }
  // 🔴 THE SAME QUESTION AS `swaps`, BUT WITH A MARGIN LEFT IN IT. If no gap between DOM-neighbours is
  // negative then the y sequence IS the DOM sequence, so a gap list and a swap list are the same
  // statement — except that a gap says HOW FAR from swapping the pair is, and the grown-window stage
  // below needs exactly that number to tell "this page does not care about the window width" from
  // "this page is closing in on a swap and the width where it lands is arithmetic".
  const gaps = boxed.slice(1).map((it, i) => ({
    pair: `${boxed[i].label} → ${it.label}`, d: it.y - boxed[i].y,
  }));
  return {
    at, w: vp.w, h: vp.h, hasMain, blocks, painted, skipped: items.filter((it) => !it.boxed), swaps, gaps,
  };
};
const baseReadings = [];
for (const vp of [...ORDER_VIEWPORTS, ...extraViewports]) {
  const r = await orderReading(vp);
  if (r.conditionInactive) {
    // 🔴 A derived width has to prove it does what it was derived for. The threshold came out of a probe
    // element, so a wrong answer would be silent: the viewport gets set, the block never activates, and
    // the run reads exactly like a covered one. `matchMedia` asks the browser the same question the
    // browser answers when it applies the rule.
    problems.push(`paint order: at ${r.at} the condition this width was derived from — @media ${vp.cond} `
      + '— is not active, so whatever it does was not measured at any width. This width is not a '
      + 'reading about that block');
    continue;
  }
  if (r.scrolledTo) {
    // Fail loud rather than report a swap: every y would be a position-plus-scroll for a `sticky` or
    // `fixed` element, and "I measured it from the wrong place" is not a finding about the page.
    problems.push(`paint order: at ${r.at} the page would not go back to the top before measuring `
      + `(scroll ${r.scrolledTo}) — every position here would be a sticky element's viewport position, `
      + 'so this viewport was not judged');
    continue;
  }
  // Nothing to look at is not a pass — the same rule the checks above are written by. Neither of these
  // can be reached by a sheet (both are questions about the markup), and that is why they are worth
  // asking: the block layer of this check would otherwise go quiet the day phase 2 renames the hook,
  // and a quiet check reads exactly like a passing one.
  if (!r.hasMain) {
    problems.push(`paint order: at ${r.at} the page has no <main> — the block layer of this check had `
      + 'nothing to look at, which is not the same as passing');
  } else if (r.blocks === 0) {
    problems.push(`paint order: at ${r.at} there is no [data-block] anywhere inside <main> — the block `
      + 'layer of this check had nothing to look at, which is not the same as passing');
  }
  readings.push(`  paint order @${r.at}: ${r.painted.length} compared (regions and blocks in one sequence)`
    + `${r.swaps.length === 0 ? ', same order as the DOM' : `, ${r.swaps.length} pair(s) out of order`}`
    + `${r.skipped.length ? ` · not compared, no box at all: ${r.skipped.map((s) => s.label).join(', ')}`
      + ' (this check is blind to those until they are laid out again)' : ''}`);
  for (const swap of r.swaps.slice(0, 3)) {
    problems.push(`paint order: at ${r.at} the page is painted in a different order than the DOM has `
      + `it — ${swap}. Reading order and the Tab key follow the DOM, so what a visitor sees and what a `
      + `screen reader says are two different pages`
      + `${r.swaps.length > 3 ? ` (${r.swaps.length - 3} more pair(s) like this one)` : ''}`);
  }
  baseReadings.push(r);
}
// 🔴 A LENGTH CAN BE A SHARE OF THE WINDOW, AND THEN NO THRESHOLD ANNOUNCES IT (#1011 r4, found by QA2
// on the real build). `[data-region-layout="cta-band"] { margin-top: -45vw }` declares no `@media` at
// all, so the width list above — read off the page's own thresholds, which was the r3 fix — does not
// grow by a single entry. It is legal (§2 takes any length, `calc(40em + 10px)` included, and the static
// checker passes it), it changes nothing at 1440 or 1536, and on an ordinary 1920×1080 desktop it paints
// the footer above the contact form while every reading above says "same order as the DOM". Two more of
// the same family, both measured: `.hero { margin-bottom: -55vw }` (features-grid above the hero from
// 1680 up) and `-58%`, since a percentage margin resolves against the containing block's WIDTH.
//
// 🔴 SO THIS STAGE DOES NOT PICK WIDTHS EITHER — that road has now been walked twice (a fixed list in
// r2, the page's declared thresholds in r3) and a share-of-the-window length walks past both. It asks a
// different question: once every threshold has been passed, is this page's VERTICAL geometry still a
// function of the window WIDTH? On an untouched build it is not — the gaps between DOM-neighbours came
// out 76 · 904 · 507 · 340 · 738 at 1440, 2880, 5760 and 8192, identical at all four, because the
// content column stops growing while the window keeps going. A share-of-the-window length is the
// opposite by construction: it grows with every pixel of window, so the gap closes, and the width where
// it reaches zero is arithmetic rather than a guess. Only when a gap is measured shrinking does this
// stage go looking, and then it looks by doubling — the widths are a consequence of the page's own
// numbers, not a list this file chose.
// 🔴 AND IT GROWS THE WINDOW IN BOTH DIRECTIONS, because `vh` is the same attack lying on its side.
// Every viewport above is 900, 1024 or 812 tall, so a share-of-the-HEIGHT length can sit just under all
// three the way `-45vw` sat just under the widths. Measured on this build: `.hero { margin-bottom:
// -80vh }` is legal, leaves 184px of gap at 900 tall and 85px at 1024 — every base viewport reads "same
// order as the DOM" — and at 2048 tall paints features-grid at y -658, above the header and above the
// hero. Making the window taller only ever makes gaps BIGGER on a page that is not doing this (a block
// with `min-h-screen` grows with it), so the question and its answer are the same shape on both axes and
// one loop asks both.
// 📌 What it does NOT reach, measured rather than assumed, because I first wrote the opposite here and
// the reading refuted it: the same trick on the footer REGION is absorbed. `[data-region-layout=
// "slim-row"] { margin-top: -72vh }` computes to -737px at 1024 tall, and `main` — `flex: 1` in a
// `min-h-screen` column — simply grows by that much (its height went 2489 → 3266 from 1024 to 2048
// tall), so the footer's top never passes the contact form's: they tie at exactly 1024 and the gap
// GROWS after that. A page that absorbs the pull has not been reordered, and this stage says so by
// staying quiet about it.
// 🔴 WHAT THIS STAGE LEANS ON, AND WHERE THAT LIVES. Doubling finds a swap only while the distance keeps
// CLOSING, so a length that closes a gap and then opens it again — a peak inside a narrow band of widths
// — would sit between two of these sizes and never be seen. Three of those were built and measured on
// this build, all legal, all green here (#1011): `calc(-1200px + 8 * abs(100vw - 1900px))` swaps two
// blocks at 1900 and 1901 only · `calc(-1 * mod(100vw, 1200px))` from 2300 to 2399 ·
// `calc(-1px * ((100vw / 1px) - 1800) * (2000 - (100vw / 1px)) / 10)` at 1900, with no function at all.
// The answer is NOT a fourth way of choosing widths — a peak can be put between any two of them — but
// contract §2, which admits only lengths that move ONE WAY as the window grows: one window-relative unit
// per length, nothing window-relative as a divisor, no min() / max() / clamp()-style function. That is
// enforced by `scripts/theme-css-lint.js`, and it is the assumption THIS stage's argument stands on, so
// it is written here too rather than only there.
// 🔴 AND THE HALF OF THAT RULE THIS STAGE NEEDS MOST IS THE SECOND ONE (#1011 r6, found by QA1 here).
// The distance measured below is between the TOPS of two neighbours, which is the first one's used
// HEIGHT plus the margins between them — so it is not enough for the lengths a sheet writes to be
// straight lines, the browser must not bend one either, and it bends one wherever a length SIZES a box
// (`max(min-height, min(max-height, what the content needs))`). §2 therefore keeps window-relative
// lengths out of every size, and only then do straight lines add up to a straight line. Measured here,
// green at every reading this file takes: `.hero { min-height: calc(100vw - 1800px); max-height:
// calc(2200px - 100vw); margin-bottom: -500px }` — two straight lines, a V between 1800 and 2200, and
// the distances this stage compares never moved at all because the margin is a constant and the HEIGHT
// is what was moving.
const WIDEST_MEASURED = Math.max(...[...ORDER_VIEWPORTS, ...extraViewports].map((v) => v.w));
const TALLEST_MEASURED = Math.max(...ORDER_VIEWPORTS.map((v) => v.h));
// The biggest window this check will open, on either side. Not a coverage claim — it is printed, and
// when a gap is still closing here the arithmetic that follows says where it lands.
const GROWN_WINDOW_CAP = 8192;
// Sub-pixel rounding is not shrinking. `Math.round` on two positions can move a gap by 1px on its own.
const GAP_NOISE_PX = 1;
// One axis, doubled while the page's own numbers keep moving. Returns what to print; the problems it
// finds go straight into `problems` so the two axes cannot disagree about what a violation is.
const growWindow = async (axis) => {
  const wide = axis === 'width';
  const start = wide ? WIDEST_MEASURED : TALLEST_MEASURED;
  const other = wide ? 900 : ORDER_VIEWPORTS[0].w;
  const verb = wide ? 'widened' : 'got taller';
  const noun = wide ? 'width' : 'height';
  // The base reading to compare the first doubled one against. For width there is one among the base
  // viewports; for height the tallest base viewport is 768 wide, and mixing that with a 1440-wide
  // reading would report the difference between two DIFFERENT layouts as shrinking — so take a fresh
  // reading at the size this axis is about to grow from.
  let previous = wide
    ? baseReadings.find((r) => r.w === start && r.gaps)
    : await orderReading({ w: other, h: start });
  if (!previous || !previous.gaps) {
    return `${noun}: not run — the ${wide ? 'widest' : 'tallest'} base window was not judged`;
  }
  const steps = [];
  let closing = [];
  let outcome = 'nothing measured';
  for (let size = start * 2; size <= GROWN_WINDOW_CAP; size *= 2) {
    const r = await orderReading(wide ? { w: size, h: other } : { w: other, h: size });
    if (r.scrolledTo || !r.gaps) {
      problems.push(`paint order: at ${r.at} the page would not go back to the top before measuring `
        + `(scroll ${r.scrolledTo}), so the grown-window stage has no reading for that ${noun} — and `
        + '"no reading" is not "nothing wrong"');
      outcome = `stopped at ${r.at}, no reading`;
      closing = [];
      break;
    }
    steps.push(r);
    if (r.swaps.length) {
      for (const swap of r.swaps.slice(0, 3)) {
        problems.push(`paint order: at ${r.at} the page is painted in a different order than the DOM `
          + `has it — ${swap}. No @media on the page names this ${noun}: it was reached by doubling `
          + `${start}px because the gaps between neighbours were measured closing as the window ${verb}, `
          + `which is what a length written as a share of the window's ${noun} does`
          + `${r.swaps.length > 3 ? ` (${r.swaps.length - 3} more pair(s) like this one)` : ''}`);
      }
      outcome = `${r.at}: ${r.swaps.length} pair(s) out of order`;
      closing = [];
      break;
    }
    // 🔴 A PAIR IS MATCHED BY ITS TWO NAMES, AND ONLY IF THAT NAME IS UNAMBIGUOUS IN BOTH READINGS.
    // Matching by position in the sequence would be wrong in the one direction that matters: the set of
    // laid-out elements can differ between two sizes (a legal `@media (min-width: …)` may hide an
    // `[data-role="optional"]` block), the indices then shift, and two DIFFERENT pairs would be compared
    // and reported as closing — a false red. Names shift with them, so an unmatched pair is simply
    // dropped. What names cannot do is tell two same-named pairs apart (a page with two `divider` blocks
    // in a row), so those are dropped as well: this stage would rather miss than invent.
    const seen = (list) => list.reduce((m, g) => m.set(g.pair, (m.get(g.pair) ?? 0) + 1), new Map());
    const beforeCount = seen(previous.gaps);
    const nowCount = seen(r.gaps);
    const before = new Map(previous.gaps.map((g) => [g.pair, g.d]));
    const from = wide ? previous.w : previous.h;
    const to = wide ? r.w : r.h;
    const comparable = r.gaps.filter((g) => beforeCount.get(g.pair) === 1 && nowCount.get(g.pair) === 1);
    closing = comparable
      .filter((g) => g.d < before.get(g.pair) - GAP_NOISE_PX)
      .map((g) => ({ pair: g.pair, was: before.get(g.pair), fromSize: from, now: g.d, toSize: to }));
    const dropped = r.gaps.length - comparable.length;
    // 🔴 "none of them closed" IS THE READING, and it is not "all of them identical" — the first
    // version said identical and that was a claim nobody took. A gap that OPENED as the window grew
    // also stops this stage, and it read as though the page had not moved at all (#1011 r6: a sheet
    // whose hero height is a V left this line printing "identical" while every distance in it changed).
    outcome = closing.length
      ? `${closing.length} gap(s) still closing at ${r.at}`
      : `none of ${comparable.length} gap(s) closing from ${from}px to ${to}px of ${noun} (they stayed `
        + 'the same or opened)';
    if (dropped) outcome += ` (${dropped} gap(s) not comparable across the two sizes, so not judged)`;
    previous = r;
    if (closing.length === 0) break;
  }
  // Ran out of window before the gap ran out. Reported all the same: a page that ties the distance
  // between two neighbours to the window HAS a size at which they swap, and staying quiet about it
  // because this process will not open a window that big is the same silence QA2 measured twice.
  // #1046 条 18 — the second half of the claim, computed once for both axes.
  const canExplain = windowRelative.hits.length > 0 || windowRelative.unreadable > 0;
  for (const c of closing.slice(0, 3)) {
    const perPx = (c.was - c.now) / (c.toSize - c.fromSize);
    const crossAt = Math.round(c.toSize + c.now / perPx);
    if (!canExplain) {
      readings.push(`  paint order — the gap between ${c.pair} closed as the window ${verb} `
        + `(${c.was}px at ${c.fromSize}px of ${noun}, ${c.now}px at ${c.toSize}px, level at about `
        + `${crossAt}px), and this is a READING rather than a violation: no element below <body> on `
        + 'this page is given a length that is a share of the window, and every stylesheet was '
        + 'readable — so no rule on this page can be tying that distance to the window, and what moved '
        + 'it is content that lays out differently at the two sizes (text wrapping one line fewer, a '
        + 'grid dropping a column). Put a `vw`/`vh`/`clamp()`-style length on anything inside the page '
        + 'and the same closing is reported as a violation again'
        + `${closing.length > 3 ? ` (${closing.length - 3} more gap(s) like this one)` : ''}`);
      continue;
    }
    problems.push(`paint order: the gap between ${c.pair} closes as the window ${verb} — ${c.was}px at `
      + `${c.fromSize}px of ${noun}, ${c.now}px at ${c.toSize}px — so this page ties that distance to `
      + `the window's ${noun}, and past the last threshold it declares there is no size left for this `
      + `check to be told about. Those two readings put the pair level at about ${crossAt}px of ${noun} `
      + `and swapped past it. That is bigger than this check opens a window (${GROWN_WINDOW_CAP}px), so `
      + 'that number is arithmetic on two measurements rather than a reading taken there — the closing '
      + `itself is measured${closing.length > 3 ? ` (${closing.length - 3} more gap(s) like this one)`
        : ''}`);
  }
  return `${noun}: ${steps.length ? steps.map((r) => r.at).join(' · ') : 'nothing measured'} — ${outcome}`;
};
const grown = [await growWindow('width'), await growWindow('height')];
readings.push(`  paint order grown-window stage — ${grown.join(' | ')}. These sizes are the widest `
  + `(${WIDEST_MEASURED}px) and the tallest (${TALLEST_MEASURED}px) window above, doubled while the gaps `
  + `between neighbours keep moving, up to ${GROWN_WINDOW_CAP}px. A page whose gaps stop moving is not `
  + 'measured any bigger, because nothing in it is a share of the window');
// #1046 条 18 — the second half of that stage's claim, printed whether or not it fired, because it
// decides whether a closing gap is reported as a violation or as a reading.
readings.push('  paint order grown-window stage, window-relative lengths reaching something below '
  + `<body>: ${windowRelative.hits.length}`
  + `${windowRelative.hits.length ? ` (${windowRelative.hits.join(' · ')})` : ''}`
  + ` · ${windowRelative.onlyRoot.length} more that reach only <html>/<body>`
  + `${windowRelative.onlyRoot.length ? ` (${windowRelative.onlyRoot.join(' · ')})` : ''}`
  + ` · ${windowRelative.unreadable} stylesheet(s) could not be read from here`
  + `${windowRelative.unmatchable ? ` · ${windowRelative.unmatchable} selector(s) this browser would `
    + 'not run, counted as reaching something' : ''}`
  + (windowRelative.hits.length === 0 && windowRelative.unreadable === 0
    ? ' — so a gap measured closing is reported as a reading, not a violation: nothing below <body> '
      + 'is given a length that is a share of the window, so no rule on this page can be tying a '
      + 'distance between two blocks to it'
    : ' — so a gap measured closing is reported as a violation'));
// 🔴 The boundary of this reading, stated where the reading is — and it has to be the TRUE boundary.
// The sentence here used to read "a width between these is not covered", which is the one half that IS
// covered: §2 allows a single `(min-width: …)` and nothing else (no `max-width`, no `and` — the static
// checker refuses both), so every threshold at or below 1440 is active while 1440 is measured. What was
// not covered was everything ABOVE the widest width, and a sheet reaches it by writing
// `@media (min-width: 1441px)`. QA2 measured the consequence on an ordinary 1920×1080 desktop (#1011
// r2): footer painted at y=0, check green, and this line told the reader that width was covered.
readings.push(`  paint order viewports measured: `
  + [...ORDER_VIEWPORTS.map((v) => `${v.w}×${v.h}`),
    ...extraViewports.map((v) => `${v.w}×${v.h} (from @media ${v.cond})`)].join(' · ')
  + ` — the widths after the first ${ORDER_VIEWPORTS.length} are every (min-width: …) threshold above `
  + `${Math.max(...ORDER_VIEWPORTS.map((v) => v.w))}px that this page's own stylesheets declare, and each `
  + 'one was checked to really activate its condition before being measured');
// What is still not covered, named one kind at a time. None of these is hypothetical enough to leave out:
// the unreadable sheet is there on every run (the font CSS), and "the same rules, a different width"
// is the whole reason the three base widths exist.
readings.push('  paint order not covered: '
  + [`${breakpoints.unreadable} stylesheet(s) this script may not read (cross-origin), so any `
      + '@media in them is invisible to the list above',
  `${breakpoints.notAWidth.length} media condition(s) that are not a (min-width: …) — print, `
      + 'hover, colour scheme; a theme sheet may not write those (§2) but the app may',
  ...(breakpoints.unresolved.length
    ? [`${breakpoints.unresolved.length} (min-width: …) whose length the browser would not resolve: `
        + breakpoints.unresolved.join(', ')] : []),
  ...(droppedViewports.length
    ? [`${droppedViewports.length} threshold(s) past the ${EXTRA_VIEWPORT_CAP}-viewport cap, not `
        + `measured: ${droppedViewports.map((b) => `${b.w}px`).join(', ')}`] : []),
  'and any width BETWEEN two measured ones where the same rules lay the page out differently for a '
      + 'reason OTHER THAN A LENGTH — text that wraps one line further, a grid that drops a column — '
      + 'since such a width is announced by nothing and it moves the gaps in both directions, which is '
      + 'not what the grown-window stage looks for. A length cannot hide there any more: on a block or '
      + 'a region the contract (§2) admits only lengths that move one way as the window grows — one '
      + 'window-relative unit, no window-relative divisor, no min()/max()/clamp()-style function — AND '
      + 'it lets none of them size a box (no window-relative width, height, min-*, max-*, grid track or '
      + 'flex-basis), which is what stops the browser from bending two of those straight lines into a V '
      + 'with its own min and max. Both halves together are why a distance that has started closing '
      + 'goes on closing and the doubling above has to run into it. On top of that §2 admits no '
      + 'NEGATIVE margin on a block or a region at all, so a later sibling\'s top is the earlier '
      + 'one\'s top plus a used height plus non-negative margins — it cannot come out above it at any '
      + 'width, measured or not. Those rules are checked by scripts/theme-css-lint.js, not here',
  'and a block that is here one moment and gone the next cannot smuggle its parts out either: an '
      + 'element with no box is skipped above BY NAME, and the case that made that worth saying is '
      + '`[data-block="hero"] { display: contents }` — the block loses its box while its parts keep '
      + 'theirs, so the parts become siblings of the other blocks and a peak written on a part (which '
      + '§2 allows there on purpose) moves whole blocks past one another while this check skips the '
      + 'block it belongs to. Measured before it was refused: swapped at 1900px and 1901px with every '
      + 'width here in the DOM order. §2 now lets a block hook take only a `display` that keeps a box; '
      + 'a REGION may still be `display: contents`, and then this check simply stops seeing that '
      + 'region — which is why it prints the ones it skipped. Checked by scripts/theme-css-lint.js',
  'and neither can a HEIGHT, which is the half of that a part could still reach: §2 leaves the parts '
      + 'inside a block free on purpose (which part comes first is the theme\'s business) and a part\'s '
      + 'own height is part of the block\'s, so a part can put a peak into a block from the inside. It '
      + 'moves the whole page down and back up again; it cannot move one block PAST another, because a '
      + 'used height is never negative and §2 no longer lets a margin on a block or a region be '
      + 'negative either. Measured: .hero__deco { margin-top: calc(-800px * (1 - sign(abs(100vw - '
      + '2000px) - 200px)) / 2) } reorders this page from about 1800px to 2200px of window — and only '
      + 'while an overflow that is NOT a formatting context sits on the block to let that margin '
      + 'collapse into it, which is why §2 lets a hook write only `hidden` / `auto` / `scroll` there. '
      + 'That is an allowed set rather than a list of bad words on purpose: `visible`, `clip` and the '
      + 'four CSS-wide keywords are six spellings of the same hole, and r9 refused one of them',
  '🔴 and FOUR things this argument stands on that are APP-side, so nothing here rechecks them '
      + '(#1011 r10 walked §2\'s whole property list to find them — the table is in the contract, '
      + 'section 2a): globals.css keeping `overflow: hidden` on every block whose parts §2 has '
      + 'exempted — `.hero, .hero__media` and, since #1018, `.cta-banner`, one more with each block '
      + 'phase 2 moves (a block that is its own formatting context does not collapse with its '
      + 'children; measured on both, and on cta-banner it only bites once a sheet takes the block '
      + 'back to `display: block` + `padding: 0`, since base.css lays it out as a grid) · no '
      + 'app-side custom property '
      + 'ever being written as a clamp() (a peak would arrive through var(), and '
      + 'scripts/theme-css-lint.js treats var() as a constant) · the page\'s own layout classes on '
      + '<body> (`.flex .flex-col`) outweighing a theme\'s `body { … }`, which is the ONLY thing '
      + 'keeping `flex-direction: column-reverse` and `display: grid` off the one container a theme '
      + 'can name — specificity, not a rule · and <main> staying a plain block box, since a flex or '
      + 'grid <main> would make `order` and grid placement on BLOCKS live the same day (measured: a '
      + 'block\'s computed `order` really is -1 today and nothing moves). The last two are refused by '
      + 'nothing in the contract; this check would still see them, at the widths it measures'].join(' · '));
if (orderViewport) await page.setViewportSize({ width: orderViewport.width, height: orderViewport.height });

// ── ⑤b the same question, asked of the site's other pages ───────────────────────────────────────
// #1023. Everything above is a reading about ONE page, and check ⑤ is the one where that is a hole
// rather than a choice: "the theme's own sheet has a rule for every hook in the markup" is a statement
// about the SITE, and the hooks a home page happens to carry are a small part of it. Measured on this
// sample site: the home page holds hero and cta-banner, 11 hooks — while `.page-header` is on about,
// services, quote and contact, so all three sheets could lose every page-header rule with the check
// still exiting 0 (QA2 did exactly that on #1019 and the run stayed green). Phase 2 has 30 more blocks
// to move (#1007) and a home page is not where most of them live.
//
// 🔴 WHICH CHECKS ARE MEASURED HERE IS DELIBERATE, AND IT IS PRINTED BELOW rather than left for a
// reader to work out. Three are: ⑤ (this loop's reason for existing), ② (#1043 — `contact-info` is a
// contact-page block, so first-page-only meant never) and, since #1046 条 9, the part of ① that is
// about the blocks phase 2 has moved: `.page-header__title` is a sub-page heading and is on no home
// page at all. The rest stay first-page-only — they are about the hero (its contrast pair, the lead
// block on the first screen, its touch targets) or they repeat per page at a cost the readings above
// show is the expensive part: the grown-window stage alone takes a dozen relayouts. #1023's own words
// are "别让它变慢到没人跑". Widening those is a separate decision with its own price tag.
//
// 🔴 WHICH PAGES: the site's own /sitemap.xml, not a list written here and not a crawl of the nav. The
// sitemap is generated from the same `pagesByLocale` the pages themselves are (src/app/sitemap.ts), so
// it cannot fall behind the site the way a hand-written list falls behind the markup — which is the
// #1018 lesson one file over, where a copied hook list stayed on phase 1's seven names.
const OTHER_PAGE_CAP = 24;
const explicitPages = process.argv.slice(3);
let discovery = '';
let otherPaths = [];
if (explicitPages.length > 0) {
  discovery = `${explicitPages.length} page(s) named on the command line`;
  otherPaths = explicitPages.map(pathOf);
} else {
  const sitemapUrl = new URL('/sitemap.xml', baseUrl).href;
  let xml = null;
  let why = '';
  try {
    const r = await fetch(sitemapUrl);
    if (r.ok) xml = await r.text();
    else why = `${sitemapUrl} answered ${r.status}`;
  } catch (e) {
    why = `${sitemapUrl} could not be fetched (${e.message})`;
  }
  if (xml === null) {
    // 🔴 Not being able to read the page list is not a pass: it puts the check straight back to
    // home-page-only, which is the state #1023 exists to leave, and it does it silently.
    problems.push(`other pages: this site's page list could not be read — ${why} — so only `
      + `${pathOf(baseUrl)} was measured for check ⑤, and every block that is not on it went unlooked `
      + 'at. That is the hole #1023 closed, not a pass');
    discovery = 'nothing — the sitemap could not be read';
  } else {
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
      // The five XML entities, `&amp;` last so a `&amp;lt;` in a slug does not become `<`.
      .map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    otherPaths = [...new Set(locs.map(pathOf))];
    discovery = `${otherPaths.length} page(s) in /sitemap.xml`;
  }
}
const homePath = pathOf(baseUrl);
otherPaths = otherPaths.filter((p) => p !== homePath && `${p}.html` !== homePath);
// 🔴 The cap is announced rather than applied quietly, same rule as the viewport cap above: a page
// dropped in silence reads exactly like a page that was measured.
const droppedPages = otherPaths.slice(OTHER_PAGE_CAP);
// 🔴 A STATIC EXPORT IS SERVED TWO DIFFERENT WAYS AND ONLY ONE OF THEM ANSWERS `/about`. `next build`
// with `output: 'export'` writes `out/about.html`, and it ALSO writes an `out/about/` directory of RSC
// payloads — so the plain python server the CI caller runs answers `/about` with a 301 to `/about/` and
// then a 200 DIRECTORY LISTING. A listing has no stylesheet and no hook, so a check that accepted it
// would report `hooks in the markup: 0 · not dressed by the theme: 0` and pass, on a page it never saw.
// Measured on this build before this loop was written: `/about` → 301, `/about/` → 200, listing.
// So `<path>.html` is tried first (the file the export actually wrote), the clean path second (a real
// host — the Cloudflare Worker that serves these sites — has no `.html` to offer), and 200 is not the
// test: the document has to have a `<main>`, which every page of this app has and no listing does.
const openPage = async (p) => {
  const clean = p.replace(/\/+$/, '');
  const candidates = (p === '/' || p.endsWith('.html') || clean === '') ? [p] : [`${clean}.html`, p];
  const tried = [];
  for (const c of candidates) {
    const r = await page.goto(new URL(c, baseUrl).href, { waitUntil: 'load', timeout: 30_000 })
      .catch((e) => ({ err: e.message }));
    if (!r || r.err) { tried.push(`${c} → ${r ? r.err : 'no response'}`); continue; }
    if (!r.ok()) { tried.push(`${c} → HTTP ${r.status()}`); continue; }
    if (!await page.evaluate(() => !!document.querySelector('main'))) {
      tried.push(`${c} → HTTP ${r.status()} but the document has no <main> in it, so it is not a page `
        + 'of this site (a directory listing answers like this)');
      continue;
    }
    return { at: c };
  }
  return { error: tried.join('; ') };
};
for (const p of otherPaths.slice(0, OTHER_PAGE_CAP)) {
  const opened = await openPage(p);
  if (opened.error) {
    // 🔴 #1046 条 16 — IT NAMES BOTH CHECKS. This used to say "so check ⑤ was not measured on it",
    // which was true when it was written and stopped being true when #1043 added check ② to this
    // loop. A page that will not open is unmeasured for both, and the half that goes unsaid is the
    // one nobody goes looking for.
    problems.push(`other pages: "${p}" is in this site's page list but could not be opened, so `
      + `neither check ⑤ (every hook has a rule) nor check ② (essential content is not hidden) was `
      + `measured on it — tried ${opened.error}`);
    continue;
  }
  audits.push({ where: opened.at, audit: await page.evaluate(classAuditInBrowser, [HOOK_CLASSES, THEME_SHEET_PATH]) });
  // 🔴 #1043 ②c — ESSENTIAL VISIBILITY IS ASKED OF THIS PAGE TOO, and that is the half of #1043 that
  // decides whether the fix reaches the case that prompted it. `contact-info` is a CONTACT-PAGE block:
  // this sample site puts it on none of its home page and the six real site configs put it on none of
  // theirs either. Check ② measured the first page alone, so a sheet hiding `.contact-info__phone`
  // would still have gone green with the parts probe added — right answer, wrong page. The old
  // behaviour was not even written down: the readings line said contrast, first screen, touch targets,
  // sideways scroll, type size and paint order were first-page-only and did not mention this one.
  // Both installers, in this order: a navigation left this document with neither, and
  // `__essentialParts` calls `__effective`.
  await page.evaluate(INSTALL_EFFECTIVE);
  await page.evaluate(`window.__essentialParts = ${ESSENTIAL_PARTS_PROBE.toString()}`);
  const otherReading = await page.evaluate(ESSENTIAL_PROBE);
  problems.push(...judgeEssential(otherReading, ` on ${opened.at}`));
  // 🔴 #1049 — ②d/②e ON EVERY PAGE TOO, AND THAT IS A DELIBERATE 5.6s (PM's call on this ticket).
  // The block these two dimensions exist for is `contact-info`, which lives on /contact and /quote and
  // on no home page in this repo — measuring the first page alone would be blind on exactly the block
  // that prompted the ticket. The corpus is its own argument: /quote 23 runs, /contact 9, home 13.
  await page.evaluate(`window.__essentialText = ${ESSENTIAL_TEXT_PROBE.toString()}`);
  await settlePage();
  const otherText = await page.evaluate(() => window.__essentialText());
  problems.push(...judgeEssentialText(otherText, ` on ${opened.at}`));
  problems.push(...await judgeEssentialPaint(otherText, ` on ${opened.at}`));
  readings.push(textReading(otherText, opened.at));
  // 🔴 #1046 条 9 — AND THE MOVED BLOCKS' WORDS, HERE, because here is where they are.
  // `.page-header__title` is the heading of every sub-page and is on no home page, so measuring it
  // only on the first page would have been measuring it never. Costs two screenshots per hook that
  // is actually present; a page with none of them costs four `count()` calls.
  for (const sel of MOVED_TEXT_TARGETS) await measureText(sel, opened.at, false);
  // Say what this page actually offered up. "Measured on 4 pages" with no counts cannot tell
  // "checked and clean" from "there was nothing on any of them to check".
  readings.push(`  ${opened.at} — essential elements: ${otherReading.roots.length}`
    + ` · parts with content inside them: ${otherReading.parts.length}`);
  essentialPagesMeasured.push(opened.at);
}

// ── the report for ⑤ and ⑤b together ────────────────────────────────────────────────────────────
readings.push(`  pages measured for check ⑤: ${audits.map((a) => a.where).join(', ')} — the first is the `
  + `page every other check above was measured on, the rest come from ${discovery}`
  + `${droppedPages.length ? ` · 🔴 ${droppedPages.length} page(s) past the ${OTHER_PAGE_CAP}-page cap `
    + `were NOT measured: ${droppedPages.join(', ')}` : ''}`
  + '. On the pages after the first, check ⑤ is measured (which classes have a rule anywhere, and '
  + 'whether the theme\'s own sheet dresses each hook in the markup), check ② (essential content is '
  + 'not hidden, roots and the parts inside them) AND the moved-block half of check ① (the contrast of '
  + `${MOVED_TEXT_TARGETS.join(', ')}, wherever they are present). The hero's own contrast pair, the `
  + 'first screen, touch targets, sideways scroll, type size and paint order are measured on the first '
  + 'page alone');
// 🔴 #1043 — check ② states its own reach. It used to be first-page-only and say nothing about that,
// while the block it most needs to protect (`contact-info`) is on no home page in this repo.
// 🔴 #1046 条 9 — check ① says how far it reached, per hook. The two hero hooks are required and
// their readings are printed above; these four are measured wherever they turn up, and a hook that
// turned up nowhere has to SAY so — otherwise "no finding for `.page-header__title`" reads like a
// pass on a hook nothing looked at, which is the hole this item was opened for.
readings.push('  pages measured for check ① on the blocks phase 2 has moved: '
  + MOVED_TEXT_TARGETS.map((sel) => `${sel} → ${(movedTextMeasured.get(sel) || []).join(', ')
    || '🔴 on no page measured'}`).join(' · ')
  + `. The two hero hooks (${TEXT_TARGETS.join(', ')}) are required on `
  + `${pathOf(baseUrl)} and are reported above`);
// 🔴 #1046 条 16 — and it states the cap the same way check ⑤'s line does. Check ② is measured in the
// same loop, so the pages past the cap are missing from BOTH readings; only one of the two said so.
// 🔴 The cap clause goes LAST, after ②d/②e's own blindness note. Put it right after the page list and
// "on each of them" lands next to the pages that were NOT measured, which reads as the opposite of what
// it says — this one line now has to carry two different reaches (#1046 条 16 and #1049's ②d/②e), and
// the order is the only thing keeping them apart.
readings.push(`  pages measured for check ② (essential content not hidden): `
  + `${essentialPagesMeasured.join(', ')} — roots AND the parts with content inside them, and on each of `
  + 'them ②d (where every run of text ended up, and what survives the clipping ancestors and the edge of '
  + `the scrollable document — ${MIN_BODY_PX}px of visible height on at least one line) and ②e (how many `
  + 'pixels of that run were painted, photographed with and without its own words). 🔴 What ②d/②e do NOT '
  + 'answer: text a visitor has to interact with to reveal — the exemption skips anything the markup '
  + 'declares off (aria-hidden="true", the hidden attribute, an aria-expanded="false" control naming it, '
  + 'the closed panel of a <details>), '
  + 'and a theme cannot write an attribute, so what it skips is the app\'s statement, not the theme\'s'
  + `${droppedPages.length ? ` · 🔴 ${droppedPages.length} page(s) past the ${OTHER_PAGE_CAP}-page `
    + `cap were NOT measured for this check either — not for ②, and not for ②d/②e: `
    + `${droppedPages.join(', ')}` : ''}`);
for (const { where, audit } of audits) {
  readings.push(`  ${where} — classes on the page: ${audit.used} · with no rule: ${audit.orphans.length}`
    + ` (${audit.sheets} stylesheets, ${audit.unreadableSheets} not readable from here)`
    // The second reading (#996): the same question asked of the theme's own sheet.
    + ` · theme sheet(s): ${audit.themeSheets.join(', ') || `(${THEME_SHEET_PATH} is not loaded)`}`
    + ` · hooks in the markup: ${audit.hooksOnPage.length}`
    + ` · not dressed by the theme: ${audit.hooksMissingFromTheme.length}`);
  for (const orphan of audit.orphans) {
    problems.push(`unstyled class: "${orphan}" is in the markup of ${where} and no loaded stylesheet has `
      + 'a rule for it — the element is showing with whatever the browser defaults to');
  }
  if (audit.hooksOnPage.length > 0 && audit.themeSheets.length === 0) {
    // 🔴 Nothing to look at is not a pass — same rule as the missing [data-role="essential"] above.
    // This is the shape phase 2 makes reachable: the markup moves to a block before some theme has a
    // sheet for it, and every hook then falls back to base.css.
    problems.push(`theme coverage: ${where} uses ${audit.hooksOnPage.length} contract hook(s) `
      + `but ${THEME_SHEET_PATH} is not loaded at all — nothing was measured for this check`);
  }
}
// One finding per hook, naming every page it was found unstyled on. Reported this way round because the
// fix is one rule in one sheet whichever page it was spotted from, and four copies of the same sentence
// is how a real red gets skimmed past.
const missingByHook = new Map();
for (const { where, audit } of audits) {
  if (audit.themeSheets.length === 0) continue; // already reported above; there is no sheet to blame
  for (const hook of audit.hooksMissingFromTheme) {
    if (!missingByHook.has(hook)) missingByHook.set(hook, { pages: [], sheets: audit.themeSheets });
    missingByHook.get(hook).pages.push(where);
  }
}
// 🔴 What is STILL not measured, said at the reading rather than left for someone to notice: a hook no
// page of this site puts in its markup. `.page-header__crumbs` is one today — the demo pages carry no
// breadcrumb trail — so a sheet could forget it and every page here would still be green. This check can
// only ever be as wide as the sample site is, and that is the sample site's job to fix, not this file's.
const seenHooks = new Set(audits.flatMap((a) => a.audit.hooksOnPage));
const unusedHooks = HOOK_CLASSES.filter((h) => !seenHooks.has(h));
readings.push(`  contract hooks not on any page measured: ${unusedHooks.length}`
  + `${unusedHooks.length ? ` (${unusedHooks.map((h) => `.${h}`).join(', ')}) — no page of this site puts `
    + 'them in its markup, so whether the theme dresses them is not a question these readings answer'
    : ' — every class hook in the contract was on at least one page'}`);
for (const [hook, { pages, sheets }] of missingByHook) {
  problems.push(`theme coverage: ".${hook}" is in the markup of ${pages.join(', ')} and the theme's own `
    + `stylesheet (${sheets.join(', ')}) has no rule for it — whatever it looks like comes from base.css `
    + 'or the site\'s own CSS, which is the same block on every theme');
}

await browser.close();

console.log(`readings for ${baseUrl}:`);
for (const r of readings) console.log(r);
if (problems.length === 0) {
  console.log('✅ every invariant holds');
  process.exit(0);
}
console.log(`🔴 ${problems.length} invariant violation(s)`);
for (const p of problems) console.log(`   ${p}`);
process.exit(1);
