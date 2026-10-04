'use strict';
/**
 * description-fit.js — meta description 超长时由代码裁到上限（#1549 回修）。
 *
 * 为什么：#1549 的第 2 条「description 70–155 字」原来跟别的规则一样走「让 AI 重写一次，仍不合格就建站失败」。
 * 2026-10-04 Chris 第一次真 AI 建站（site-d84be95f）：6 页第一遍 description 全部 157–168 字，重写后首页仍 162 字，
 * 整站失败。超长是代码一刀就能裁的事，不该花一次 AI 调用、更不该让整站失败；该交给 AI 的只有「关键词不在 / 编造事实」
 * 这类代码改不了的。所以：检查之前先裁，裁完再查；裁不动（下限 70 以下）才留给重写。
 *
 * 裁法（按优先级）：
 *   1. 上限内最后一个句末标点（. ! ? 。！？）处截断，截完 ≥ 下限才用 —— 不把一句话腰斩；
 *   2. 否则上限内最后一个词边界（空格）或中文顿号 / 逗号 / 分号处截断；
 *   3. 否则（无空格的 CJK 长句）硬裁到上限。
 * 截断后去掉结尾悬着的逗号 / 顿号 / 分号 / 冒号 / 连字符。长度按码点数（跟 seo-problems.js 的 charLen 同一把尺）。
 */

const SENTENCE_END = /[.!?。！？]/;
const SOFT_BREAK = /[\s、，,；;]/;
const TRAILING_JUNK = /[\s,、，;；:：\-–—]+$/u;

const codePoints = (s) => [...String(s || '')];

function fitDescription(text, max = 155, min = 70) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const cps = codePoints(s);
  if (cps.length <= max) return s;
  const head = cps.slice(0, max);

  // 1. 句末标点
  for (let i = head.length - 1; i >= 0; i--) {
    if (SENTENCE_END.test(head[i])) {
      const cut = head.slice(0, i + 1).join('').trim();
      if (codePoints(cut).length >= min) return cut;
      break;
    }
  }
  // 2. 词边界 / 软断点
  for (let i = head.length - 1; i > 0; i--) {
    if (SOFT_BREAK.test(head[i])) {
      const cut = head.slice(0, i).join('').replace(TRAILING_JUNK, '');
      if (codePoints(cut).length >= min) return cut;
      break;
    }
  }
  // 3. 硬裁
  return head.join('').replace(TRAILING_JUNK, '');
}

/**
 * 就地裁一组页面的 description（首页的是 seo.siteDescription）。回裁过的 `[{ slug, before, after }]`，没裁的页不在里面。
 */
function fitPageDescriptions({ pages, seo }, max = 155, min = 70) {
  const changed = [];
  for (const page of pages || []) {
    if (!page || typeof page !== 'object') continue;
    const isHome = page.slug === 'home';
    const cur = isHome ? (seo && seo.siteDescription) : page.description;
    if (typeof cur !== 'string') continue;
    const before = codePoints(cur.replace(/\s+/g, ' ').trim()).length;
    if (before <= max) continue;
    const next = fitDescription(cur, max, min);
    if (isHome) seo.siteDescription = next; else page.description = next;
    changed.push({ slug: page.slug, before, after: codePoints(next).length });
  }
  return changed;
}

module.exports = { fitDescription, fitPageDescriptions };
