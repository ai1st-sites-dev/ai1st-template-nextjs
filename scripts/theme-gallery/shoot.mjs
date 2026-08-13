// #932 — take a full-page screenshot of an already-built site with a real browser.
// #963 — paths parameterised (see paths.mjs); behaviour unchanged.
// #981 条6/条7 — also reads the header/footer Region back off the page, and can shoot a header close-up.
//   This is where tests/e2e/region-shots.mjs was folded in; that file is gone. Its captions came out of the
//   theme registry (`themes[id].layout.header`), which is a claim, not a reading: resolveRegionLayout can
//   hand back something else entirely — it falls back to the default when the variant is unknown, and it
//   adds a scrim on its own when the first block on a page is not provably a dark hero. So the caption could
//   say "transparent-overlay, no scrim" about a page that rendered a scrim. Here it comes off the DOM.
//
// Usage: node shoot.mjs <baseUrl> <outDir> <themeId> [--header-closeup]
//   --header-closeup: also write <id>-header.png, a 1440×260 crop of the top of the page. The full-page
//   shots are 5-6k pixels tall, and the one thing that gets judged up there — is the language switcher
//   readable against the hero — is a 12px word in them. That is why #960 r2's defect (the switcher was the
//   one child the overlay never re-coloured) was invisible to a human paging through the full-page shots.
import { PLAYWRIGHT_MODULE } from './paths.mjs';

const { chromium } = await import(PLAYWRIGHT_MODULE);

const [baseUrl, outDir, id, ...flags] = process.argv.slice(2);
const HEADER_CLOSEUP = flags.includes('--header-closeup');
// 🔴 A static export writes about.html, not about/index.html — requesting /about returns the
//    404 page, and the 404 page screenshots just fine. The first version of this script shipped
//    a picture of a 404 that way.
const PAGES = [['', ''], ['about.html', '-about']];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Which header/footer this theme actually rendered, read off the DOM of the page being shot.
//
// 🔴 It has to be the HOME page, and that is not a detail. `transparent-overlay` only floats when the page's
// first block is a hero (Header.tsx: `floating = variant === 'transparent-overlay' && overHero`), and when it
// does not float that branch is never taken — an about page whose first block is a page-header renders the
// plain bar and stamps `data-region-layout="solid-bar"`. So reading this after the loop (which ends on
// about.html) reports `solid-bar` for every overlay theme. Measured, not reasoned: see the run in #981.
/* global document */
const readRegions = () => page.evaluate(() => {
  const h = document.querySelector('header[data-region-layout]');
  const f = document.querySelector('footer[data-region-layout]');
  return {
    header: h ? h.getAttribute('data-region-layout') : '(no header)',
    footer: f ? f.getAttribute('data-region-layout') : '(no footer)',
    // 'on'/'off' comes from the build-time contrast rule; '(n/a)' means this structure has no scrim to speak of.
    headerScrim: h ? (h.getAttribute('data-region-scrim') || '(n/a)') : '(no header)',
    // The language switcher only exists on a multi-locale site, so on the 30 single-locale shots this is 0.
    // It is here because it is the one thing in the header that a human cannot check from a full-page shot.
    langSwitchers: document.querySelectorAll('[data-region-ondark]').length,
  };
});

let rc = 0;
let regions = null;
for (const [slug, suffix] of PAGES) {
  const url = `${baseUrl}/${slug}`;
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (!resp || resp.status() !== 200) { console.log(`🔴 ${id}${suffix} HTTP ${resp && resp.status()}`); rc = 1; continue; }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${id}${suffix}.png`, fullPage: true });
  if (slug === '') {
    regions = await readRegions();
    // The close-up is of the home page only — that is where a hero sits under the header.
    if (HEADER_CLOSEUP) {
      await page.screenshot({ path: `${outDir}/${id}-header.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
    }
  }
}

// Read back what this theme actually put on the page, so the gallery has a checkable reading
// next to each picture rather than only the picture.
//
// The callback below is serialised and runs INSIDE the browser, so its globals are the page's.
// The directive tells eslint that — it does not make them available to the Node code in this
// file, and a `document` used outside a page.evaluate callback would still be a real bug.
/* global document, getComputedStyle */
const facts = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  return {
    primary500: cs.getPropertyValue('--color-primary-500').trim(),
    primary900: cs.getPropertyValue('--color-primary-900').trim(),
    accent500: cs.getPropertyValue('--color-accent-500').trim(),
    fontSans: cs.getPropertyValue('--font-sans').trim(),
    bodyFontFamily: body.fontFamily,
    googleFontsHref: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).filter(h => h.includes('fonts.googleapis.com'))[0] || '',
  };
});
// A page whose stylesheet never loaded still screenshots into a normal-looking PNG full of
// unstyled text — so refuse the shot unless the theme is provably on the page.
if (!facts.primary500 || !facts.googleFontsHref) {
  console.log(`🔴 ${id} page carries no theme colours/fonts — this screenshot does not count`);
  rc = 1;
}
// Same reasoning one level up: a caption with no reading behind it must not look like a reading. If the home
// page never loaded, say so in the field the gallery prints rather than leaving a stale or empty value there.
facts.regions = regions || { header: '(home page not read)', footer: '(home page not read)', headerScrim: '(home page not read)', langSwitchers: 0 };
if (!regions) rc = 1;
facts.consoleErrors = errors;
console.log(JSON.stringify({ id, ...facts }));
import('fs').then(fs => fs.writeFileSync(`${outDir}/${id}.json`, JSON.stringify({ id, ...facts }, null, 2)));

await browser.close();
process.exit(rc);
