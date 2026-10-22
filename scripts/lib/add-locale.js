'use strict';
// #1999 —— 网站建好之后再加一种语言：manager 的执行器 `kind=add-locale` spawn
//
//   node scripts/site.js add-locale --site <站 JSON 文件> --locale <语言> [--brand-name <这个语言的店名>] --out-dir <目录>
//       标准输入：这个站的建站表格（`sites.payload`）—— 行业、`model` 从它取。空 = {}。
//   标准输出：JSON-lines。
//       每调一次 AI ⟹ `{"event":"ai-usage","model":…,"inputTokens":…,"outputTokens":…,"what":"<哪一份>"}`（manager 按 model_pricing.go 记账）
//       每译完一页 ⟹ `{"event":"add-locale-progress","done":<页>,"total":<页>}`（开始时先打一行 done = 0）
//       成功 ⟹ 最后一行 `{"event":"add-locale","result":"<目录>/result.json","pages":N,"files":[…]}`，退出码 0
//                result.json = `{ files: { "<语言>/<…>": 整份文件 }, brand: { name, tagline } }` —— **只有新增的那几样**
//       失败 ⟹ 最后一行 `{"event":"add-locale-failed","message":"<给老板的一句英文>","where":"<哪一份>"}`，退出码 1；不写 result.json
//
// 🔴 主语言那一份一个字节不动：这里只**读** content，产物里没有主语言的任何一个键。`brand.json` 的两格和 `site_meta.json` 的
//    `locales` 由 manager 在**提交那一刻的最新版本**上加（manager/site_add_locale.go §applyAddedLocale）—— 不在这里整份改写 brand.json
//    （`create-site.js §writeSecondaryLocaleConfig` 那样会把 tagline 清空，#1999 验收 12 点名的就是那一下）。
// 🔴 版式不靠 AI 守（同 `all-locales.js` 的规矩）：每一块按主语言那一块拼（§mergeLocale：id / type / shape / options / 图 / 链接 /
//    颜色一律取主语言），AI 只贡献字；slug 不译（hreflang 按 slug 配对，`config.ts §slugToLocalesOf`）。回包跟主语言结构对不上
//    （§localeShapeProblems）⟹ 带着问题再问一次；还对不上 ⟹ 整个语言失败，**一页都不落**（正文做什么 2：不留半套语言的站）。
// 🔴 不译的：博客文章（正文 §不做）、`custom-html` 块（那是一段 HTML / CSS，原样带过去）、`{ref}` 引用（指向共用块库，库本身另译）。
//    新语言的菜单里指向博客的条目整条去掉（这个语言 0 篇 ⟹ 没有 `<语言>/blog` 这条路由，留着就是死链）。
// 📌 `AI1ST_ADD_LOCALE_FAKE`（测试专用，同 AI1ST_BUNDLE_DIR 那一类）：不调 AI，每个字前面加 `[<语言>] ` 当「译文」。
//    逗号分开的几项：`echo`（开）· `fail:<n>`（第 n 页那一次必失败，n 从 1 数，按页的键排序）· `delay:<毫秒>`（每次调用先等这么久）。

const fs = require('fs');
const path = require('path');
const { languagesPrompt, localeShapeProblems, mergeLocale } = require('./all-locales');
const { LANGUAGE_NAMES, chineseVariantHint, localeMapForBcp47 } = require('./locale-names');
const { apiRetryDelayMs } = require('./ai-backoff');

