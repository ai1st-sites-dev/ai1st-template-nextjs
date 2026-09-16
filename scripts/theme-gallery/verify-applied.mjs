// #932 AC3 — for one theme, check that what is actually on the built page equals what the
// registry says. #963 — paths parameterised (see paths.mjs); checks unchanged.
//
// Usage: node verify-applied.mjs <themeId>      (that theme's build must already have happened)
//
// Three things are checked:
//   colours  17 CSS variables (primary 10 steps + accent 7) each equal themes.js
//   fonts    --font-sans equals fonts.body, and the page's Google Fonts link equals the registry's
//   layout   the generated config-data.ts's `regionLayout` (the topbar / header / footer shells)
//            equals what the registry declares for this theme
//
// 📌 #1341 — `layout` used to reconcile EVERY block's `data.variant` in config-data.ts against the
//    registry's per-block opinion. That dimension is retired: the build no longer writes
//    `data.variant`, no theme declares a per-block `supports` key any more, and `layoutFor()` now
//    answers only about the regions. Keeping the block loop would have left a check whose subject
//    stopped existing — it would have found every block "untouched" and said so every time. What is
//    left is the regions, which is the live half of the same question.
//
// 📌 #1171 — there used to be a fourth thing, one real-browser reading of the hero's markup. It is
//    retired, with the three readings that killed it written where it stood (§browser: RETIRED).
//    Nothing here opens a browser any more.
import fs from 'fs';
import { NEXT_DIR } from './paths.mjs';
const { themes, regionShapesFor } = await import(`${NEXT_DIR}/scripts/themes.js`);

const id = process.argv[2];
const t = themes[id];
if (!t) { console.log(`🔴 no theme "${id}" in the registry`); process.exit(2); }
// #1010 —— 注册表里那张表叫 `supports` 了,装的是清单;「这套 theme 对每个 block 最终用哪个写法」
// 由 `layoutFor()` 说,别在这里自己从清单里挑（两处实现必然分叉）。
const variants = regionShapesFor(id);

const fail = [];
const ok = [];
// #1171 —— 「这一维今天量不到」既不是通过也不是失败，所以它有自己的一栏（缺席型结论要写在结论行上）。
const info = [];

// ── layout: the regions in config-data.ts vs the registry ────────────────────────────────────
//
// 🔴 两边取的是同一个函数（`layoutFor`），但**这一份不自己算最终值** —— 站可以在 `site/theme.json`
//    的 `regionLayout` 里逐键压过注册表（#1079 候选图册那条路要的就是它）。所以注册表没说的那一维
//    不判「不相等」，只报「注册表没表态」；说了的那一维才逐字比。
const cd = fs.readFileSync(`${NEXT_DIR}/src/lib/config-data.ts`, 'utf-8');
const regionLine = cd.match(/export const regionLayout = (.*);\n/);
if (!regionLine) { console.log('🔴 cannot read regionLayout out of config-data.ts'); process.exit(2); }
const builtRegions = JSON.parse(regionLine[1]);

{
  const said = [];
  let compared = 0;
  for (const key of ['header', 'footer', 'topbar']) {
    const want = variants[key];
    if (!want) { said.push(`${key}: the registry states no preference`); continue; }
    compared += 1;
    const got = builtRegions[key];
    if (got !== want) fail.push(`layout ${key}: the page is on "${got}", the registry declares "${want}"`);
    else said.push(`${key}: "${got}"`);
  }
  // 🔴 一个都没比成时要说出来 —— 「全对」和「没有对象」在只印 ✅ 时长得一样。
  if (compared === 0) info.push(`layout: this theme declares none of header / footer / topbar — nothing was compared (${said.join(' · ')})`);
  else if (!fail.length) ok.push(`layout: ${compared} region(s) match the registry — ${said.join(' · ')}`);
  else ok.push(`layout: ${compared} region(s) compared — see 🔴 below`);
}

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
//   ② `layoutFor(id).hero` 的取值集合是 `with-media / text-only / with-form`（内容结构，#998 的
//      block_layout 词汇；📌 #1333 之后 `with-form` 不再是 hero 的取值 —— 带表单的首屏是自己一个块
//      类型 `hero-with-form` 了，所以那个集合今天是 `with-media / text-only`。这条结论跟集合里有
//      几个词无关，见下面那段：承重的是「交集为空」），而 `HERO_MARK` 的 9 个键是那批**已下架**的版式名
//      （split / minimal / gradient-overlay / centered / left / video-style / light-*）。
//      两个集合**交集为空** ⟹ `HERO_MARK[want]` 恒 undefined ⟹ 第二条红「no marker written for
//      hero variant "…" — this check did not run」对注册表里**每一套**主题都开火。
//      🔴 这一行原来写着「注册表里 80 套」和「对 **80/80** 套都开火」（#1215 打磨批次 #25 条 9）。
//      80 是 2026-08-24 那天的数，2026-08-28 现取是 **97**，2026-09-14（#1317 整池下架重建）现取
//      是 **2** —— 三个数，同一条结论。这条结论**跟那个数无关**：
//      交集为空是关于两个集合的，N 是多少都一样。所以这里不再钉任何一个数；真要取，自己跑
//      `node -e 'console.log(Object.keys(require("../themes.js").themes).length)'`。
//   ③ 而且今天没有别的 DOM 属性可以改指过去：主题对 hero 的意见经 `sync-config.js` 落在
//      `data.variant` 上，而 `HeroSection` **不再读它**（那个文件头逐字：`variant` IS STILL WRITTEN
//      AND NO LONGER READ）；`data-block-layout` 来自页面 JSON 的 `block_layout`，不是主题写的。
//      ⟹ 「这个站现在穿的是哪套 hero 版式」这件事**在产物 DOM 上没有痕迹**，不是尺子没找对。
//
// 🔴 覆盖边界写在这里，也印在下面的输出里。**#1341 之后它变窄了，要说清楚**：
//    上面 §layout 那一段以前拿 `layoutFor(id)` 跟 `config-data.ts` **逐块**对账，hero 是其中一块；
//    #1341 把「主题对每个块的内容结构有什么意见」这一整维退役了（没有任何主题再声明它、构建也不再
//    写 `data.variant`）⟹ 那段对账没有对象了，今天它只对顶栏 / 页脚这两个【区】。
//    也就是说 hero 那一维在这个脚本里**既不在浏览器那格、也不在配置那段** —— 它不再存在，不是没人管。
//    主题真正长什么样今天由样式表决定，而颜色/字体那两段读的就是产物里那份 `out/…/theme.css`；
//    hero 排成什么样由平台的 `public/shapes.css` + 池里的 `shapes` 选择单决定（#1318），
//    那一维的机械核对在 `theme-pipeline/pool.test.js` ⑪。
info.push('browser: hero 的版式在产物 DOM 上今天没有痕迹（#1008 把九棵 variant 树收成一棵中性 markup，'
  + '而 variant 只写不读）⟹ 那格真浏览器读数已退役（#1171）。#1341 之后配置那一段也不再对 hero 说话'
  + '（主题对块内容结构的意见整维退役）—— 上面 §layout 只对顶栏 / 页脚；hero 的画法归 #1318 的 shapes 选择单');

console.log(`\n=== ${id} ===`);
ok.forEach(l => console.log('  ✅ ' + l));
info.forEach(l => console.log('  ℹ️  ' + l));
fail.forEach(l => console.log('  🔴 ' + l));
process.exit(fail.length ? 1 : 0);
