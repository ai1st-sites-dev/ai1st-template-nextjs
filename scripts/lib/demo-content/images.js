// ══════════════════════════════════════════════════════════════════════════════════════════════════
// demo-content/images.js — 演示内容用的真图（#1383 立；#1620 换成我们自己存储上的那一批）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **图不进客户站、不进模板**（#1620，Chris 2026-10-06 选 C）。原图住在 `manager/assets/demo-images/`
//    （来源逐张记在同目录的 `CREDITS.md`，Unsplash License），manager 用 `go:embed` 编进二进制、开机按内容哈希
//    补传到本环境 R2 站点桶的 `uploads/demo/<文件>`（`manager/demo_images.go`）。对外地址就是
//    `https://<domain.uploads>/demo/<文件>` —— 跟老板上传的图同一个桶、同一个域名。
//    这里只写**地址**，一个字节的图都不在 `templates/nextjs/` 下：模板 `public/` 里的东西会进每个客户站的
//    仓库历史和静态导出，删了也还在（PM 在 #1620 量过：模板 8.5 MB，+3 MB 就是 +35%）。
//
// 🔴 **谁读这一份：** 图册 / 单格页 / 夹具页（同 #1383），以及 #1620 起 skipAI 示例站（`create-site.js`
//    §demoSiteContent 从 `lib/demo-content/` 取整站内容）。示例站**不用下面这个默认前缀** —— manager 在 skipAI
//    载荷里带 `demoImageBase`（= 本环境的 `https://<domain.uploads>/demo/`），`rebaseDemoImages` 把内容里
//    以 `DEMO_IMAGE_BASE` 开头的每个地址换到那个前缀上；载荷没带它（本地 rig、离线 e2e）就换成占位图。
//    所以 dev / test / prod 的示例站各自读本环境的桶。
//
// 🔴 **前缀一处定义：`DEMO_IMAGE_BASE`。** 进程环境变量 `DEMO_IMAGE_BASE` 给了就用它（必须是 https 地址），
//    没给就是 dev 那个环境的地址 —— 图册在哪个环境打开都能取到图（dev 的 manager 开机就把这批图补齐了）。
//    🔴 默认值**故意是一个字面的 https 前缀**：`demo-content.test.js` ④ 段对每个 `https:` 开头的 url 做一次
//    HEAD，它的分母就是「以 https 开头的那几个」—— 前缀若改成运行时才拼出来的空串 / 相对路径，那一段会按构造
//    量 0 张图而照样绿（#1620 PM 裁定第 3 条）。那一段现在同时断言「分母 = IMAGES 的键数」。
//
// 🔴 **每张图都带 `fallback`。** 存储挂掉时整页变色块，而「每个槽位都有值」那道守卫照样绿 ——
//    也就是那一格的失败方向是静默的。`fallback` 是一张**纯色** SVG 的 data URI：它不发网络请求，
//    所以它永远拿得到，代价是那一格看起来是一块纯色（跟占位色块不同：它不是 grid-pattern）。
//    守卫会 HEAD 一遍下面每个 `url`，**读不到只警告、不打红** —— CI 上没有外网是常态，
//    把它打成红就是让一条跟本仓代码无关的事去挡 ship。
//
// 🔴 **logo 那 7 张是我们自己做的 SVG 字标**（纯文字，`client-logo-*` / `brand-logo`）。品牌墙 / 顶栏的 logo
//    槽要的是图片地址；`trusted-brands.brands` 那种装**文字**的槽不在这里（#1383 第一版往文字槽里塞过 CDN 地址，
//    它们被当字面文字画出来、每条 585px 宽 —— 凭什么判一个槽装的是文字，那是反例）。
'use strict';

/** 默认前缀：dev 那个环境的上传域名下的 `demo/`。改它之前读文件头那条「故意是字面的 https 前缀」。 */
const DEFAULT_DEMO_IMAGE_BASE = 'https://uploads.ai1stsite.dev/demo/';

/**
 * 一个前缀合不合用：`https://` 开头、去掉空白、补上结尾的 `/`。不合用回 ''。
 * 🔴 只认 https：这个前缀会原样拼进客户看得到的 `<img src>`（示例站）和图册页。
 */
function normalizeDemoImageBase(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^https:\/\/[^\s/]+\//.test(s.endsWith('/') ? s : `${s}/`)) return '';
  return s.endsWith('/') ? s : `${s}/`;
}

// `typeof process` 那一层是给图册页的客户端包准备的（`catalogShared.ts` 会把这一份带进浏览器）。
const envBase = typeof process !== 'undefined' && process.env ? process.env.DEMO_IMAGE_BASE : '';
const DEMO_IMAGE_BASE = normalizeDemoImageBase(envBase) || DEFAULT_DEMO_IMAGE_BASE;