const DEFAULT_MODEL = 'claude-sonnet-4-6'; // 同 create-site.js 的缺省；表格里带了 model 就用它的
const MAX_TOKENS = 16000;
const PARALLEL = 4; // 同时译几页
const SHAPE_ATTEMPTS = 2; // 回包结构对不上时最多问几次
const API_ATTEMPTS = 3; // 接口报错（429 / 5xx / 断网）时最多调几次
const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const BLOG_HREF = /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?\/)?blog(?:[/?#]|$)/i;

// 站级那几份文件里哪些键是给访客读的字（其余是结构，原样取主语言）。值是字符串、字符串数组，或者（`labels` 这种）一张字的表。
const TEXT_KEYS = {
  'seo.json': new Set(['siteTitle', 'siteDescription', 'offerCatalogName']),
  'services.json': new Set(['name', 'shortDescription', 'fullDescription', 'features', 'description', 'title', 'label']),
  'forms.json': new Set(['name', 'buttonText', 'successMessage', 'labels']),
  'navigation.json': new Set(['label', 'title', 'description', 'copyright', 'text']),
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (v) => JSON.parse(JSON.stringify(v));
const parsed = (content, rel) => (typeof content[rel] === 'string' ? JSON.parse(content[rel]) : content[rel]);
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

class AddLocaleError extends Error {
  constructor(message, where) {
    super(message);
    this.where = where;
  }
}

// ── 站级的字：挑出来 / 填回去 / 对结构 ─────────────────────────────────────────────────────────────────────────────

/**
 * 一份文件里给访客读的字，按原来的嵌套挑出来（`keys` = 哪些键是字；`all` = 这一截底下的字符串全是字）。数组保持原长 ——
 * 没有字的那一项留 `{}` 占位，否则下标就错开了。对象带上它的 `id`（只给 AI 看是哪一项，填回去时不用）。没有字 ⟹ undefined。
 */
function textsOf(v, keys, all = false) {
  if (typeof v === 'string') return all ? v : undefined;
  if (Array.isArray(v)) {
    const items = v.map((x) => textsOf(x, keys, all));
    if (items.every((x) => x === undefined)) return undefined;
    return items.map((x, i) => (x === undefined ? (typeof v[i] === 'string' ? '' : {}) : x));
  }
  if (!isObj(v)) return undefined;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'id') continue;
    const t = typeof x === 'string' ? (all || keys.has(k) ? x : undefined) : textsOf(x, keys, all || keys.has(k));
    if (t !== undefined) out[k] = t;
  }
  if (!Object.keys(out).length) return undefined;
  return typeof v.id === 'string' ? { id: v.id, ...out } : out;
}

/** §textsOf 的反过来：`v` 的结构，`t` 里有字的地方换成 `t` 的。`t` 缺的字留原文（结构对过了，缺只会是空串）。 */
function applyTexts(v, t, keys, all = false) {
  if (typeof v === 'string') return all && filled(t) ? t : v;
  if (Array.isArray(v)) return v.map((x, i) => applyTexts(x, Array.isArray(t) ? t[i] : undefined, keys, all));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = k === 'id' ? x : applyTexts(x, isObj(t) ? t[k] : undefined, keys, all || keys.has(k));
  }
  return out;
}

/** 回包跟挑出来的那一份对不对得上：有字的地方要有字、列表一样长、对象还是对象（`id` 不看）。空数组 = 对得上。 */
function textsProblems(p, s, where = '', out = []) {
  if (out.length >= 8) return out;
  if (typeof p === 'string') {
    if (filled(p) && !filled(s)) out.push(`${where || '(root)'}: missing text`);
  } else if (Array.isArray(p)) {
    if (!Array.isArray(s)) out.push(`${where || '(root)'}: expected a list of ${p.length}`);
    else if (s.length !== p.length) out.push(`${where || '(root)'}: ${s.length} items, the main language has ${p.length}`);
    else p.forEach((x, i) => textsProblems(x, s[i], `${where}[${i}]`, out));
  } else if (isObj(p)) {
    if (!isObj(s)) out.push(`${where || '(root)'}: expected an object`);
    else for (const k of Object.keys(p)) if (k !== 'id') textsProblems(p[k], s[k], where ? `${where}.${k}` : k, out);
  }
  return out;
}

// ── 菜单里的博客 ─────────────────────────────────────────────────────────────────────────────────────────────────

/** 一组菜单项里指向博客的那几条去掉（子菜单也看）；栏目里的链接被去光了，那一栏也去掉。 */
function dropBlogLinks(v) {
  if (Array.isArray(v)) {
    return v
      .filter((x) => !(isObj(x) && typeof x.href === 'string' && BLOG_HREF.test(x.href.trim())))
      .map(dropBlogLinks)
      .filter((x) => !(isObj(x) && Array.isArray(x.links) && x.links.length === 0 && !filled(x.href)));
  }
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = dropBlogLinks(x);
  return out;
}

