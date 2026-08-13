// theme-css-invariants.mjs — the five things that must still be true after a theme is applied
// (#991; the fifth and the tightening of the first two are #992).
//
//   node scripts/theme-css-invariants.mjs http://127.0.0.1:8991
//
// Exit 0 = all five hold. Exit 1 = at least one does not. Exit 2 = could not take the reading.
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

// 🔴 EVERY QUESTION BELOW IS ASKED OF THE WHOLE ANCESTOR CHAIN, NEVER OF ONE ELEMENT'S OWN
// PROPERTY (#992). `opacity` is inherited by effect, not by value: `.hero__body { opacity: 0 }` —
// one declaration, every token of it on the contract's whitelist — leaves `.hero__title` computing
// `display: block`, `visibility: visible`, `opacity: 1`, its own colour unchanged and its box the
// right size, while the browser paints nothing at all. Measured on the shipped checker: all four
// invariants "held" on a hero with 0 text pixels out of 69215. That is #966 again, from inside the
// whitelist, so what these checks read has to be the effect on the screen.
await page.evaluate(() => {
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
});

// Photograph `el` with its own words made transparent and nothing else about the page touched —
// whatever `opacity`, `filter` or gradient is acting on this box goes on acting on it, so the
// second picture is exactly "this box, minus the letters".
async function withoutWords(el, shoot) {
  await el.evaluate((n) => n.setAttribute('data-inv-probe', ''));
  const style = await page.addStyleTag({
    content: '[data-inv-probe], [data-inv-probe] * { color: transparent !important;'
      + ' -webkit-text-fill-color: transparent !important }',
  });
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
for (const sel of TEXT_TARGETS) {
  const el = page.locator(sel).first();
  if ((await el.count()) === 0) {
    // 🔴 A missing target is NOT a pass. This checker's whole job is to fail loudly, and "the
    // element I was going to measure is not there" is the shape a vacuous green takes.
    problems.push(`contrast: "${sel}" is not on the page — nothing was measured for it`);
    continue;
  }
  const colorRaw = await el.evaluate((n) => getComputedStyle(n).color);
  const color = parseRgb(colorRaw);
  const box = await el.boundingBox();
  if (!color || !box || box.width < 2 || box.height < 2) {
    problems.push(`contrast: "${sel}" has no measurable colour or box`);
    continue;
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
    problems.push(`visibility: "${sel}" is not painted at all — ${eff.zeroedBy || `effective opacity ${painted}`}`
      + ` (text pixels ${declaredPx}/${total}, cumulative opacity ${eff.opacity}, colour ${colorRaw})`);
    continue;
  }
  // The same box again with only this element's words made transparent. `-webkit-text-fill-color`
  // is set alongside `color` because it wins over `color` where both apply, and the descendant
  // selector is there because a child with its own `color` does not inherit ours.
  const bare = await withoutWords(el, () => el.screenshot({ type: 'png' })).then((b) => Jimp.read(b));
  if (bare.bitmap.width !== img.bitmap.width || bare.bitmap.height !== img.bitmap.height) {
    // Fail loud: the two pictures have to be of the same box or the comparison below is nonsense,
    // and "I could not compare them" is not a pass.
    problems.push(`visibility: "${sel}" changed size between the two pictures `
      + `(${img.bitmap.width}x${img.bitmap.height} vs ${bare.bitmap.width}x${bare.bitmap.height}) — not measured`);
    continue;
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
    problems.push(`visibility: "${sel}" paints nothing that can be told apart from what is behind `
      + `it — taking its words away changes 0 of ${total} pixels in its box `
      + `(declared colour ${colorRaw}, background rgb(${backgrounds[0].rgb}))`);
    continue;
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
  readings.push(`  ${sel}: text painted rgb(${textRgb}) (declared ${colorRaw}) on rgb(${worstRgb}) `
    + `= ${worst.toFixed(2)}:1 · text pixels ${words.n}/${total}`);
  if (worst < MIN_CONTRAST) {
    problems.push(`contrast: "${sel}" is ${worst.toFixed(2)}:1 against rgb(${worstRgb}) — below ${MIN_CONTRAST}:1`
      + ` (measured on the colour it came out, rgb(${textRgb}); declared ${colorRaw})`);
  }
}

// ── ② essential content is not hidden ───────────────────────────────────────────────────────────
// 🔴 READ OFF THE CHAIN, NOT OFF THE ELEMENT. The old version asked each essential element for its
// own `display` / `visibility`, which is exactly the reading that stayed green while the hero's
// words were invisible: `opacity` never appeared in it, and an ancestor's `display: none` is not
// this element's `display` either (it computes to whatever the sheet says — the browser simply
// never lays the subtree out).
const essentials = await page.$$eval('[data-role="essential"]', (nodes) => nodes.map((n) => {
  const eff = window.__effective(n);
  return {
    display: getComputedStyle(n).display,
    visibility: getComputedStyle(n).visibility,
    opacity: eff.opacity,
    hiddenBy: eff.hiddenBy,
    zeroedBy: eff.zeroedBy,
    where: n.getAttribute('class') || n.tagName,
  };
}));
if (essentials.length === 0) {
  problems.push('visibility: the page has no [data-role="essential"] at all — this check had '
    + 'nothing to look at, which is not the same as passing');
}
readings.push(`  essential elements: ${essentials.length}`
  + essentials.map((e) => ` · "${e.where}" opacity ${e.opacity}`).join(''));
for (const e of essentials) {
  if (e.hiddenBy) {
    problems.push(`visibility: [data-role="essential"] "${e.where}" is hidden by ${e.hiddenBy}`);
  } else if (e.opacity === 0) {
    problems.push(`visibility: [data-role="essential"] "${e.where}" is invisible — ${e.zeroedBy} `
      + '(its own computed display and visibility say nothing about this)');
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
const classAudit = await page.evaluate(() => {
  const declared = new Set();
  let unreadableSheets = 0;
  const collect = (rules) => {
    for (const r of rules) {
      if (r.selectorText) {
        for (const m of r.selectorText.matchAll(/\.((?:\\.|[-\w -￿])+)/g)) {
          declared.add(m[1].replace(/\\(.)/g, '$1'));
        }
      }
      if (r.cssRules) collect(r.cssRules); // @media, @supports, @layer …
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { unreadableSheets++; continue; } // cross-origin (fonts)
    collect(rules);
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
  };
});
readings.push(`  classes on the page: ${classAudit.used} · with no rule: ${classAudit.orphans.length}`
  + ` (${classAudit.sheets} stylesheets, ${classAudit.unreadableSheets} not readable from here)`);
for (const orphan of classAudit.orphans) {
  problems.push(`unstyled class: "${orphan}" is in the markup and no loaded stylesheet has a rule `
    + 'for it — the element is showing with whatever the browser defaults to');
}

await browser.close();

console.log(`readings for ${baseUrl}:`);
for (const r of readings) console.log(r);
if (problems.length === 0) {
  console.log('✅ all five invariants hold');
  process.exit(0);
}
console.log(`🔴 ${problems.length} invariant violation(s)`);
for (const p of problems) console.log(`   ${p}`);
process.exit(1);
