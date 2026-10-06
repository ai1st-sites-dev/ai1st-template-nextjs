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
 *
 * 🔴 #1549 r4（Chris 2026-10-06）：**提示词给目标，检查只拦底线** —— 两个区间。
 *    目标区间（§descriptionRange，中日韩 50–80 / 其余 70–155）：写进提示词、裁的落点、补的落点。
 *    底线区间（§descriptionAccept，中日韩 20–200 / 其余 40–300）：seo-problems.js 第 2 条只在它外面才报；超过它的上限才裁。
 *    起因：同日两个真 AI 中文站第一稿 description 10/11、14/14 页落在 24–49 字，全部被打回修补一次 —— 这些都能用（Google
 *    本来就截长、也常换成自己挑的正文），第一稿写 40 字对搜索结果没有区别；问题是检查跟提示词用了同一个区间。
 *    Chris 原话：「你可以要求 AI 写 50 到 80 之间，然后你可以设置 validator 成 200 以内也没有问题」。
 */

const SENTENCE_END = /[.!?。！？]/;
const SOFT_BREAK = /[\s、，,；;]/;
const TRAILING_JUNK = /[\s,、，;；:：\-–—]+$/u;

const codePoints = (s) => [...String(s || '')];

// ── 长度区间（按主语言）──────────────────────────────────────────────────────────────────────────

const RANGE_LATIN = Object.freeze({ min: 70, max: 155 });
const RANGE_CJK = Object.freeze({ min: 50, max: 80 });
const ACCEPT_LATIN = Object.freeze({ min: 40, max: 300 });
const ACCEPT_CJK = Object.freeze({ min: 20, max: 200 });
const isCjkLocale = (locale) => /^(zh|ja|ko)\b/i.test(String(locale || ''));

/** 目标区间（按主语言）：中 / 日 / 韩 ⟹ 50–80，其余（含没传）⟹ 70–155。提示词、裁的落点、补的落点用它。 */
function descriptionRange(locale) {
  return isCjkLocale(locale) ? RANGE_CJK : RANGE_LATIN;
}

/** 底线区间（按主语言）：中 / 日 / 韩 ⟹ 20–200，其余 ⟹ 40–300。检查只在它外面才报；超过它的上限才裁（#1549 r4）。 */
function descriptionAccept(locale) {
  return isCjkLocale(locale) ? ACCEPT_CJK : ACCEPT_LATIN;
}

