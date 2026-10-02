// #1346 —— 关键词页那一通（Call 2）提示词里的「这一页可以放哪些块」清单。
//
// 🔴 它为什么住在这里而不是留在 `create-site.js` 的模板字符串里：**那份清单是写死的块名**，而后台
// 关掉一个块之后它必须整条消失、后面的编号跟着重排。`create-site.js` 没有单测（它一被 require 就
// 跑 main()、等 stdin），所以留在原地的话这段逻辑没有任何东西看得见 —— 同 `homepage-recipe.js` 里
// `afterRetry` / `tryHomepageRecipe` 抽出来的理由（那两个函数的注释写着同一句话）。
//
// 🔴 **什么都没关掉时印出来的字节，跟 #1346 之前那五条写死的散文逐字相同** —— 只差 #1419 删掉的
// 形态清单（每条列的那串形态名、`data` 里那个形态字段：22 个名字有 19 个磁盘上不存在，而 AI 写的
// 那个字段没有人读，形态归取值链）。那是这个文件唯一的风险面：提示词变了，AI 吐的东西
// 就会变，而那是花钱才能测的东西。判据在 `scripts/lib/keyword-page-options.test.js` 第 ① 格
// （拿基线上 `create-site.js` 里那段原文比，差异逐条登记在那份文件里），不是靠人眼看。

'use strict';

// 📌 #1425（T3）—— 五条全部换成新库（旧库随本票删了）。逐条去处（票正文做什么 16）：
//    page-header → page-header（正名；🔴 新块**不读** `data.breadcrumbs`，面包屑按页面路径算，manifest 自己写着
//                  "do NOT write breadcrumbs" ⟹ 那行说明和 `hasServiceDetailPages` 入参一起删）
//    text-block  → content（槽 `headline?` · `body`）
//    card-group OR process-steps → features，**交替保留**：一页写卖点、下一页写步骤（步骤写法逐字是 features 的
//                  manifest 自己教 AI 的那一句，`prompt.lines` 第 3 行）。`features?: [string]` 这一维 #1527 已补，名字是 `bullets`（`items[].bullets?: [string]`）。
//    faq-accordion → faq（槽同为 `items: [{question, answer}]`）
//    cta-banner  → cta（`button` → `ctas: [{label, href}]`，`description` → `body`）
// 每条的 `data` 说明照继任块 manifest 的槽名写，不照抄旧块那行。

/**
 * @param {object}   opts
 * @param {string[]} opts.disabledBlocks         后台关掉的块
 * @returns {string} 编号好的清单，直接插进提示词
 */
function keywordPageSectionOptions({ disabledBlocks = [] } = {}) {
  const off = new Set((disabledBlocks || []).filter((t) => typeof t === 'string' && t));

  /** @type {[string, string][]} 每条 = [这一条讲的是哪个块, 正文（不带编号）] */
  const entries = [
    ['page-header', `"page-header" (REQUIRED first)
   data: { headline, subheadline? }`],
    ['content', `"content" (REQUIRED, 2-3 paragraphs of unique SEO content)
   data: { headline?, body (2-3 paragraphs) }`],
    ['features', `"features" (REQUIRED) — alternate between pages: on one page write selling points (items without numbers), on the next write the steps of how the service works (for step-by-step content give every item a number ("01", "02" …) and set options.itemConnector to "line")
   data: { headline, body?, items: [{title, text, bullets?: [string]}], options? }`],
    ['faq', `"faq" (REQUIRED, 3-4 questions)
   data: { headline, items: [{question, answer}] }`],
    ['cta', `"cta" (REQUIRED last)
   data: { headline, body, ctas: [{label, href}] }`],
  ];

  return entries
    .filter(([type, text]) => text && !off.has(type))
    .map(([, text], i) => `${i + 1}. ${text}`)
    .join('\n');
}

module.exports = { keywordPageSectionOptions };
