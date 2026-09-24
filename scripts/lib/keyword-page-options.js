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

/**
 * @param {object}   opts
 * @param {boolean}  opts.hasServiceDetailPages  这个站有没有服务详情页（决定面包屑那句话）
 * @param {string[]} opts.disabledBlocks         后台关掉的块
 * @returns {string} 编号好的清单，直接插进提示词
 */
function keywordPageSectionOptions({ hasServiceDetailPages = false, disabledBlocks = [] } = {}) {
  const off = new Set((disabledBlocks || []).filter((t) => typeof t === 'string' && t));
  const breadcrumbs = hasServiceDetailPages
    ? '[{label:"Home", href:"/"}, {label:"<Service>", href:"<the breadcrumb middle level given for THIS page above — omit the href field entirely when it says NO LINK>"}, {label:"<Page Title>"}]'
    : '[{label:"Home", href:"/"}, {label:"<Page Title>"}]  ← EXACTLY TWO LEVELS. This site has no service detail pages, so there is no middle level to link to. Do NOT invent one.';

  // 「A OR B」那一格：两个都在就照原话；只剩一个就写成那一个 —— 留着「OR」会点名一个已经不存在的
  // 选项，而模型照着它写出来的块正是这一步要拿掉的那个。
  const pair = ['card-group', 'process-steps'].filter((t) => !off.has(t));
  const pairLines = pair.length ? [
    pair.length === 2
      ? '"card-group" OR "process-steps" (pick one per page, alternate between pages)'
      : `"${pair[0]}" (use it on every page)`,
    ...(pair.includes('card-group') ? ['   card-group data: { headline, subheadline?, items: [{title, description?, features?: [string]}] }'] : []),
    ...(pair.includes('process-steps') ? ['   process-steps data: { headline, steps: [{title, description}] }'] : []),
  ].join('\n') : '';

  /** @type {[string, string][]} 每条 = [这一条讲的是哪个块, 正文（不带编号）] */
  const entries = [
    ['page-header', `"page-header" (REQUIRED first)
   data: { title, subtitle?, breadcrumbs: ${breadcrumbs} }`],
    ['text-block', `"text-block" (REQUIRED, 2-3 paragraphs of unique SEO content)
   data: { headline?, content (2-3 paragraphs), items?: [string] }`],
    [pair.length ? pair[0] : 'card-group', pairLines],
    ['faq-accordion', `"faq-accordion" (REQUIRED, 3-4 questions)
   data: { headline, items: [{question, answer}] }`],
    ['cta-banner', `"cta-banner" (REQUIRED last)
   data: { headline, description, button: {label, href} }`],
  ];

  return entries
    .filter(([type, text]) => text && !off.has(type))
    .map(([, text], i) => `${i + 1}. ${text}`)
    .join('\n');
}

module.exports = { keywordPageSectionOptions };