// ── AI ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 默认的 AI 调用（测试换成假的）：回 { got, usage }，`got` 是解析出来的 JSON 对象（解析不出 ⟹ null）。接口报错按退避重试。 */
async function callAnthropic({ prompt, model }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const { validateAiJson } = require('./ai-json');
  const client = new Anthropic();
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await client.messages.create({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] });
      break;
    } catch (e) {
      if (attempt >= API_ATTEMPTS) throw e;
      const { waitMs, why } = apiRetryDelayMs(e, attempt);
      log(`[add-locale] AI call failed (${e && e.message ? e.message : e}) — retrying in ${waitMs} ms (${why})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  const v = validateAiJson(text);
  const usage = { model, inputTokens: (res.usage && res.usage.input_tokens) || 0, outputTokens: (res.usage && res.usage.output_tokens) || 0 };
  return { usage, got: v.ok && isObj(v.parsed) ? v.parsed : null, ...(v.ok ? {} : { error: String(v.error).slice(0, 200) }) };
}

/** `AI1ST_ADD_LOCALE_FAKE`（见文件头）。`input` 是这一次要译的那份对象；回包 = 同一副形状、每个字前面加 `[<语言>] `。 */
function fakeAi(spec) {
  const opts = Object.fromEntries(String(spec).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [k, v] = s.split(':');
    return [k, v === undefined ? true : v];
  }));
  const fakeText = (code, v, key) => {
    if (typeof v === 'string') return key === 'type' || key === 'id' || !v ? v : `[${code}] ${v}`;
    if (Array.isArray(v)) return v.map((x) => fakeText(code, x));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fakeText(code, x, k)]));
    return v;
  };
  return async ({ input, code, pageNo }) => {
    if (opts.delay) await new Promise((r) => setTimeout(r, Number(opts.delay) || 0));
    if (opts.fail && pageNo === Number(opts.fail)) throw new Error(`fake AI: page ${pageNo} fails (AI1ST_ADD_LOCALE_FAKE)`);
    return { got: { [code]: fakeText(code, input) } };
  };
}

// ── 提示词 ───────────────────────────────────────────────────────────────────────────────────────────────────────

function businessLine({ brandName, industry }) {
  return [brandName ? `Business: ${brandName}` : '', industry ? `Industry: ${industry}` : ''].filter(Boolean).join(' · ');
}

function pagePrompt({ input, primary, other, business, hasKeyword, problems }) {
  return `You are adding a language to a small business website. ${business}
PAGE in ${primary.name} — slug "${input.slug}" (the slug is not translated and is not part of your answer):
${JSON.stringify({ ...input, slug: undefined })}

${languagesPrompt({ primary, others: [other], kind: 'page', hasKeyword, given: true })}
${problems && problems.length ? `\nYour previous answer did not match the ${primary.name} page: ${problems.join('; ')}. Fix exactly these.\n` : ''}
Return ONLY the JSON object.`;
}

function textsPrompt({ input, primary, other, business, what, problems }) {
  return `You are adding a language to a small business website. ${business}
TEXTS in ${primary.name} — ${what}:
${JSON.stringify(input)}

${languagesPrompt({ primary, others: [other], kind: 'texts', given: true })}
${problems && problems.length ? `\nYour previous answer did not match TEXTS: ${problems.join('; ')}. Fix exactly these.\n` : ''}
Return ONLY the JSON object.`;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** 一页里交给 AI 的块：有 `data` 的、不是 custom-html 的（`{ref}` 和 custom-html 原样带过去）。 */
const translatable = (b) => isObj(b) && isObj(b.data) && b.type !== 'custom-html';

/**
 * 纯逻辑那一半（不碰盘、不写标准输出）。`emit` 收进度 / 用量那几行。回 `{ files, brand, pages }`；失败抛 AddLocaleError。
 */
async function addLocale({ site, locale, brandName = '', payload = {}, ai, emit = () => {} }) {
  const content = isObj(site) ? site : {};
  const meta = parsed(content, 'site_meta.json');
  if (!isObj(meta)) throw new AddLocaleError('This website has no content to translate yet.', 'site_meta.json');
  const P = typeof meta.defaultLocale === 'string' && meta.defaultLocale ? meta.defaultLocale : 'en';
  const locales = Array.isArray(meta.locales) ? meta.locales : [P];
  if (typeof locale !== 'string' || !LOCALE_RE.test(locale)) throw new AddLocaleError(`"${locale}" is not a language code.`, 'locale');
  if (locales.includes(locale)) throw new AddLocaleError('This website already has that language.', 'locale');

  const nameOf = (code) => LANGUAGE_NAMES[code] || code;
  const primary = { code: P, name: nameOf(P) };
  const other = { code: locale, name: nameOf(locale), hint: chineseVariantHint(nameOf(locale)) };
  const brand = isObj(parsed(content, 'brand.json')) ? parsed(content, 'brand.json') : {};
  const primaryName = typeof brand.name === 'string' ? brand.name : (isObj(brand.name) && (brand.name[P] || Object.values(brand.name)[0])) || '';
  const business = businessLine({ brandName: primaryName, industry: isObj(payload) ? payload.industry : '' });
  const model = isObj(payload) && typeof payload.model === 'string' && payload.model ? payload.model : DEFAULT_MODEL;
  const call = ai || callAnthropic;

  // 问一次、对结构；对不上带着问题再问一次。`check(answer)` 回问题列表。
  const ask = async ({ what, where = what, prompt, input, check, pageNo }) => {
    let problems = [];
    for (let attempt = 1; attempt <= SHAPE_ATTEMPTS; attempt++) {
      let r;
      try {
        r = await call({ prompt: prompt(problems), model, input, code: locale, pageNo });
      } catch (e) {
        log(`[add-locale] ${what}: the AI call failed — ${e && e.message ? e.message : e}`);
        throw new AddLocaleError(`The AI could not translate ${what}.`, where);
      }
      if (r.usage) emit({ event: 'ai-usage', ...r.usage, what });
      const answer = r.got && isObj(r.got[locale]) ? r.got[locale] : null;
      problems = answer ? check(answer) : [r.error ? `not JSON (${r.error})` : `no "${locale}" object`];
      if (!problems.length) return answer;
      log(`[add-locale] ${what}: attempt ${attempt} did not match — ${problems.join(' · ')}`);
    }
    throw new AddLocaleError(`The AI's translation of ${what} did not match the original.`, where);
  };

  // 站级的字：标语 + 四份文件里的字，一次。
  const files = {};
  const primaryTagline = typeof brand.tagline === 'string' ? brand.tagline : (isObj(brand.tagline) && typeof brand.tagline[P] === 'string' ? brand.tagline[P] : '');
  const siteFiles = Object.keys(TEXT_KEYS).filter((f) => content[`${P}/${f}`] !== undefined);
  const siteTexts = {};
  if (filled(primaryTagline)) siteTexts.tagline = primaryTagline;
  for (const f of siteFiles) {
    const t = textsOf(parsed(content, `${P}/${f}`), TEXT_KEYS[f]);
    if (t !== undefined) siteTexts[f] = t;
  }
  const siteJob = async () => {
    const got = Object.keys(siteTexts).length
      ? await ask({ what: 'the website-wide texts', where: 'site', input: siteTexts, check: (a) => textsProblems(siteTexts, a),
        prompt: (problems) => textsPrompt({ input: siteTexts, primary, other, business, what: 'the tagline, the search-result title, services, forms and menus', problems }) })
      : {};
    for (const f of siteFiles) {
      const src = parsed(content, `${P}/${f}`);
      let out = applyTexts(src, got[f], TEXT_KEYS[f]);
      if (f === 'seo.json' && isObj(out)) {
        // #1548 —— 关键词清单是主语言挖的词，不带进别的语言（同 create-site.js §buildSecondaryContent）。
        const { targetKeywords: _primaryOnly, ...rest } = out;
        out = { ...rest, locale: localeMapForBcp47(locale) };
      }
      if (f === 'navigation.json') out = dropBlogLinks(out);
      files[`${locale}/${f}`] = typeof content[`${P}/${f}`] === 'string' ? `${JSON.stringify(out, null, 2)}\n` : out;
    }
    return filled(got.tagline) ? got.tagline : '';
  };

  // 共用块库（主语言有才译）：键集合、visibility、weight 原样，字按块译。
  const libKey = `${P}/blocks/site-blocks.json`;
  const lib = parsed(content, libKey);
  const libJob = async () => {
    if (!isObj(lib)) return;
    const input = {};
    for (const [id, b] of Object.entries(lib)) if (translatable(b)) input[id] = { type: b.type, data: b.data };
    const got = Object.keys(input).length
      ? await ask({ what: 'the shared sections', where: libKey, input,
        check: (a) => Object.keys(input).flatMap((id) => localeShapeProblems(input[id], a[id], id)),
        prompt: (problems) => textsPrompt({ input, primary, other, business, what: 'sections shared by several pages, keyed by id (keep every key; inside each, same rules as a page: same "type", only the words in "data" change)', problems }) })
      : {};
    const out = {};
    for (const [id, b] of Object.entries(lib)) out[id] = input[id] ? mergeLocale(b, got[id]) : clone(b);
    files[`${locale}/blocks/site-blocks.json`] = typeof content[libKey] === 'string' ? `${JSON.stringify(out, null, 2)}\n` : out;
  };

  // 页：每页一次。
  const prefix = `${P}/pages/`;
  const pageKeys = Object.keys(content).filter((k) => k.startsWith(prefix) && k.endsWith('.json')).sort();
  const total = pageKeys.length;
  let done = 0;
  emit({ event: 'add-locale-progress', done, total });
  const pageJob = async (key, pageNo) => {
    const slug = key.slice(prefix.length, -'.json'.length);
    const page = parsed(content, key);
    const label = `the ${isObj(page) && filled(page.navLabel) ? page.navLabel : slug} page`;
    if (!isObj(page) || !Array.isArray(page.blocks)) throw new AddLocaleError(`${label[0].toUpperCase()}${label.slice(1)} is in an old format and can't be translated.`, key);
    const blocks = page.blocks.filter(translatable);
    const keyword = isObj(page.seo) && typeof page.seo.targetKeyword === 'string' ? page.seo.targetKeyword : '';
    const input = { slug, title: page.title, description: page.description, navLabel: page.navLabel, ...(keyword ? { targetKeyword: keyword } : {}),
      blocks: blocks.map((b) => ({ type: b.type, data: b.data })) };
    const check = (a) => ['title', 'description', 'navLabel'].filter((f) => filled(page[f]) && !filled(a[f])).map((f) => `${f}: missing text`)
      .concat(keyword && !filled(a.targetKeyword) ? ['targetKeyword: missing'] : [])
      .concat(localeShapeProblems(input.blocks, a.blocks, 'blocks'));
    const got = await ask({ what: label, where: key, input, check, pageNo,
      prompt: (problems) => pagePrompt({ input, primary, other, business, hasKeyword: !!keyword, problems }) });
    const out = clone(page);
    for (const f of ['title', 'description', 'navLabel']) if (filled(got[f])) out[f] = got[f];
    let i = 0;
    out.blocks = page.blocks.map((b) => (translatable(b) ? mergeLocale(b, got.blocks[i++]) : clone(b)));
    // #1548 —— 这个语言的目标词是翻译来的，不是挖的 ⟹ translated: true（同建站 §LocaleBook.build）。
    if (keyword) out.seo = { ...out.seo, targetKeyword: filled(got.targetKeyword) ? got.targetKeyword.trim() : keyword, translated: true };
    files[`${locale}/pages/${slug}.json`] = typeof content[key] === 'string' ? `${JSON.stringify(out, null, 2)}\n` : out;
    done++;
    emit({ event: 'add-locale-progress', done, total });
  };

  const jobs = [siteJob, libJob, ...pageKeys.map((k, i) => () => pageJob(k, i + 1))];
  const results = new Array(jobs.length);
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (next < jobs.length && !failed) {
      const n = next++;
      try {
        results[n] = await jobs[n]();
      } catch (e) {
        failed = failed || e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
  if (failed) throw failed;

  return {
    files,
    brand: { name: filled(brandName) ? brandName.trim() : primaryName, tagline: results[0] || '' },
    pages: total,
  };
}

/** 命令行那一半（site.js 调）：读文件 / 标准输入、写 result.json、打 JSON-lines。回退出码。 */
async function addLocaleCommand({ sitePath, locale, brandName, outDir, stdinText, ai }) {
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const site = JSON.parse(fs.readFileSync(sitePath, 'utf-8'));
  let payload = {};
  if (stdinText && stdinText.trim()) {
    try { payload = JSON.parse(stdinText); } catch (e) { throw new Error(`标准输入不是合法 JSON：${e.message}`); }
  }
  const fake = process.env.AI1ST_ADD_LOCALE_FAKE;
  let r;
  try {
    r = await addLocale({ site, locale, brandName, payload, ai: ai || (fake ? fakeAi(fake) : undefined), emit: out });
  } catch (e) {
    if (!(e instanceof AddLocaleError)) throw e;
    log(`[add-locale] ${locale}: failed at ${e.where}: ${e.message}`);
    out({ event: 'add-locale-failed', message: e.message, where: e.where });
    return 1;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const result = path.join(outDir, 'result.json');
  fs.writeFileSync(result, JSON.stringify({ files: r.files, brand: r.brand }));
  out({ event: 'add-locale', result, pages: r.pages, files: Object.keys(r.files).sort() });
  return 0;
}

module.exports = { addLocale, addLocaleCommand, AddLocaleError, textsOf, applyTexts, textsProblems, dropBlogLinks, fakeAi, TEXT_KEYS };
