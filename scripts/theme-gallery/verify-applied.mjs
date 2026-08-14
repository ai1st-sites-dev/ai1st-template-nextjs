// #932 AC3 — for one theme, check that what is actually on the built page equals what the
// registry says. #963 — paths parameterised (see paths.mjs); checks unchanged.
//
// Usage: node verify-applied.mjs <themeId>      (that theme's build must already have happened)
//
// Three things are checked:
//   colours  17 CSS variables (primary 10 steps + accent 7) each equal themes.js
//   fonts    --font-sans equals fonts.body, and the page's Google Fonts link equals the registry's
//   layout   every section's variant in the generated config-data.ts:
//              type the table has an opinion about → must equal that opinion
//              type it says nothing about          → must equal the sample page JSON's own value
//                                                    (proving nothing else moved)
//            plus one real-browser reading: the hero element carries that variant's own class
import fs from 'fs';
import { NEXT_DIR, PLAYWRIGHT_MODULE } from './paths.mjs';

const { chromium } = await import(PLAYWRIGHT_MODULE);
const { themes } = await import(`${NEXT_DIR}/scripts/themes.js`);

const id = process.argv[2];
const t = themes[id];
if (!t) { console.log(`🔴 no theme "${id}" in the registry`); process.exit(2); }

const fail = [];
const ok = [];

// ── layout: config-data.ts vs registry vs the sample site's own page JSON ────────────────────
const cd = fs.readFileSync(`${NEXT_DIR}/src/lib/config-data.ts`, 'utf-8');
const pagesLine = cd.match(/export const pagesByLocale = (.*);\n/);
if (!pagesLine) { console.log('🔴 cannot read pagesByLocale out of config-data.ts'); process.exit(2); }
const pages = JSON.parse(pagesLine[1]);

// what the page JSON on disk says (the build never writes back to it)
const baseline = {};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
  const p = `${dir}/${e.name}`;
  if (e.isDirectory()) return walk(p);
  if (!e.name.endsWith('.json')) return;
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  // #998: 磁盘上的页面新旧两种形状都可能有（新的是 blocks，老的是 sections）。这里读的是原始文件，
  // 不是 sync-config 归一化之后的东西，所以两种都要认。
  (j.blocks || j.sections || []).forEach((s, i) => { baseline[`${j.slug}#${i}`] = s.data && s.data.variant; });
});
walk(`${NEXT_DIR}/site/pages`);

let overridden = 0, untouched = 0;
for (const [, list] of Object.entries(pages)) {
  for (const page of list) {
    // config-data.ts 里是归一化之后的形状（#998 起恒为 blocks）
    (page.blocks || []).forEach((s, i) => {
      const key = `${page.slug}#${i}`;
      const want = t.layout[s.type];
      const got = s.data && s.data.variant;
      if (want) {
        overridden++;
        if (got !== want) fail.push(`layout ${key} (${s.type}): page has "${got}", registry wants "${want}"`);
      } else {
        untouched++;
        if (got !== baseline[key]) fail.push(`layout ${key} (${s.type}): registry says nothing about it, yet it changed from "${baseline[key]}" to "${got}"`);
      }
    });
  }
}
if (!fail.length) ok.push(`layout: ${overridden} sections took the table's variant and all match; ${untouched} the table says nothing about are untouched`);
else ok.push(`layout: ${overridden} overridden, ${untouched} untouched — see 🔴 below`);

// ── colours + fonts: read out of the HTML the build actually produced ────────────────────────
const html = fs.readFileSync(`${NEXT_DIR}/out/security-vendor/index.html`, 'utf-8');
let colorChecked = 0;
for (const [group, shades] of [['primary', t.colors.primary], ['accent', t.colors.accent]]) {
  for (const [shade, hex] of Object.entries(shades)) {
    colorChecked++;
    if (!html.includes(`--color-${group}-${shade}: ${hex};`)) {
      fail.push(`colour --color-${group}-${shade} on the page is not ${hex}`);
    }
  }
}
const colorFails = fail.filter(x => x.startsWith('colour')).length;
if (!colorFails) ok.push(`colours: ${colorChecked} CSS variables each match the registry`);

// 🔴 href in HTML is escaped (& becomes &amp;), so comparing the registry's raw URL with
//    includes() never matches — unescape first.
const unescaped = html.replace(/&amp;/g, '&');
let fontOk = true;
if (!html.includes(`--font-sans: ${t.fonts.body.join(', ')};`)) { fail.push(`font --font-sans is not ${t.fonts.body.join(', ')}`); fontOk = false; }
if (!unescaped.includes(t.fonts.googleFontsUrl)) { fail.push(`the page's Google Fonts link is not the registry's`); fontOk = false; }
if (fontOk) ok.push('fonts: --font-sans and the Google Fonts link both match the registry');

