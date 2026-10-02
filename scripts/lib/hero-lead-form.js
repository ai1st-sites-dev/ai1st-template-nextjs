'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hero-lead-form.js — 建站时决定「这个站的第一屏要不要带一个能留联系方式的表单」（#1097）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-08-19 拍板：**跟着行业走**。上门服务类（水电 / 保洁 / 搬家 / 维修）第一屏要能留电话；
// 展示类（餐厅 / 画廊 / 诊所）第一屏要照片，不给。
//
// 🔴 #1425（T3）起做法又换了一次：旧库那个单独的块类型 `hero-with-form`（#1333）随旧库删了，新库的 `hero`
//    自己就有表单 —— 槽 `form: { id? }`（选站级表单库里哪一张，空 = 第一张）+ 旋钮 `options.form`
//    （none | teaser | full，#1471）。所以这里不再换块类型，而是把首页第一个 hero 的 `options.form` 拧到
//    `full`、补一个空的 `form` 槽；排版仍由主题挑的那个 hero 形态决定（旋钮盖在形态的初值上，同 Puck 里拧旋钮）。
//
// 🔴 为什么它是一个自己的模块，而不是写在 `create-site.js` 里：`create-site.js` 没有
//    `module.exports`，而且文件末尾直接 `main()` —— require 它等于**跑一次建站**。所以写在那里的
//    逻辑没有任何测试碰得到，而本票的判据（212 个词两向零例外、不给表单的夹具逐字不变）全都是
//    「拿夹具走一遍这段逻辑」型的。同 `lib/homepage-recipe.js` 的分工。
//
// ── 两道判断，缺一不可 ──────────────────────────────────────────────────────────────────────────
//   ① 行业算不算上门 —— `industry-sectors.js` 的 `isOnSiteIndustry()`，判据是那 16 组既有词表
//      （本票不新造第二份行业词表），匹配按词边界（理由写在那个文件里：`retirement` 含着 `tire`）
//   ② 这一页真有一个 hero 块 —— AI 产出的页面结构不是硬保证，没有就什么都不做
//
// 🔴 #1333 删掉了中间那道「这个站抽到的主题给这种形态写过造型没有」（`theme.supports.hero` 含
//    `with-form`）。它当时的理由是「没写过造型就渲染出一个表单，等于把一个没人设计过的部件放到
//    客人网站的第一屏」—— 而排版从 #1318 起归 `public/shapes.css` 这一份平台文件，皮那一层按类名
//    写（`.hero__form`），两者都跟主题选了哪种画法无关。也就是说**任何主题都画得出**带表单的首屏，
//    这道判断挡掉的不再是「没造型」，只是「这个站运气不好」：它今天真的在挡人 —— 池里两套主题只有
//    azure-29 声明了它，上门行业的站抽到 ember-12 就拿不到首屏表单。
//
// 任何一道不过 ⟹ **什么都不做**（不换类型、不写任何字段）。也就是说不给表单的站，产出的字节跟本票
// 之前逐字相同 —— 这条是 AC6 在守的。

const { isOnSiteIndustry } = require('../theme-pipeline/industry-sectors');
const { readPageBlocks } = require('../blocks');

/** 首屏块。带不带表单是它的旋钮 `options.form`（`blocks/hero/manifest.json`），不是另一个块类型。 */
const HERO_BLOCK = 'hero';
/** 「整张表单」那一档（`blocks/hero/manifest.json` 的 `slots.options.knobs` 里 `form` 的取值之一）。 */
const FORM_FULL = 'full';

/**
 * 在内存里那份 content 上，让首页第一个 hero 带上整张表单（`options.form: "full"`）—— 或者什么都不做。
 *
 * 就地改 `content`（调用方紧接着就把它写盘），返回一句给日志用的结论：
 *   { applied: boolean, reason: string }
 *
 * 🔴 `reason` 不是装饰。「这个站首屏没有表单」有**四**个完全不同的答案（#1346 起多了「这个块被
 * 后台停用了」；另外三个是：行业不算上门 · 这一页没有 hero · 压根没有首页），它们在产物里长得
 * 一模一样。调用方必须把它打出来。
 *
 * 📌 写一个空的 `data.form = {}`：槽是 `{ id? }`，空 = 站级表单库里的第一张（#1471）。表单的字段、按钮文案
 * 都住在 `site/<locale>/forms.json`，不写在这里：库定义结构与槽，不定义内容（Chris 2026-08-13 的边界）。
 */
function applyHeroLeadForm({ content, industry, disabledBlocks = [] }) {
  // #1346 —— 后台把 `hero` 关掉了就什么都不做（#1425 之前判的是单独那个 `hero-with-form` 块）。
  //
  // 🔴 **这一处不在菜单那条路上，所以剔菜单管不到它。** 它是脚本自己硬插的一块：跑在两次
  //    `validateBlocks` 之后、也不经 AI 提示词，跟 `writeSiteConfig` 里那个 `contact-form`
  //    （TICKET-268b/268e）是同一类。少这一处的坏法很具体：后台关掉 `hero-with-form`、后台那一页
  //    照样把它列出来可以关（`catalog_admin.go` 从 `blocks/<块>/manifest.json` 列全部 32 个），而每一个
  //    上门服务行业的新站首屏**照样是它** —— 开关看着生效了，产物里没有。
  //
  // 🔴 这条判断放在**最前面**：下面那三条 `reason` 各自说的是「为什么这个站首屏没有表单」，而
  //    「这个块被关了」是一个跟行业/页面结构无关的答案，混进那三条里读日志的人分不开。
  if (Array.isArray(disabledBlocks) && disabledBlocks.includes(HERO_BLOCK)) {
    return { applied: false, reason: `${HERO_BLOCK} 在后台被停用了 ⟹ 首页没有 hero 可带表单` };
  }
  if (!isOnSiteIndustry(industry)) {
    return { applied: false, reason: `industry "${industry}" 不在上门服务那四组行业词里` };
  }

  const pages = Array.isArray(content && content.pages) ? content.pages : null;
  const home = pages && pages.find((p) => p && p.slug === 'home');
  if (!home) return { applied: false, reason: '行业算上门，但 content 里没有 slug === "home" 的页面' };

  const { blocks } = readPageBlocks(home, 'page "home"');
  const hero = blocks.find((b) => b && b.type === 'hero');
  if (!hero) return { applied: false, reason: '行业算上门，但首页里没有 hero 块' };

  const data = hero.data || {};
  const options = data.options && typeof data.options === 'object' && !Array.isArray(data.options) ? data.options : {};
  hero.data = { ...data, options: { ...options, form: FORM_FULL }, form: { ...((data.form && typeof data.form === 'object') ? data.form : {}) } };
  return { applied: true, reason: `industry "${industry}" 算上门服务 ⟹ 首页第一个 hero 的 options.form = ${FORM_FULL}` };
}

module.exports = { HERO_BLOCK, FORM_FULL, applyHeroLeadForm };
