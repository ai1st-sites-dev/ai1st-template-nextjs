'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hero-lead-form.js — 建站时决定「这个站的第一屏要不要带一个能留联系方式的表单」（#1097）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-08-19 拍板：**跟着行业走**。上门服务类（水电 / 保洁 / 搬家 / 维修）第一屏要能留电话；
// 展示类（餐厅 / 画廊 / 诊所）第一屏要照片，不给。
//
// 引擎那一半 #1065 已经落地：页面 JSON 的 hero 块写 `block_layout: "with-form"` ⟹
// `HeroSection.tsx` 渲染 `<HeroLeadForm>`（那一行的判据就是 `block?.block_layout === 'with-form'`）。
// 缺的只有「谁来决定写不写它」—— AI 建站从来不写这个字段（本票之前 `create-site.js` 里
// `block_layout` 命中 0），所以没有一个真实客人站拿得到带表单的首屏。这个文件补的就是那个决定。
//
// 🔴 为什么它是一个自己的模块，而不是写在 `create-site.js` 里：`create-site.js` 没有
//    `module.exports`，而且文件末尾直接 `main()` —— require 它等于**跑一次建站**。所以写在那里的
//    逻辑没有任何测试碰得到，而本票的判据（212 个词两向零例外、不给表单的夹具逐字不变）全都是
//    「拿夹具走一遍这段逻辑」型的。同 `lib/homepage-recipe.js` 的分工。
//
// ── 三道判断，缺一不可 ──────────────────────────────────────────────────────────────────────────
//   ① 行业算不算上门 —— `industry-sectors.js` 的 `isOnSiteIndustry()`，判据是那 16 组既有词表
//      （本票不新造第二份行业词表），匹配按词边界（理由写在那个文件里：`retirement` 含着 `tire`）
//   ② 这个站抽到的主题给这种形态写过造型没有 —— `theme.supports.hero` 含 `with-form`。**承重**：
//      没写过造型就渲染出一个表单，等于把一个没人设计过的部件放到客人网站的第一屏。今天 80 套里
//      只有 10 套声明了它，而上门那四组里只有 home-trades / auto-transport 各摊到一套 ⟹ 真实
//      建站里「行业算上门但这一支拦下来」是**常态**，不是边界情况。
//   ③ 这一页真有一个 hero 块 —— AI 产出的页面结构不是硬保证，没有就什么都不做。
//
// 任何一道不过 ⟹ **不写这个字段**（不是写空串、不是写别的值）。也就是说不给表单的站，产出的
// 字节跟本票之前逐字相同 —— 这条是 AC6 在守的。

const { isOnSiteIndustry } = require('../theme-pipeline/industry-sectors');
const { readPageBlocks } = require('../blocks');

/** 页面 JSON 里那个值。取值清单的权威在 `blocks/hero.json` 的 manifest，那里也列着它。 */
const HERO_FORM_LAYOUT = 'with-form';

/**
 * 这套主题声明过它给「带表单的 hero」写了造型吗？
 *
 * 🔴 读不到 `supports.hero`（主题查不到 / 没有这个键 / 不是数组）一律当**没有**。fail-safe 的方向
 * 是不给：多给一个表单是把没造型的部件推到客人首屏，少给一个是回到今天的样子。
 */
function themeSupportsHeroForm(theme) {
  const forms = theme && theme.supports && theme.supports.hero;
  return Array.isArray(forms) && forms.includes(HERO_FORM_LAYOUT);
}

/**
 * 在内存里那份 content 上，给首页第一个 hero 块写上 `block_layout: "with-form"` —— 或者什么都不做。
 *
 * 就地改 `content`（调用方紧接着就把它写盘），返回一句给日志用的结论：
 *   { applied: boolean, reason: string }
 *
 * 🔴 `reason` 不是装饰。「这个站首屏没有表单」有四个完全不同的答案（行业不算上门 · 主题没写造型 ·
 * 这一页没有 hero · 压根没有首页），它们在产物里长得一模一样 —— 而承重的那一支（②）恰恰是最容易
 * 被误读成「新代码没生效」的那个。调用方必须把它打出来。
 */
function applyHeroLeadForm({ content, industry, theme }) {
  if (!isOnSiteIndustry(industry)) {
    return { applied: false, reason: `industry "${industry}" 不在上门服务那四组行业词里` };
  }
  if (!themeSupportsHeroForm(theme)) {
    const declared = theme && theme.supports && theme.supports.hero;
    return {
      applied: false,
      reason: `行业算上门，但这个站抽到的主题没声明 supports.hero 含 "${HERO_FORM_LAYOUT}"`
        + `（它声明的是 ${JSON.stringify(declared === undefined ? null : declared)}）`,
    };
  }

  const pages = Array.isArray(content && content.pages) ? content.pages : null;
  const home = pages && pages.find((p) => p && p.slug === 'home');
  if (!home) return { applied: false, reason: '行业算上门、主题也支持，但 content 里没有 slug === "home" 的页面' };

  const { blocks } = readPageBlocks(home, 'page "home"');
  const hero = blocks.find((b) => b && b.type === 'hero');
  if (!hero) return { applied: false, reason: '行业算上门、主题也支持，但首页里没有 hero 块' };

  hero.block_layout = HERO_FORM_LAYOUT;
  return { applied: true, reason: `industry "${industry}" 算上门服务，主题声明了 supports.hero 含 "${HERO_FORM_LAYOUT}"` };
}

module.exports = { HERO_FORM_LAYOUT, themeSupportsHeroForm, applyHeroLeadForm };
