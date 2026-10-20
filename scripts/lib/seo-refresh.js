'use strict';
// #1938 —— 一页的 title / description 自动维护：编辑之后、停手 30 秒，manager 的执行器 `kind=seo-refresh` spawn
//
//   node scripts/site.js seo-refresh --site <站 JSON> --before <站 JSON> --locale <l> --page <slug|home> [--force] [--skip-ai] --out-dir <目录>
//       标准输入：这个站的建站表格（`sites.payload`）—— 地点（§sitePlace）、行业、第 8 条事实出处都从它取。空 = {}。
//       --before   「改之前」那一版的 content（防抖窗口里第一笔写入之前那一版）。--force 时不读它。
//       --force    不比文案，直接重写（老板把这一页从 Custom 切回自动）。
//       --skip-ai  不调 AI（建站报告 `path = skipAI` 的站）：title = H1 + 地点、description = 第一段正文，再过同一套收尾。
//   标准输出：JSON-lines。调了 AI ⟹ 先一行 `{"event":"ai-usage","model":…,"inputTokens":…,"outputTokens":…}`（manager 按
//     model_pricing.go 记账，这边不另抄一份价目表）。最后一行恒是 `{"event":"seo-refresh", …}`：
//       写了   {"event":"seo-refresh","result":"<目录>/result.json","file":"<键>","title":"…","description":"…","path":"ai|skipAI","problems":[…]}
//              result.json = {content: {<那一个文件的键>: 改过的整份文件}, summary}
//       没写   {"event":"seo-refresh","skipped":"custom|same-text|no-page|empty|unchanged"}
//   失败（AI 调不通 / 吐不回对象）⟹ 退出码 1，标准错误一行原因。日志走标准错误。
//
// 🔴 只改两个键：首页改 `<语言>/seo.json` 的 siteTitle / siteDescription，子页改 `<语言>/pages/<slug>.json` 的
//    title / description。别的键一个字节不动（落盘的是同一个对象改了那两个键）。
// 🔴 「文案变没变」跟建站检查用同一把尺（seo-problems.js §pageText，逐块取、排序后比 —— 挪顺序不算改字），比之前两份都先过
//    `blocks.js` §normalizeLocalePages（构建同一个函数）：`{ref}` 和 `visibility` 命中的共用块都算进这一页 —— 共用块的字改了，
//    用到它的页才会重写。

const fs = require('fs');
const path = require('path');
const { normalizeLocalePages } = require('../blocks');
const { pageText, H1_BLOCKS, hasPhrase, sitePlace, promptLocation, brandNameOf } = require('./seo-problems');
const { fitPageDescriptions, descriptionSpec, descriptionAccept } = require('./description-fit');
const { seoTargetOf, secondarySeoPayload, seoCheckPage, seoAppendPlace, pageTitleSpec, titleBudgetOf, fitTitle } = require('./seo-page');

const SUMMARY = 'Page title updated automatically';
const DEFAULT_MODEL = 'claude-sonnet-4-6'; // 同 create-site.js 的缺省；表格里带了 model 就用它的
const PAGE_TEXT_MAX = 6000; // 提示词里这一页的字最多带多少（一页正常 1–3k 字）

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const parsed = (content, rel) => (typeof content[rel] === 'string' ? JSON.parse(content[rel]) : content[rel]);
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

/** 这一页住在哪个键：首页的字在 seo.json，子页的字在它自己那份页面 JSON。 */
const pageKey = (locale, slug) => `${locale}/pages/${slug}.json`;
const seoKey = (locale) => `${locale}/seo.json`;

/** 这一种语言的全部页（slug 由路径定，跟构建 §readPagesRecursive 同一个读法）+ 共用块库。 */
function localePages(content, locale) {
  const prefix = `${locale}/pages/`;
  const pages = [];
  for (const k of Object.keys(content || {}).sort()) {
    if (!k.startsWith(prefix) || !k.endsWith('.json')) continue;
    const p = parsed(content, k);
    if (isObj(p)) pages.push({ ...clone(p), slug: k.slice(prefix.length, -'.json'.length) });
  }
  const lib = parsed(content || {}, `${locale}/blocks/site-blocks.json`);
  return { pages, siteBlocks: isObj(lib) ? clone(lib) : {} };
}

