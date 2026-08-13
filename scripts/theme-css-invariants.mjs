// theme-css-invariants.mjs — the four things that must still be true after a theme is applied (#991).
//
//   node scripts/theme-css-invariants.mjs http://127.0.0.1:8991
//
// Exit 0 = all four hold. Exit 1 = at least one does not. Exit 2 = could not take the reading.
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
// the sheets it was written for. So: screenshot the element's own box, and take the colours that
// cover most of it. Text is a minority of the pixels in any text box.
//
// 🔴 IT CHECKS THE WORST OF THE DOMINANT COLOURS, NOT JUST THE COMMONEST. A gradient behind a
// heading is legal and normal; the question is never "is the average readable" but "is the WORST end
// readable". Taking only the modal colour would pass a gradient that runs into the text colour at
// one end — which is #966's failure with an extra step.
import { PLAYWRIGHT_MODULE } from './theme-gallery/paths.mjs';

const { chromium } = await import(PLAYWRIGHT_MODULE);
// jimp 0.22 is CommonJS with a default export (`Jimp.read`). Named-importing `{ Jimp }` gets
// undefined here and the failure surfaces a hundred lines later as "cannot read read of undefined".
const Jimp = (await import('jimp')).default;

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('usage: node scripts/theme-css-invariants.mjs <baseUrl>   e.g. http://127.0.0.1:8991');
  process.exit(2);
}

const MIN_CONTRAST = 4.5;
const MIN_BODY_PX = 14;
// The text elements this checks, and why these: the headline and the sub are the hero's own words,
// and `body` is the page's baseline — a sheet is allowed to touch all three (`.hero__title`,
// `.hero__sub`, `body` are contract hooks), so all three can be broken by one.
const TEXT_TARGETS = ['.hero__title', '.hero__sub'];

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
function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return parts.slice(0, 3);
}

/* global document, getComputedStyle, window */
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

// ── ① contrast ──────────────────────────────────────────────────────────────────────────────────
for (const sel of TEXT_TARGETS) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) {
    // 🔴 A missing target is NOT a pass. This checker's whole job is to fail loudly, and "the
    // element I was going to measure is not there" is the shape a vacuous green takes.
    problems.push(`contrast: "${sel}" is not on the page — nothing was measured for it`);
    continue;
  }
  const color = parseRgb(await el.evaluate((n) => getComputedStyle(n).color));
  const box = await el.boundingBox();
  if (!color || !box || box.width < 2 || box.height < 2) {
    problems.push(`contrast: "${sel}" has no measurable colour or box`);
    continue;
  }
  const shot = await el.screenshot({ type: 'png' });
  const img = await Jimp.read(shot);
  const counts = new Map();
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scanPixel(x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    // Quantise to 8 levels per channel: antialiasing turns one background into hundreds of
    // near-identical colours, and counting them separately would leave the real background looking
    // rare. 32 is coarse enough to merge those and fine enough not to merge a colour with the text.
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const prev = counts.get(key);
    if (prev) { prev.n++; } else { counts.set(key, { n: 1, rgb: [r, g, b] }); }
  });
  const total = img.bitmap.width * img.bitmap.height;
  const dominant = [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .filter((c, i) => i === 0 || c.n / total >= 0.05); // the mode, plus anything covering ≥5%
  let worst = Infinity;
  let worstRgb = null;
  let best = 0;
  for (const cand of dominant) {
    const ratio = contrast(color, cand.rgb);
    if (ratio > best) best = ratio;
    // The text's own pixels are in this box too. A candidate that IS the text colour would measure
    // "how readable is this text against itself" — 1.0, on a page that may be perfectly fine.
    if (ratio < 1.5) continue;
    if (ratio < worst) { worst = ratio; worstRgb = cand.rgb; }
  }
  if (worstRgb === null) {
    // 🔴 THIS IS THE #966 SHAPE, AND IT IS A FAILURE, NOT A MEASUREMENT PROBLEM. Every colour that
    // covers a meaningful share of this text's box is within 1.5:1 of the text — which is what
    // "white on white" looks like from here. Said as the finding rather than as an apology, because
    // the first version of this message read like the instrument had given up, and a reader who
    // believes that goes looking for a bug in the checker instead of at the page.
    problems.push(`contrast: "${sel}" is text the same colour as everything around it `
      + `(best ${best.toFixed(2)}:1 among the colours filling its box) — below ${MIN_CONTRAST}:1`);
    continue;
  }
  readings.push(`  ${sel}: text rgb(${color}) on rgb(${worstRgb}) = ${worst.toFixed(2)}:1`);
  if (worst < MIN_CONTRAST) {
    problems.push(`contrast: "${sel}" is ${worst.toFixed(2)}:1 against rgb(${worstRgb}) — below ${MIN_CONTRAST}:1`);
  }
}

// ── ② essential content is not hidden ───────────────────────────────────────────────────────────
const essentials = await page.$$eval('[data-role="essential"]', (nodes) => nodes.map((n) => ({
  display: getComputedStyle(n).display,
  visibility: getComputedStyle(n).visibility,
  where: n.className || n.tagName,
})));
if (essentials.length === 0) {
  problems.push('visibility: the page has no [data-role="essential"] at all — this check had '
    + 'nothing to look at, which is not the same as passing');
}
readings.push(`  essential elements: ${essentials.length}`);
for (const e of essentials) {
  if (e.display === 'none' || e.visibility === 'hidden') {
    problems.push(`visibility: [data-role="essential"] "${e.where}" computed display=${e.display} `
      + `visibility=${e.visibility}`);
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

await browser.close();

console.log(`readings for ${baseUrl}:`);
for (const r of readings) console.log(r);
if (problems.length === 0) {
  console.log('✅ all four invariants hold');
  process.exit(0);
}
console.log(`🔴 ${problems.length} invariant violation(s)`);
for (const p of problems) console.log(`   ${p}`);
process.exit(1);
