'use strict';

// search-result.js —— 一页在搜索结果里的标题 / 描述「多长算合适」（#1945）。纯函数、只依赖两份不碰文件系统的东西
// （`seo-limits.json`、`description-fit.js`），所以浏览器（编辑器 Website settings 的 Search result 组）能直接 import。
//
// 🔴 建站检查（`seo-problems.js` 第 1 / 2 条）用的是同一份：§pageTitleBudget 在本文件导出、`seo-problems.js` 原样再导出 ——
//    `seo-problems.js` 顶上读块清单（文件系统），浏览器 import 不了它，判据又只许有一份。
//    编辑器这里**只提示、不拦存**（跟 GET FOUND 页同一把尺）：超了照样存得下去。

const { titleMax: TITLE_MAX } = require('./seo-limits.json');
const { descriptionRange, descriptionAccept } = require('./description-fit.js');

const SUFFIX = ' | ';
/** 子页 page.title 的预算 < 20 ⟹ 长度那一半不判（品牌名是用户填的，#1549 正文做什么 4）。 */
const MIN_PAGE_TITLE_BUDGET = 20;
/** 字数按码点（一个汉字 / emoji 算一个），同 `seo-problems.js` 的 charLen。 */
const charLen = (s) => [...String(s || '')].length;

/** 子页 `page.title` 最多几个字：60 − 3 − 品牌名字数（浏览器标签和搜索结果里显示成 `<title> | <网站名>`）。 */
function pageTitleBudget(brandName) {
  return TITLE_MAX - charLen(SUFFIX) - charLen(brandName);
}

/**
 * 标题提示。首页：标题本身 ≤ TITLE_MAX（首页不加 ` | 网站名`）。子页：≤ §pageTitleBudget；预算 < MIN_PAGE_TITLE_BUDGET 时不判长度。
 * @returns {{ length: number, max: number | null, over: boolean, shown: string }} `shown` = 浏览器标签里那一整行。
 */
function titleHint({ title, brandName, home }) {
  const length = charLen(title);
  if (home) return { length, max: TITLE_MAX, over: length > TITLE_MAX, shown: String(title || '') };
  const budget = pageTitleBudget(brandName);
  const max = budget >= MIN_PAGE_TITLE_BUDGET ? budget : null;
  return { length, max, over: max !== null && length > max, shown: `${title || ''}${SUFFIX}${brandName || ''}` };
}

/**
 * 描述提示：目标区间（§descriptionRange）是提示的数；只有落在底线区间（§descriptionAccept）**外面**才算 `outside`（标红）。
 * 空的不标红：空 = 这一页不写描述（键删掉），是老板自己的选择。
 * @returns {{ length: number, target: {min: number, max: number}, outside: boolean }}
 */
function descriptionHint({ description, locale }) {
  const length = charLen(description);
  const accept = descriptionAccept(locale);
  return { length, target: descriptionRange(locale), outside: length > 0 && (length < accept.min || length > accept.max) };
}

module.exports = { TITLE_MAX, SUFFIX, MIN_PAGE_TITLE_BUDGET, charLen, pageTitleBudget, titleHint, descriptionHint };