/**
 * 归一化之后的这一页（共用块已经展开）。这一页不在 ⟹ null。归一化抛错（这一种语言里有一页形状坏了）⟹ 退回原样 ——
 * 🔴 退回的这一页如果还是老的 `sections` 形状，§sameText / §h1Of 只读 `blocks`，取不到字：前后都是空，判成「没改」，
 * 这一页就不重写（静默不做，不写坏数据；这种站本来也构建不起来）。
 */
function resolvedPage(content, locale, slug) {
  const { pages, siteBlocks } = localePages(content, locale);
  const raw = pages.find((p) => p.slug === slug);
  if (!raw) return null;
  try {
    normalizeLocalePages(pages, siteBlocks, locale, {});
  } catch (e) {
    log(`[seo-refresh] ${locale}/${slug}: 归一化没过（${e.message}），按页面原样取字`);
  }
  return raw;
}

/**
 * 两版这一页的字一样吗：每一块各取 §pageText（同一把尺），排好序再比 —— 挪块的顺序不算改了文案（正文把它跟换图、换形态、
 * 旋钮、改链接放在一起：都退出）。
 */
function sameText(a, b) {
  const texts = (page) => ((page && page.blocks) || []).map((blk) => pageText({ blocks: [blk] })).sort();
  const x = texts(a);
  const y = texts(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/** 首页的目标词：seo.json 的 targetKeywords.primary（对象取 keyword；老站可能直接是字符串），没有再看页上挂的。 */
function homeKeyword(seo, page) {
  const p = seo && seo.targetKeywords && seo.targetKeywords.primary;
  const kw = typeof p === 'string' ? p : isObj(p) && typeof p.keyword === 'string' ? p.keyword : '';
  return kw.trim() || seoTargetOf(page);
}

function h1Of(page) {
  for (const b of (page && page.blocks) || []) {
    if (b && H1_BLOCKS.has(b.type) && isObj(b.data) && typeof b.data.headline === 'string' && b.data.headline.trim()) {
      return b.data.headline.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

/** skipAI 那一条：H1 + 地点（H1 里已经有地点就不重复）、第一段够长的正文。 */
function plainSeo({ page, place, locale }) {
  const h1 = h1Of(page);
  const title = place && h1 && !hasPhrase(h1, place) ? `${h1} | ${place}` : h1;
  const { min } = descriptionAccept(locale);
  const texts = pageText(page).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && s !== h1);
  let description = texts.find((s) => [...s].length >= min) || '';
  if (!description) {
    for (const s of texts) {
      description = description ? `${description} ${s}` : s;
      if ([...description].length >= min) break;
    }
  }
  return { title, description };
}

/** 调 AI 那一条的提示词：建站时那一句 title / description 规格（§pageTitleSpec / §descriptionSpec），只带这一页现在的字。 */
function seoRefreshPrompt({ slug, text, keyword, place, location, industry, brandName, locale }) {
  const isHome = slug === 'home';
  const titleRule = isHome ? 'the home page\'s <title>, used as-is: max 60 chars' : pageTitleSpec(brandName);
  const kwPart = keyword ? `, containing "${keyword}"` : '';
  return `You keep the search-result title and meta description of one page of the website for "${brandName}" (${industry || 'local business'}${location ? `, ${location}` : ''}) in step with what the page says. The page's text changed. Write a new title and meta description for it. Respond with ONE JSON object {"title": "<title>", "description": "<meta description>"} — no markdown fences, no explanation.

PAGE: ${slug}
LANGUAGE: ${locale} — write both in this language; keep the brand name "${brandName}" verbatim.${keyword ? `\nTARGET KEYWORD: "${keyword}" — lead the title with it.` : ''}${place ? `\nLOCATION: "${place}" — name it in the description, in this spelling.` : ''}

RULES:
- title: ${titleRule}${kwPart}.
- description: meta description, ${descriptionSpec(locale)}${kwPart}.
- Use only facts the page text below states. Specific language, not generic fluff.

PAGE TEXT:
${text.length > PAGE_TEXT_MAX ? `${text.slice(0, PAGE_TEXT_MAX)}…` : text}`;
}

/** 默认的 AI 调用（测试换成假的）：回 { title, description, usage }。 */
async function callAnthropic({ prompt, model }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const { validateAiJson } = require('./ai-json');
  const client = new Anthropic();
  const res = await client.messages.create({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  const v = validateAiJson(text);
  const usage = { model, inputTokens: (res.usage && res.usage.input_tokens) || 0, outputTokens: (res.usage && res.usage.output_tokens) || 0 };
  if (!v.ok || !isObj(v.parsed)) return { usage, error: `回包不是 JSON 对象：${String(v.error || text).slice(0, 200)}` };
  return { usage, title: v.parsed.title, description: v.parsed.description };
}

/**
 * 纯逻辑那一半（不碰盘、不写标准输出）。回：
 *   { skipped: 'custom' | 'same-text' | 'no-page' | 'empty' | 'unchanged' }
 *   { key, file, title, description, path, problems, usage? }   file = 改过两个键的整份文件（原来是字符串就还是字符串）
 * AI 调不通 / 吐不回 title ⟹ 抛（带 usage 的话挂在 error.usage 上，钱照样记）。
 */
async function seoRefresh({ site, before, locale, page: slug, force = false, skipAI = false, payload = {}, ai = callAnthropic }) {
  const content = isObj(site) ? site : {};
  const isHome = slug === 'home';
  const pKey = pageKey(locale, slug);
  const rawPage = parsed(content, pKey);
  if (!isObj(rawPage)) return { skipped: 'no-page' };
  const sKey = seoKey(locale);
  const seo = isObj(parsed(content, sKey)) ? clone(parsed(content, sKey)) : {};
  // 兜底：manager 排之前已经看过 seoMode，这里再看一眼当前这份（排进队之后老板可能刚切成 Custom）。
  if ((isHome ? seo.seoMode : rawPage.seoMode) === 'custom') return { skipped: 'custom' };

  const now = resolvedPage(content, locale, slug);
  const text = pageText(now);
  if (!force) {
    const was = isObj(before) ? resolvedPage(before, locale, slug) : null;
    if (was && sameText(was, now)) return { skipped: 'same-text' };
  }

  const meta = isObj(parsed(content, 'site_meta.json')) ? parsed(content, 'site_meta.json') : {};
  const defaultLocale = typeof meta.defaultLocale === 'string' ? meta.defaultLocale : locale;
  const pay = locale === defaultLocale ? (isObj(payload) ? payload : {}) : secondarySeoPayload(isObj(payload) ? payload : {}, locale);
  const brand = isObj(parsed(content, 'brand.json')) ? parsed(content, 'brand.json') : {};
  const brandName = brandNameOf(brand, locale) || brandNameOf(brand, defaultLocale) || String(pay.companyName || '');
  const keyword = isHome ? homeKeyword(seo, now) : seoTargetOf(now);
  const place = sitePlace(pay);

  let got;
  let usage;
  if (skipAI) {
    got = plainSeo({ page: now, place, locale });
  } else {
    const prompt = seoRefreshPrompt({ slug, text, keyword, place, location: promptLocation(pay), industry: pay.industry, brandName, locale });
    const r = await ai({ prompt, model: typeof pay.model === 'string' && pay.model ? pay.model : DEFAULT_MODEL });
    usage = r.usage;
    if (r.error || typeof r.title !== 'string' || !r.title.trim()) {
      const e = new Error(r.error || 'AI 没回 title');
      e.usage = usage;
      throw e;
    }
    got = { title: r.title, description: typeof r.description === 'string' ? r.description : '' };
  }
  // 两条路同一道判断：title 或 description 是空的 ⟹ 这一页不写（skipAI 站把文字块删光了就会这样 —— 照写会把好标题覆写成空，
  // 渲染成「 | 品牌名」；AI 那条没回 title 上面已经抛了）。判两次：这里拦「取到就是空」，收尾之后再拦「裁完才空」
  // （§fitTitle 超限裁头、剥尾部分隔符 —— H1 是一整排 `—` 时裁出来是空串）。🔴 落盘前那一次才是承重的，这一次只是省掉收尾。
  const empty = (t, d) => !String(t || '').trim() || !String(d || '').trim();
  const skipEmpty = () => {
    log(`[seo-refresh] ${locale}/${slug}: 取到的 title / description 是空的，不写`);
    return { skipped: 'empty', ...(usage ? { usage } : {}) };
  };
  if (empty(got.title, got.description)) return skipEmpty();

  // 建站时同一套收尾：title 裁到上限（§fitTitle）→ description 超底线上限就裁（§fitPageDescriptions）→ 缺地点代码补
  // （§seoAppendPlace）→ 检查一遍记日志（§seoCheckPage；不拦，没有第二次 AI）。检查对着展开过共用块的那一页做。
  const work = { pages: [now], seo, brand };
  const title = fitTitle(got.title, titleBudgetOf(now, brand, locale));
  const desc = String(got.description || '').replace(/\s+/g, ' ').trim();
  if (isHome) { seo.siteTitle = title; seo.siteDescription = desc; } else { now.title = title; now.description = desc; }
  for (const c of fitPageDescriptions({ pages: [now], seo, locale })) log(`[seo-refresh] 裁 description ${c.slug}：${c.before} → ${c.after} 字`);
  seoAppendPlace({ page: now, content: work, payload: pay, locale, who: '[seo-refresh]', log });
  const problems = seoCheckPage({ page: now, content: work, payload: pay, locale, who: '[seo-refresh]', log });
  const finalTitle = isHome ? seo.siteTitle : now.title;
  const finalDesc = isHome ? seo.siteDescription : now.description;
  if (empty(finalTitle, finalDesc)) return skipEmpty();

  const key = isHome ? sKey : pKey;
  const original = parsed(content, key);
  const next = clone(isObj(original) ? original : {});
  const [tk, dk] = isHome ? ['siteTitle', 'siteDescription'] : ['title', 'description'];
  if (next[tk] === finalTitle && next[dk] === finalDesc) return { skipped: 'unchanged', ...(usage ? { usage } : {}) };
  next[tk] = finalTitle;
  next[dk] = finalDesc;
  const file = typeof content[key] === 'string' ? `${JSON.stringify(next, null, 2)}\n` : next;
  return { key, file, title: finalTitle, description: finalDesc, path: skipAI ? 'skipAI' : 'ai', problems, ...(usage ? { usage } : {}) };
}

/** 命令行那一半（site.js 调）：读文件 / 标准输入、写 result.json、打 JSON-lines。回退出码。 */
async function seoRefreshCommand({ sitePath, beforePath, locale, page, force, skipAI, outDir, stdinText, ai }) {
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  if (typeof locale !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(locale)) throw new Error(`--locale 不合法：${JSON.stringify(locale)}`);
  if (typeof page !== 'string' || !page || page.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`--page 不合法：${JSON.stringify(page)}`);
  const site = JSON.parse(fs.readFileSync(sitePath, 'utf-8'));
  const before = !force && beforePath ? JSON.parse(fs.readFileSync(beforePath, 'utf-8')) : null;
  let payload = {};
  if (stdinText && stdinText.trim()) {
    try { payload = JSON.parse(stdinText); } catch (e) { throw new Error(`标准输入不是合法 JSON：${e.message}`); }
  }
  let r;
  try {
    r = await seoRefresh({ site, before, locale, page, force, skipAI, payload, ...(ai ? { ai } : {}) });
  } catch (e) {
    if (e.usage) out({ event: 'ai-usage', ...e.usage });
    throw e;
  }
  if (r.usage) out({ event: 'ai-usage', ...r.usage });
  if (r.skipped) {
    out({ event: 'seo-refresh', skipped: r.skipped });
    return 0;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const result = path.join(outDir, 'result.json');
  fs.writeFileSync(result, JSON.stringify({ content: { [r.key]: r.file }, summary: SUMMARY }));
  out({ event: 'seo-refresh', result, file: r.key, title: r.title, description: r.description, path: r.path, problems: r.problems });
  return 0;
}

module.exports = { seoRefresh, seoRefreshCommand, seoRefreshPrompt, plainSeo, sameText, SUMMARY };
