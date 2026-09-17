// ══════════════════════════════════════════════════════════════════════════════════════════════════
// demo-content/images.js — 图册演示内容用的真图（#1383）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **只给图册看，不进客户站、不进 www。** 这些是 FlyonUI 的公开示例图，我们拿它们当**内部对照**：
//    一个块排得好不好，占位色块（`/images/grid-pattern.svg`）看不出来，真图才看得出来。
//    建站那条路（`create-site.js` / `blocks.js`）一个字都不读这个文件 —— 判据是它的调用方：
//    只有 `scripts/lib/demo-content/index.js`，而那一份只被图册页与夹具页引用。
//
// 🔴 **每张图都带 `fallback`。** CDN 挂掉时整页变色块，而「每个槽位都有值」那道守卫照样绿 ——
//    也就是那一格的失败方向是静默的。`fallback` 是一张**纯色** SVG 的 data URI：它不发网络请求，
//    所以它永远拿得到，代价是那一格看起来是一块纯色（跟占位色块不同：它不是 grid-pattern）。
//    守卫会 HEAD 一遍下面每个 `url`，**读不到只警告、不打红** —— CI 上没有外网是常态，
//    把它打成红就是让一条跟本仓代码无关的事去挡 ship。
//
// 🔴 **分类是探出来的，不是猜的**（2026-09-17 现取，`logo` / `logos` / `brand` / `brands` /
//    `brand-logo` / `client` / `clients` / `companies` / `partners` / `logo-cloud` / `icons` /
//    `pricing` / `stats` 逐个 HEAD 全是 404）：有图的是 `hero` / `gallery` / `team` / `about` /
//    `contact` / `blog` / `testimonials` / `features` / `faq` / `cta` 这十类。
// 🔴 **所以「品牌墙」那两个块一张图都不用** —— 不是退而求其次拿照片顶上：`logo-carousel.logos` 与
//    `trusted-brands.brands` 这两个槽**本来就装文字**（组件把每一项原样渲染进一个 `<span>`，
//    `LogoCarouselSection.tsx:50`）。#1383 第一版往 `logos` 里塞了六条 CDN 地址，它们被当字面文字
//    画出来、每条 585px 宽，那一排在 1280px 下排成 3 行 —— 理由与读数记在 `content.js` 那两个块上。
'use strict';

const CDN = 'https://cdn.flyonui.com/fy-assets/blocks/marketing-ui';

/** `https://cdn.flyonui.com/fy-assets/blocks/marketing-ui/<类>/<类>-<n>.png` */
const cdn = (category, n) => `${CDN}/${category}/${category}-${n}.png`;

/** 一张纯色 SVG 的 data URI —— 不发请求，所以它是 CDN 挂掉时唯一还在的东西。 */
const solid = (hex) => 'data:image/svg+xml;utf8,'
  + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" preserveAspectRatio="none">`
    + `<rect width="16" height="9" fill="${hex}"/></svg>`);

/**
 * 键 → `{ url, fallback }`。键是**这张图在演示内容里干什么用**，不是它在 CDN 上叫什么 ——
 * 换一张图时只改这里一行，内容那一份不用动。
 */
const IMAGES = {
  'hero-bay':        { url: cdn('hero', 10),         fallback: solid('#20293a') },
  'hero-front-desk': { url: cdn('hero', 17),         fallback: solid('#243043') },
  'about-workshop':  { url: cdn('about', 9),         fallback: solid('#2b3546') },
  'logo-mark':       { url: cdn('about', 1),         fallback: solid('#1b2331') },
  'logo-mark-alt':   { url: cdn('about', 2),         fallback: solid('#1b2331') },

  'avatar-1': { url: cdn('team', 1), fallback: solid('#3d4657') },
  'avatar-2': { url: cdn('team', 2), fallback: solid('#41495b') },
  'avatar-3': { url: cdn('team', 3), fallback: solid('#454e60') },
  'avatar-4': { url: cdn('team', 5), fallback: solid('#495264') },
  'avatar-5': { url: cdn('team', 8), fallback: solid('#4d5668') },
  'avatar-6': { url: cdn('team', 9), fallback: solid('#515a6c') },

  'work-1': { url: cdn('gallery', 1),  fallback: solid('#33405a') },
  'work-2': { url: cdn('gallery', 2),  fallback: solid('#374460') },
  'work-3': { url: cdn('gallery', 3),  fallback: solid('#3b4866') },
  'work-4': { url: cdn('gallery', 5),  fallback: solid('#3f4c6c') },
  'work-5': { url: cdn('gallery', 9),  fallback: solid('#435072') },
  'work-6': { url: cdn('gallery', 10), fallback: solid('#475478') },

};

/**
 * 一张图的地址。
 * 🔴 键不认就**抛**，不回一个占位串 —— 回占位串就是「图册上那一格看起来只是图挑得不好」，
 *    而真相是内容包里少了一条，那正是本票要消灭的那种静默。
 */
function imageUrl(key) {
  const e = IMAGES[key];
  if (!e) throw new Error(`demo-content: 没有名叫 "${key}" 的图（有的是：${Object.keys(IMAGES).join(' / ')}）`);
  return e.url;
}

module.exports = { IMAGES, imageUrl, cdn, solid, CDN };
