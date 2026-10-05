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
 *
 * 🔴 #1549 重开（Chris 2026-10-05 两次真 AI 建中文站）：长度区间按站的**主语言**取 —— 中 / 日 / 韩 ⟹ 50–80 字，其余 70–155。
 *    70–155 是按英文推出来的：中文描述 54–63 字就是正常长度（Google 中文结果约显示 70–80 字），按 70 下限 17/17 页第一遍
 *    全报「太短」、全部重写一次。检查（seo-problems.js 第 2 条）、这里的裁和补、发给 AI 的提示词都只从 §descriptionRange
 *    取数 —— 它只认 locale、不看文字本身。
 *    r3：r2 曾让检查按「这段文字的字母里 CJK 是否过半」判、提示词按主语言给，两把尺在「中文描述夹英文目标词 / 品牌名」时
 *    分叉（提示词说 50–80，检查要 70–155，重写必不收敛 ⟹ 整站失败；QA1 / QA2 2026-10-05 两臂实测）。只查主语言的页，
 *    主语言就是这段文字该用的语言，所以按 locale 判是同一件事、且提示词写之前就知道。
 */

const SENTENCE_END = /[.!?。！？]/;
const SOFT_BREAK = /[\s、，,；;]/;
const TRAILING_JUNK = /[\s,、，;；:：\-–—]+$/u;

const codePoints = (s) => [...String(s || '')];

// ── 长度区间（按主语言）──────────────────────────────────────────────────────────────────────────

const RANGE_LATIN = Object.freeze({ min: 70, max: 155 });
const RANGE_CJK = Object.freeze({ min: 50, max: 80 });
const isCjkLocale = (locale) => /^(zh|ja|ko)\b/i.test(String(locale || ''));

/** 主语言的 description 长度区间：中 / 日 / 韩 ⟹ 50–80，其余（含没传）⟹ 70–155。检查、裁、补、提示词共用这一个。 */
function descriptionRange(locale) {
  return isCjkLocale(locale) ? RANGE_CJK : RANGE_LATIN;
}

/** 提示词里的说法：「70–155 chars」/「50–80 chars」。 */
function descriptionSpec(locale) {
  const { min, max } = descriptionRange(locale);
  return `${min}–${max} chars`;
}

// ── 裁 ────────────────────────────────────────────────────────────────────────────────────────

/** max / min 不传 ⟹ 按主语言取（§descriptionRange）。 */
function fitDescription(text, { locale, max, min } = {}) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const range = descriptionRange(locale);
  if (max === undefined) max = range.max;
  if (min === undefined) min = range.min;
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
function fitPageDescriptions({ pages, seo, locale }) {
  const { max } = descriptionRange(locale);
  const changed = [];
  for (const page of pages || []) {
    if (!page || typeof page !== 'object') continue;
    const isHome = page.slug === 'home';
    const cur = isHome ? (seo && seo.siteDescription) : page.description;
    if (typeof cur !== 'string') continue;
    const before = codePoints(cur.replace(/\s+/g, ' ').trim()).length;
    if (before <= max) continue;
    const next = fitDescription(cur, { locale });
    if (isHome) seo.siteDescription = next; else page.description = next;
    changed.push({ slug: page.slug, before, after: codePoints(next).length });
  }
  return changed;
}

/**
 * description 末尾补上地点（#1549 重开：重写一次后仍缺地点时由代码补，跟长度一样是代码能补的）。
 * 中 / 日 / 韩主语言用「｜」，其余用「 | 」；正文结尾的句末标点先去掉。补完会超上限 ⟹ 先把正文裁短再补，地点永远不被裁掉。
 * 区间按主语言取（§descriptionRange，跟检查同一个）。已含地点由调用方判（它手上有跟检查同一把尺的 hasPhrase）。
 */
function appendPlace(text, place, locale) {
  const p = String(place || '').trim();
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (!p) return body;
  const sep = isCjkLocale(locale) ? '｜' : ' | ';
  const tail = `${sep}${p}`;
  const strip = (s) => s.replace(/[.!?。！？]+$/u, '').replace(TRAILING_JUNK, '');
  let head = strip(body);
  if (!head) return p;
  const { max, min } = descriptionRange(locale);
  const room = max - codePoints(tail).length;
  if (codePoints(head).length > room) head = strip(fitDescription(head, { max: Math.max(room, 1), min: Math.max(min - codePoints(tail).length, 0) }));
  return head ? `${head}${tail}` : p;
}

module.exports = { fitDescription, fitPageDescriptions, appendPlace, descriptionRange, descriptionSpec };
