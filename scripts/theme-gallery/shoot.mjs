// #932 — take a full-page screenshot of an already-built site with a real browser.
// #963 — paths parameterised (see paths.mjs); behaviour unchanged.
//
// Usage: node shoot.mjs <baseUrl> <outDir> <themeId>
import { PLAYWRIGHT_MODULE } from './paths.mjs';

const { chromium } = await import(PLAYWRIGHT_MODULE);

const [baseUrl, outDir, id] = process.argv.slice(2);
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

let rc = 0;
for (const [slug, suffix] of PAGES) {
  const url = `${baseUrl}/${slug}`;
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (!resp || resp.status() !== 200) { console.log(`🔴 ${id}${suffix} HTTP ${resp && resp.status()}`); rc = 1; continue; }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${id}${suffix}.png`, fullPage: true });
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
facts.consoleErrors = errors;
console.log(JSON.stringify({ id, ...facts }));
import('fs').then(fs => fs.writeFileSync(`${outDir}/${id}.json`, JSON.stringify({ id, ...facts }, null, 2)));

await browser.close();
process.exit(rc);
