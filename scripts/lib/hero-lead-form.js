'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hero-lead-form.js — 建站时决定「这个站的第一屏要不要带一个能留联系方式的表单」（#1097）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-08-19 拍板：**跟着行业走**。上门服务类（水电 / 保洁 / 搬家 / 维修）第一屏要能留电话；
// 展示类（餐厅 / 画廊 / 诊所）第一屏要照片，不给。
//
// 🔴 #1333 起做法换了：把首页第一个 `hero` 块**换成另一个块类型** `hero-with-form`，而不是给它写
//    一个 `block_layout: "with-form"` 字段。带表单的首屏有自己的槽位（`data.form`）和自己的行为
//    （POST /api/leads），按设计文档 D1 / D14 那就是另一个块，不是 hero 的一种内容结构。
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

/** 带表单的首屏是这个块类型。权威是 `blocks/hero-with-form.json` 与 `src/lib/sections/registry.ts`。 */
const HERO_FORM_BLOCK = 'hero-with-form';

/**
 * 在内存里那份 content 上，把首页第一个 hero 块换成 `hero-with-form` —— 或者什么都不做。
 *
 * 就地改 `content`（调用方紧接着就把它写盘），返回一句给日志用的结论：
 *   { applied: boolean, reason: string }
 *
 * 🔴 `reason` 不是装饰。「这个站首屏没有表单」有三个完全不同的答案（行业不算上门 · 这一页没有
 * hero · 压根没有首页），它们在产物里长得一模一样。调用方必须把它打出来。
 *
 * 🔴 为什么要写 `data.form = {}`：`form` 是新块的**必填**槽位（`blocks/hero-with-form.json`），
 * 而 `validateSite` 第 ① 条按必填查。这条记录说的是「这个块有一个表单」；按钮文案和成功提示仍然
 * 各自可选，缺省时由 `HeroLeadForm` 自己那两句默认文案顶上 —— 也就是**渲染出来的字一个都没变**。
 * 文案本身不写在这里：库定义结构与槽，不定义内容（Chris 2026-08-13 的边界）。
 */
function applyHeroLeadForm({ content, industry }) {
  if (!isOnSiteIndustry(industry)) {
    return { applied: false, reason: `industry "${industry}" 不在上门服务那四组行业词里` };
  }

  const pages = Array.isArray(content && content.pages) ? content.pages : null;
  const home = pages && pages.find((p) => p && p.slug === 'home');
  if (!home) return { applied: false, reason: '行业算上门，但 content 里没有 slug === "home" 的页面' };

  const { blocks } = readPageBlocks(home, 'page "home"');
  const hero = blocks.find((b) => b && b.type === 'hero');
  if (!hero) return { applied: false, reason: '行业算上门，但首页里没有 hero 块' };

  hero.type = HERO_FORM_BLOCK;
  hero.data = { ...(hero.data || {}), form: { ...((hero.data && hero.data.form) || {}) } };
  return { applied: true, reason: `industry "${industry}" 算上门服务 ⟹ 首页第一个 hero 换成 ${HERO_FORM_BLOCK}` };
}

module.exports = { HERO_FORM_BLOCK, applyHeroLeadForm };