/** 提示词里的说法，单位按那种语言说：「50–80 个汉字」/「50–80 文字」/「50–80자」/「70–155 characters」。数字是目标区间。 */
function descriptionSpec(locale) {
  const { min, max } = descriptionRange(locale);
  const l = String(locale || '').toLowerCase();
  if (/^zh\b/.test(l)) return `${min}–${max} 个汉字 (Chinese characters)`;
  if (/^ja\b/.test(l)) return `${min}–${max} 文字 (characters)`;
  if (/^ko\b/.test(l)) return `${min}–${max}자 (characters)`;
  return `${min}–${max} characters`;
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
 * #1549 r4：只裁**超过底线上限**的（§descriptionAccept），裁到目标上限；目标上限与底线上限之间的照原样留着。
 */
function fitPageDescriptions({ pages, seo, locale }) {
  const { max } = descriptionAccept(locale);
  const changed = [];
  for (const page of pages || []) {
    if (!page || typeof page !== 'object') continue;
    const isHome = page.slug === 'home';
    const cur = isHome ? (seo && seo.siteDescription) : page.description;
    if (typeof cur !== 'string') continue;
    const before = codePoints(cur.replace(/\s+/g, ' ').trim()).length;
    if (before <= max) continue;
    // 触发看底线上限（上面），落点是目标区间 —— 两个不同的数，显式传，不吃默认值（PM 2026-10-06 裁）
    const { max: toMax, min: toMin } = descriptionRange(locale);
    const next = fitDescription(cur, { locale, max: toMax, min: toMin });
    if (isHome) seo.siteDescription = next; else page.description = next;
    changed.push({ slug: page.slug, before, after: codePoints(next).length });
  }
  return changed;
}

/**
 * description 末尾补上地点（#1549 重开：重写一次后仍缺地点时由代码补，跟长度一样是代码能补的）。
 * 中 / 日 / 韩主语言用「｜」，其余用「 | 」；正文结尾的句末标点先去掉。补完会超上限 ⟹ 先把正文裁短再补，地点永远不被裁掉。
 * 区间按主语言取**底线区间**（§descriptionAccept，跟检查同一把尺；#1549 r4 PM 裁：用目标上限会把一段已经合格的 150 字描述
 * 平白裁短）。已含地点由调用方判（它手上有跟检查同一把尺的 hasPhrase）。
 * 🔴 #1603：从尾部裁会把句末的目标词一起裁掉（中文把目标词放句末很自然；补地点前 fitPageDescriptions 刚把长度裁到贴着上限），
 *    补完第 2 条「含目标词」那一半就开火 ⟹ 首页 / 服务页整站 fatal。传 `keep`（这段文字还含不含目标词，调用方用跟检查同一个
 *    hasPhrase 造）⟹ 尾部裁会丢掉它时改成裁它**前面**的正文（§keepPhrase）。判定由调用方传进来，是因为 seo-problems.js 已经
 *    require 了本文件，反过来 require 会成环。
 */
function appendPlace(text, place, locale, { keep } = {}) {
  const p = String(place || '').trim();
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (!p) return body;
  const sep = placeSeparator(locale);
  const tail = `${sep}${p}`;
  let head = strip(body);
  if (!head) return p;
  const { max, min } = descriptionAccept(locale);
  const room = max - codePoints(tail).length;
  if (codePoints(head).length > room) {
    const lo = Math.max(min - codePoints(tail).length, 0);
    const cut = strip(fitDescription(head, { max: Math.max(room, 1), min: lo }));
    head = keep && keep(head) && !keep(cut) ? (keepPhrase(head, keep, room, lo, locale) ?? cut) : cut;
  }
  return head ? `${head}${tail}` : p;
}

const placeSeparator = (locale) => (isCjkLocale(locale) ? '｜' : ' | ');
const strip = (s) => s.replace(/[.!?。！？]+$/u, '').replace(TRAILING_JUNK, '');

/**
 * 留下目标词（`keep` 为真的最短那一段，到它为止），裁它前面的正文，用逗号接回去：「…经验丰富，烫发设计」。目标词之后的字丢掉
 * —— 走到这里说明目标词就在正文尾部，后面本来没几个字。目标词自己都塞不进 `room` ⟹ null（调用方照旧从尾部裁；
 * 那种页第 2 条地点那一半本来就不判，§placeFits）。
 */
function keepPhrase(head, keep, room, min, locale) {
  const cps = codePoints(head);
  let i = cps.length - 1;
  while (i > 0 && !keep(cps.slice(i).join(''))) i -= 1;
  let j = i + 1;
  while (j < cps.length && !keep(cps.slice(i, j).join(''))) j += 1;
  const phrase = cps.slice(i, j).join('').trim();
  if (codePoints(phrase).length > room) return null;
  const joiner = isCjkLocale(locale) ? '，' : ', ';
  const budget = room - codePoints(phrase).length - codePoints(joiner).length;
  const before = budget > 0 ? strip(fitDescription(cps.slice(0, i).join(''), {
    max: budget, min: Math.max(min - codePoints(phrase).length - codePoints(joiner).length, 0) })) : '';
  return before ? `${before}${joiner}${phrase}` : phrase;
}

/**
 * 「目标词 + 分隔符 + 地点」塞得进主语言的上限吗（#1603）。塞不进（地点是一长串没逗号的地址、或目标词本身很长）⟹ 第 2 条
 * 「含地点」那一半不判、建站不拦，create-site 打一行日志说明 —— 跟子页 title 预算 < 20 时长度那一半不判同一个处置
 * （§seo-problems.js MIN_PAGE_TITLE_BUDGET）：输入是用户填的，AI 和代码都做不到的要求不该让整站失败。
 */
function placeFits(place, keyword, locale) {
  const p = String(place || '').trim();
  if (!p) return true;
  // #1549 r4：底线上限（§descriptionAccept）—— 判的是「塞不塞得进检查的上限」，跟检查同一把尺（PM 2026-10-06 裁）
  return codePoints(String(keyword || '').trim()).length + codePoints(`${placeSeparator(locale)}${p}`).length <= descriptionAccept(locale).max;
}

module.exports = { fitDescription, fitPageDescriptions, appendPlace, placeFits, descriptionRange, descriptionAccept, descriptionSpec };