/** 一张纯色 SVG 的 data URI —— 不发请求，所以它是存储挂掉时唯一还在的东西。 */
const solid = (hex) => 'data:image/svg+xml;utf8,'
  + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9" preserveAspectRatio="none">`
    + `<rect width="16" height="9" fill="${hex}"/></svg>`);

/** 键 + 扩展名 → `{ file, url, fallback }`。文件名就是 `manager/assets/demo-images/` 里那一份。 */
const img = (key, ext, hex) => ({ file: `${key}.${ext}`, url: `${DEMO_IMAGE_BASE}${key}.${ext}`, fallback: solid(hex) });

/**
 * 键 → `{ file, url, fallback }`。键是**这张图在演示内容里干什么用**；文件名 = 键 + 扩展名，
 * 跟 `manager/assets/demo-images/` 逐个对得上（manager 那一侧的测试两向核这一份清单）。
 * 换一张图：换掉那个目录里的同名文件、改 CREDITS.md 那一行，这里不用动。
 */
const IMAGES = {
  'hero-bay':       img('hero-bay', 'webp', '#20293a'),        // 1600×1000
  'about-workshop': img('about-workshop', 'webp', '#2b3546'),  // 1600×1067

  // #1480 / #1496 —— hero 的「logos」那一排、logos 块要 6 个 logo；`.hro-logo` 的 `filter: invert` 在深底上把单色字标反白。
  'client-logo-1': img('client-logo-1', 'svg', '#1b2331'),
  'client-logo-2': img('client-logo-2', 'svg', '#1b2331'),
  'client-logo-3': img('client-logo-3', 'svg', '#1b2331'),
  'client-logo-4': img('client-logo-4', 'svg', '#1b2331'),
  'client-logo-5': img('client-logo-5', 'svg', '#1b2331'),
  'client-logo-6': img('client-logo-6', 'svg', '#1b2331'),
  // 演示生意自己的品牌字标（header / footer 四处共用一个）。四处的演示底色都是浅色 ⟹ 深色字。
  'brand-logo':    img('brand-logo', 'svg', '#1b2331'),

  // 头像：team 那六个人（男 女 男 女 男 女）也是 testimonials 前四条的头像，800×800、按人脸裁。
  'avatar-1': img('avatar-1', 'webp', '#3d4657'),
  'avatar-2': img('avatar-2', 'webp', '#41495b'),
  'avatar-3': img('avatar-3', 'webp', '#454e60'),
  'avatar-4': img('avatar-4', 'webp', '#495264'),
  'avatar-5': img('avatar-5', 'webp', '#4d5668'),
  'avatar-6': img('avatar-6', 'webp', '#515a6c'),

  // 1200×1200 方图（features 卡片 / gallery 方格 / 博客封面）。
  'work-1': img('work-1', 'webp', '#33405a'),
  'work-2': img('work-2', 'webp', '#374460'),
  'work-3': img('work-3', 'webp', '#3b4866'),
  'work-4': img('work-4', 'webp', '#3f4c6c'),
  'work-5': img('work-5', 'webp', '#435072'),
  'work-6': img('work-6', 'webp', '#475478'),
  // #1495 —— gallery 的瀑布流（grid + original）要**横竖都有**才看得出错落：横图 1600×1000、竖图 1067×1600。
  'work-wide-1': img('work-wide-1', 'webp', '#34405a'),
  'work-wide-2': img('work-wide-2', 'webp', '#38445e'),
  'work-tall-1': img('work-tall-1', 'webp', '#3c4862'),
  'work-tall-2': img('work-tall-2', 'webp', '#404c66'),
  'work-tall-3': img('work-tall-3', 'webp', '#44506a'),
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

/**
 * #1620 —— 把一份内容里**所有**以 `DEMO_IMAGE_BASE` 开头的地址换掉（深拷贝，不改入参）。
 * `toUrl(file)` 拿到文件名（`hero-bay.webp`），回新地址：示例站传「本环境前缀 + 文件名」，
 * 载荷没带前缀时传「一律占位图」。回 `{ value, replaced }`，`replaced` 是换了几处（建站日志打它）。
 * 🔴 按前缀换，不按键换：内容里的地址是 `imageUrl()` 在模块载入时拼好的字符串，键已经不在了。
 */
function rebaseDemoImages(value, toUrl) {
  let replaced = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.startsWith(DEMO_IMAGE_BASE)) return v;
      replaced += 1;
      return toUrl(v.slice(DEMO_IMAGE_BASE.length));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  const out = walk(value);
  return { value: out, replaced };
}

module.exports = { IMAGES, imageUrl, solid, DEMO_IMAGE_BASE, DEFAULT_DEMO_IMAGE_BASE, normalizeDemoImageBase, rebaseDemoImages };
