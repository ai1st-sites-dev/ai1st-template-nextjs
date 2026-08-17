// #932 — take a full-page screenshot of an already-built site with a real browser.
// #963 — paths parameterised (see paths.mjs); behaviour unchanged.
// #981 条6/条7 — also reads the header/footer Region back off the page, and can shoot a header close-up.
//   This is where tests/e2e/region-shots.mjs was folded in; that file is gone. Its captions came out of the
//   theme registry (`themes[id].supports.header`, called `layout` before #1010), which is a claim, not a
//   reading: resolveRegionLayout can
//   hand back something else entirely — it falls back to the default when the variant is unknown, and a
//   transparent-overlay header always comes with a scrim of its own (#1024). So the caption could
//   say "transparent-overlay, no scrim" about a page that rendered a scrim. Here it comes off the DOM.
//
// Usage: node shoot.mjs <baseUrl> <outDir> <themeId> [--header-closeup]
//   --header-closeup: also write <id>-header.png, a 1440×260 crop of the top of the page. The full-page
//   shots are 5-6k pixels tall, and the one thing that gets judged up there — is the language switcher
//   readable against the hero — is a 12px word in them. That is why #960 r2's defect (the switcher was the
//   one child the overlay never re-coloured) was invisible to a human paging through the full-page shots.
import { PLAYWRIGHT_MODULE } from './paths.mjs';
import shotFiles from './shot-files.js';

const { chromium } = await import(PLAYWRIGHT_MODULE);

const [baseUrl, outDir, id, ...flags] = process.argv.slice(2);
const HEADER_CLOSEUP = flags.includes('--header-closeup');
// 🔴 A static export writes about.html, not about/index.html — requesting /about returns the
//    404 page, and the 404 page screenshots just fine. The first version of this script shipped
//    a picture of a 404 that way.
//
// #1061 — 第三页 allblocks.html 是**必须**拍的，不是可选的。
//
// 🔴 为什么：翻这些图的人是第四道闸，而前两页加起来只摆得出 34 种块里的一小部分。整整两轮的实例：
//    #1060 把样例站 FAQ 的第一条问答改成打开的，为的是让「主题把答案压成一条 3px 的缝」重新被看见 ——
//    改那一行之前和之后，图册里两张图逐字节相同，因为 faq-accordion 这个块**根本不在图上**。
//    #1016 要按最终契约批量出 60-80 套主题，第四道闸就是人翻这本图册：图上没有的块，翻多少套都看不见。
//    所以拍的那一页必须是「每种块各出现一次」的那一页。
//
// 🔴 页面不在就红（`rc=1`），不静默跳过。「这个站没有那一页」跟「这套主题没问题」必须是两个读数 ——
//    静默跳过正好是本票要治的那个毛病的翻版。撑开样例站的做法写在下面的 hint 里，
//    `shoot-themes.sh` 在建第一套主题之前就先替你问一遍（那里失败得早、只说一次）。
//
// 🔴 URL 是扁平的 `allblocks.html`，不是 `en/allblocks.html`：多语言站里 `en/` 那份只是重定向壳
//    （#1018 r3 量过：10968 字节、`data-block` 命中 0；扁平那份 100439 字节、34 种块 —— 本票在
//    今天的样例站上复量过同一对数）。
const WIDEN = 'cd templates/nextjs && node scripts/theme-css-invariants-sample-pages.js "$PWD/site"';
const PAGES = [
  ['', '', ''],
  ['about.html', '-about', ''],
  ['allblocks.html', '-allblocks',
    `样例站没有「每种块各一次」那一页 ⟹ 这本图册对 34 种块里的大多数是瞎的。撑开它：${WIDEN}`],
];

// 🔴 #1061 r2 —— 开拍之前先把这个 id 上一轮的产物清掉。理由整段写在 `shot-files.js` 头上，一句话版：
//    这一轮失败时盘上会留着上一轮的图和读数，而对照页问的是「盘上有哪几张」—— 不清，人审就会
//    翻到上一轮的像素、读到上一轮那套表的色号。清掉之后「盘上有这张图」才重新等于「这一轮拍到了它」。
//
// 🔴 先自查再动手：拍哪几页是这个文件说了算，清哪几个文件是 `shot-files.js` 说了算。两处分开写是因为
//    清理还要盖住**根本走不到这里**的路（见那个文件的「谁调它」），代价是它们会分叉 —— 所以这里对一次，
//    漏了当场退 2，不留给下一轮变成一张跨轮活下来的图。
//
// 📌 下面两句都走 stderr，不走 stdout：`theme-pipeline/gates.js` 把 stdout 的**第一行**当成「这一轮
//    出了什么事」印在人审那张卡片上，一句家务话挤到第一行就会顶掉真正的原因。
const unlisted = PAGES.map(([, suffix]) => suffix)
  .filter((s) => !shotFiles.SHOT_SUFFIXES.includes(s));
if (unlisted.length) {
  console.error(`🔴 shot-files.js 的清理清单里没有这些后缀：${unlisted.join(' ')}`
    + ' —— 补进 SHOT_SUFFIXES，否则这几张图会跨轮活下来被当成新拍的。');
  process.exit(2);
}
const stale = shotFiles.clearShots(outDir, id);
if (stale.length) console.error(`🧹 ${id} 清掉上一轮的 ${stale.length} 个产物：${stale.join(' ')}`);

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
for (const [slug, suffix, hint] of PAGES) {
  const url = `${baseUrl}/${slug}`;
  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (!resp || resp.status() !== 200) {
    console.log(`🔴 ${id}${suffix} HTTP ${resp && resp.status()}${hint ? ` —— ${hint}` : ''}`);
    rc = 1;
    continue;
  }
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
// 📌 #1061 —— 这一段跑在**循环停下的那一页**上，而那一页现在是 allblocks.html（以前是 about.html）。
//    下面读的四个值全部来自 `:root` 和 `<body>`，每一页都一样，所以换页不改这四个读数
//    （`regions` 那一项不在这里，它在循环里、只在首页取，理由见上面 readRegions 的注释）。
//    真变了的只有 `consoleErrors`：它现在也收 allblocks.html 上的报错 —— 那是多出来的覆盖面，
//    不是噪音，34 种块里有块在浏览器里炸了，本来就该让翻图的人看见。
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