// ── browser: does the hero element carry the markup only that variant produces? ──────────────
// Each entry is what must be in the hero's HTML, and what must not. `not` is only needed where a
// variant has no markup of its own at all: `centered` and `split` render the identical <section>,
// and they differ only in what is inside it.
//
// 🔴 This table is checked against HeroSection.tsx before it is used (see below). Twice already it
//    silently rotted: #959 added three variants nobody added here (10 of 30 themes then reported
//    "this check did not run"), and three of the entries that were here named markup the component
//    does not produce at all — `aspect-video` appears zero times in it, so every `video-style`
//    theme failed a check about a class that never existed, while `py-28` and
//    `from-primary-900 via-primary-800` each match four and three variants, passing themes that
//    render something else entirely. A marker table nobody re-derives is a yardstick nobody reads.
const HERO_MARK = {
  'split': { must: ['lg:grid-cols-2'] },
  'minimal': { must: ['border-b-4 border-accent-500'] },
  'gradient-overlay': { must: ['from-primary-600 to-accent-600'] },
  'centered': { must: ['bg-gradient-to-b from-primary-900'], not: ['lg:grid-cols-2'] },
  'left': { must: ['bg-gradient-to-br from-primary-900'] },
  'video-style': { must: ['hover:scale-110'] },
  'light-split': { must: ['lg:grid-cols-12'] },
  'light-editorial': { must: ['lg:py-32'] },
  'light-showcase': { must: ['lg:pt-24'] },
};

// Cut HeroSection.tsx into one piece per variant so each marker can be re-derived rather than
// trusted. The variants are `if (variant === 'x') { … }` blocks; the last `return (` at two-space
// indent is the fallback branch, which is the `left` variant.
const DEFAULT_VARIANT = 'left';
function heroBlocks() {
  const src = fs.readFileSync(`${NEXT_DIR}/src/components/sections/HeroSection.tsx`, 'utf-8');
  const at = [...src.matchAll(/if \(variant === '([a-z-]+)'\) \{/g)].map(m => ({ v: m[1], i: m.index }));
  const defaultAt = src.lastIndexOf('\n  return (');
  if (!at.length || defaultAt < 0) return null;
  const blocks = { [DEFAULT_VARIANT]: src.slice(defaultAt) };
  at.forEach((m, k) => {
    blocks[m.v] = src.slice(m.i, k + 1 < at.length ? at[k + 1].i : defaultAt);
  });
  return blocks;
}
const blocks = heroBlocks();
const matches = (variant, block) =>
  HERO_MARK[variant].must.every(s => block.includes(s)) &&
  (HERO_MARK[variant].not || []).every(s => !block.includes(s));
if (!blocks) {
  fail.push('cannot read the hero variants out of HeroSection.tsx — the marker table is unverified');
} else {
  const missing = Object.keys(blocks).filter(v => !HERO_MARK[v]);
  if (missing.length) fail.push(`HeroSection.tsx has variant(s) the marker table never heard of: ${missing.join(', ')}`);
  for (const v of Object.keys(HERO_MARK)) {
    const hit = Object.keys(blocks).filter(b => matches(v, blocks[b]));
    if (hit.length !== 1 || hit[0] !== v) {
      fail.push(`marker for hero "${v}" is stale: in HeroSection.tsx it matches ${hit.length ? hit.join(' + ') : 'nothing'}`);
    }
  }
  if (!fail.some(f => f.startsWith('marker') || f.startsWith('HeroSection'))) {
    ok.push(`hero markers: all ${Object.keys(HERO_MARK).length} still match exactly their own variant in HeroSection.tsx`);
  }
}

const want = t.layout['hero'];
const mark = HERO_MARK[want];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`file://${NEXT_DIR}/out/security-vendor/index.html`, { waitUntil: 'domcontentloaded' });
// The callback runs INSIDE the browser — `document` there is the page's, not Node's.
/* global document */
const heroHtml = await page.evaluate(() => document.querySelector('main section')?.outerHTML || '');
await browser.close();
if (!mark) fail.push(`no marker written for hero variant "${want}" — this check did not run`);
else if (!matches(want, heroHtml)) {
  const missed = mark.must.filter(s => !heroHtml.includes(s));
  const strayed = (mark.not || []).filter(s => heroHtml.includes(s));
  fail.push(`in the browser the hero is not "${want}"` +
    (missed.length ? `: no ${missed.map(s => `"${s}"`).join(' / ')}` : '') +
    (strayed.length ? `: it carries ${strayed.map(s => `"${s}"`).join(' / ')}, which "${want}" never renders` : ''));
} else ok.push(`browser: hero is "${want}" (${mark.must.map(s => `"${s}"`).join(' + ')} in the DOM${mark.not ? `, and no ${mark.not.map(s => `"${s}"`).join(' / ')}` : ''})`);

console.log(`\n=== ${id} ===`);
ok.forEach(l => console.log('  ✅ ' + l));
fail.forEach(l => console.log('  🔴 ' + l));
process.exit(fail.length ? 1 : 0);
