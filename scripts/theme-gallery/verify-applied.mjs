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
//
// 📌 #1171 — there used to be a fourth thing, one real-browser reading of the hero's markup. It is
//    retired, with the three readings that killed it written where it stood (§browser: RETIRED).
//    Nothing here opens a browser any more.
import fs from 'fs';
import { NEXT_DIR } from './paths.mjs';
const { themes, layoutFor } = await import(`${NEXT_DIR}/scripts/themes.js`);

const id = process.argv[2];
const t = themes[id];
if (!t) { console.log(`🔴 no theme "${id}" in the registry`); process.exit(2); }
// #1010 —— 注册表里那张表叫 `supports` 了,装的是清单;「这套 theme 对每个 block 最终用哪个写法」
// 由 `layoutFor()` 说,别在这里自己从清单里挑（两处实现必然分叉）。
const variants = layoutFor(id);

const fail = [];
const ok = [];
// #1171 —— 「这一维今天量不到」既不是通过也不是失败，所以它有自己的一栏（缺席型结论要写在结论行上）。
const info = [];

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
      // #1162 —— 跟 sync-config.js 那一处同一个形状、同一个理由，两处必须一起改：这里以前也先读
      // 别名层写上去的那个隐藏字段。别名层 2026-08-23 退役之后没有任何地方再写它，两边都收成
      // `s.type` 一句。**两处要读同一个键**，否则这份对账会拿另一套口径去核 sync-config 的产物。
      const want = variants[s.type];
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

// ── colours + fonts: read out of the STYLESHEET the build actually produced ──────────────────
// 🔴 #1002 moved them out of index.html. They used to be an inline <style> plus a <link> to Google
// Fonts, both written into every page; now they are `out/<site>/theme.css` — one file with a fixed
// name, which is what lets a theme change skip the rebuild. Reading the HTML here would report
// "colour --color-primary-500 on the page is not #…" for all 17 shades of every theme.
const html = fs.readFileSync(`${NEXT_DIR}/out/security-vendor/theme.css`, 'utf-8');
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

// 🔴 The URL used to live in an href, where `&` is escaped as `&amp;`, so comparing the registry's
//    raw URL with includes() never matched. #1002 moved it into theme.css's `@import url("…")`,
//    where nothing is escaped — the unescape is now a no-op and is kept only so this line does not
//    become the thing that breaks if the URL ever goes back into markup.
const unescaped = html.replace(/&amp;/g, '&');
let fontOk = true;
if (!html.includes(`--font-sans: ${t.fonts.body.join(', ')};`)) { fail.push(`font --font-sans is not ${t.fonts.body.join(', ')}`); fontOk = false; }
if (!unescaped.includes(t.fonts.googleFontsUrl)) { fail.push(`the page's Google Fonts link is not the registry's`); fontOk = false; }
if (fontOk) ok.push('fonts: --font-sans and the Google Fonts link both match the registry');

// ── browser: RETIRED (#1171，来源 #1162) ─────────────────────────────────────────────────────
//
// 这里曾经有一格真浏览器读数：打开产物首页，看 hero 那个 <section> 上有没有「只有这个 variant 才
// 产出的 markup」，对照一张手写的标记表 `HERO_MARK`。**#1008 之后那一格按构造量不到东西了**，而它
// 报出来的样子不是「跳过」，是两条 🔴 —— 而那两条红说的都是它自己瞎了。这种红最贵：照字面读会去
// 修被测对象，而该修的是尺子。
//
// 🔴 为什么不是「重新派生一张表」，是退役 —— 三个读数（2026-08-24 在 origin/main 上现取）：
//   ① `HeroSection.tsx` 里 `if (variant === '…') {` 命中 **0 处**。#1008 把九棵 variant 树删成
//      一棵中性 markup（那个文件头上写着 "ONE MARKUP, AND NOTHING ELSE"）⟹ `heroBlocks()` 的
//      `at.length` 为 0 ⟹ 它返回 null ⟹ 第一条红「cannot read the hero variants …」**无条件**开火。
//   ② 注册表里 80 套主题，`layoutFor(id).hero` 的取值集合是 `with-media / text-only / with-form`
//      （内容结构，#998 的 block_layout 词汇），而 `HERO_MARK` 的 9 个键是那批**已下架**的版式名
//      （split / minimal / gradient-overlay / centered / left / video-style / light-*）。
//      两个集合**交集为空** ⟹ `HERO_MARK[want]` 恒 undefined ⟹ 第二条红「no marker written for
//      hero variant "…" — this check did not run」对 **80/80** 套主题都开火。
//   ③ 而且今天没有别的 DOM 属性可以改指过去：主题对 hero 的意见经 `sync-config.js` 落在
//      `data.variant` 上，而 `HeroSection` **不再读它**（那个文件头逐字：`variant` IS STILL WRITTEN
//      AND NO LONGER READ）；`data-block-layout` 来自页面 JSON 的 `block_layout`，不是主题写的。
//      ⟹ 「这个站现在穿的是哪套 hero 版式」这件事**在产物 DOM 上没有痕迹**，不是尺子没找对。
//
// 🔴 覆盖边界写在这里，也印在下面的输出里：hero 那一维仍然被查，但只在**配置层** —— 上面
//    §layout 那一段拿 `layoutFor(id)` 跟 `config-data.ts` 逐块对账，hero 就是其中一块。少掉的是
//    「浏览器里那一格」。别把这次退役读成「hero 没人管了」，也别读成「浏览器里验过了」。
//    主题真正长什么样今天由样式表决定，而颜色/字体那两段读的就是产物里那份 `out/…/theme.css`。
info.push('browser: hero 的版式在产物 DOM 上今天没有痕迹（#1008 把九棵 variant 树收成一棵中性 markup，'
  + '而 variant 只写不读）⟹ 那格真浏览器读数已退役（#1171）；hero 仍在上面的 layout 段按配置对账');

console.log(`\n=== ${id} ===`);
ok.forEach(l => console.log('  ✅ ' + l));
info.forEach(l => console.log('  ℹ️  ' + l));
fail.forEach(l => console.log('  🔴 ' + l));
process.exit(fail.length ? 1 : 0);
