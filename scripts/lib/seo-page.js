'use strict';
// #1938 —— 一页 SEO 的收尾（检查 + 代码补地点 + 代码裁 title），建站（create-site.js §seoPass）和编辑之后的自动重写
// （lib/seo-refresh.js）共用这一份。原来 seoTargetOf / seoCheckPage / seoAppendPlace 住在 create-site.js 里，逐字搬过来，
// 只把 create-site 那个 `debug` 换成参数 `log`（不给 = 不打）。
//
// `content` 是 create-site 手上那种形状：{ pages: [...], seo: <seo.json>, brand: <brand.json> }。

const { seoProblems, rulesFor: seoRulesFor, missingPhrases, sitePlace, hasPhrase, pageTitleBudget, brandNameOf, MIN_PAGE_TITLE_BUDGET } = require('./seo-problems');
const { appendPlace, placeFits, descriptionAccept } = require('./description-fit');
const { titleMax: TITLE_MAX } = require('./seo-limits.json');

const noop = () => {};

/** 一页的目标词（T4 #1548 挂在 `page.seo.targetKeyword`）。 */
function seoTargetOf(page) {
  return page && page.seo && typeof page.seo.targetKeyword === 'string' ? page.seo.targetKeyword : '';
}

// #1593 —— 第二语言 SEO 检查看的地点（第 2 条「含地点」）。建站表格里 `location` 是 Google Ads 的英文地名，`locationLocalized`
// 是主语言的译名（#1569）：英文第二语言 ⟹ 用 `location`；别的第二语言手上没有它那种语言的地名 ⟹ 「含地点」那一半不判
// （不让代码把英文地名补进一句中文 description 的末尾）。
function secondarySeoPayload(payload, locale) {
  if (/^en\b/i.test(locale)) return { ...payload, locationLocalized: '' };
  return { ...payload, location: '', locationLocalized: '' };
}

/** 一页的 seoProblems + 日志一行（`[seo] 检查 <slug> · …`）。 */
function seoCheckPage({ page, content, payload, locale, tag = '检查', who = '[seo]', log = noop }) {
  const kw = seoTargetOf(page);
  const problems = seoProblems({ page, pages: content.pages, targetKeyword: kw, brand: content.brand, payload, locale, seo: content.seo });
  log(`${who} ${tag} ${page.slug} · 目标词 ${kw ? `「${kw}」` : '（无）'} · 跑了第 ${seoRulesFor(kw).join('/')} 条 · `
    + (problems.length ? `${problems.length} 条问题：\n    ${problems.join('\n    ')}` : '0 条问题'));
  // #1603 —— 地点那一半不判时要响：每页只在第一遍检查时说一次（seoProblems 是纯函数，不打日志）。
  const place = sitePlace(payload);
  if (tag === '检查' && kw && place && !placeFits(place, kw, locale)) {
    log(`${who} 不补地点 ${page.slug}：目标词「${kw}」${[...kw].length} 字 + 分隔符 + 地点「${place}」${[...place].length} 字 `
      + `已超过 description 底线上限 ${descriptionAccept(locale).max} 字 ⟹ 第 2 条「含地点」那一半不判、建站不拦`);
  }
  return problems;
}

/** 缺地点由代码补在 description 末尾（#1549 重开；#1603 补的时候不裁掉目标词）。补了回 true。 */
function seoAppendPlace({ page, content, payload, locale, when = '', who = '[seo]', log = noop }) {
  const kw = seoTargetOf(page);
  if (!missingPhrases({ page, targetKeyword: kw, payload, seo: content.seo, locale }).some((m) => m.what === 'place')) return false;
  const place = sitePlace(payload);
  const isHome = page.slug === 'home';
  const next = appendPlace(isHome ? content.seo.siteDescription : page.description, place, locale, { keep: (s) => hasPhrase(s, kw) });
  if (isHome) content.seo.siteDescription = next; else page.description = next;
  log(`${who} ${when}补地点 ${page.slug}：「${place}」→ ${[...next].length} 字（代码补，不叫 AI）`);
  return true;
}

// #1549 做什么 4 —— 子页 `page.title` 的长度要求，提示词和 seoProblems 第 1 条用同一个数（60 − 3 − 品牌名字数）。
// 预算 < 20（品牌名 ≥ 38 字）时检查那一侧不判长度，提示词这一侧也不给一个做不到的数。
function pageTitleSpec(brandName) {
  const budget = pageTitleBudget(brandName);
  const tail = `" | ${brandName}" is appended automatically — do not add it yourself`;
  return budget >= MIN_PAGE_TITLE_BUDGET ? `max ${budget} chars; ${tail}` : `as short as possible; ${tail}`;
}

/** 这一页的 title 最多几个字：首页（`seo.siteTitle` 原样当 <title>）60；子页 60 − " | " − 品牌名（§pageTitleBudget）。 */
function titleBudgetOf(page, brand, locale) {
  return page && page.slug === 'home' ? TITLE_MAX : pageTitleBudget(brandNameOf(brand, locale));
}

const TITLE_BREAK = /[\s|·,，、;；:：\-–—]/u;
const TITLE_TRAILING = /[\s|·,，、;；:：\-–—&]+$/u;

/**
 * #1938 —— title 超过上限时由代码裁（建站那条路超长靠 AI 修补；自动重写不发第二次 AI）。上限内最后一个词边界处截断，
 * 截完不到上限一半就硬裁；结尾悬着的分隔符去掉。长度按码点数（seo-problems.js charLen 同一把尺）。
 */
function fitTitle(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const cps = [...s];
  if (cps.length <= max) return s;
  const head = cps.slice(0, max);
  for (let i = head.length - 1; i > 0; i--) {
    if (!TITLE_BREAK.test(head[i])) continue;
    const cut = head.slice(0, i).join('').replace(TITLE_TRAILING, '');
    if ([...cut].length >= Math.ceil(max / 2)) return cut;
    break;
  }
  return head.join('').replace(TITLE_TRAILING, '');
}

module.exports = { seoTargetOf, secondarySeoPayload, seoCheckPage, seoAppendPlace, pageTitleSpec, titleBudgetOf, fitTitle };
