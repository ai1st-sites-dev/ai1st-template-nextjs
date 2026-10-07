// #1550 —— 关键词页（设计文档 S3）：规划、素材、单页提示词、单页合格判据、服务详情页兜底、互链、页脚。
//
// 🔴 这里全是纯函数（不碰盘、不碰网络、不调 AI）。`create-site.js` 一被 require 就跑 main()、等 stdin，
//    所以留在那里的逻辑没有单测；放这里，`keyword-pages.test.js` 能把每一条判据单独打到。
//
// ── URL 形状 ─────────────────────────────────────────────────────────────────────────────────────
//   `/services/<服务 id>/<关键词 slug>`。服务 id 取 T4 #1548 那个匹配（`target-keywords.js §matchGroupsToServices`，
//   `seo.json` 的 `targetKeywords.byService` 用的是同一份）—— 不再从服务名推。slug 由 `keyword-slug.js` 生成。
//
// ── 对不上服务的那一组（PM 2026-10-04 02:08 裁定 ①(b)）──────────────────────────────────────────
//   组名跟 AI 起的服务名、组数跟服务数都对不上（挂在 Brand 下的 Lead 站：服务清单是 Brand 的，组名是 Lead 主词）
//   ⟹ 代码往服务目录里补一个服务 `{ id: <组名 slug>, name: <组名> }`，它的详情页由下面的 ensureServiceDetailPages 补出来。
//   🔴 **组里没有关键词页就不补**：补服务只是为了让 `/services/<id>` 这个父路径真实存在，没有页就没有父路径要立。
'use strict';

const { keywordGroups, matchGroupsToServices } = require('./target-keywords');
const { keywordSlug, assignKeywordSlugs, withDedupSuffix, SLUG_MAX_BYTES } = require('./keyword-slug');
const { keywordMentions } = require('./keyword-service');
const { collapseCjkSpaces } = require('./cjk-spaces');
const { descriptionSpec: descriptionSpecFor } = require('./description-fit');

// ── 多语言标签（建站时写进页面数据 / 导航，渲染期不再翻）──────────────────────────────────────────
//    语言集合同 `src/lib/component-labels.ts`（14 种 + zh-tw）。缺的语言退英语。
const LABELS = {
  en: { related: 'Related pages', all: (n) => `All ${n} pages →` },
  zh: { related: '相关页面', all: (n) => `全部 ${n} 页 →` },
  'zh-tw': { related: '相關頁面', all: (n) => `全部 ${n} 頁 →` },
  fr: { related: 'Pages associées', all: (n) => `Les ${n} pages →` },
  es: { related: 'Páginas relacionadas', all: (n) => `Las ${n} páginas →` },
  ja: { related: '関連ページ', all: (n) => `全 ${n} ページ →` },
  ko: { related: '관련 페이지', all: (n) => `전체 ${n}개 페이지 →` },
  de: { related: 'Verwandte Seiten', all: (n) => `Alle ${n} Seiten →` },
  it: { related: 'Pagine correlate', all: (n) => `Tutte le ${n} pagine →` },
  pt: { related: 'Páginas relacionadas', all: (n) => `Todas as ${n} páginas →` },
  ru: { related: 'Похожие страницы', all: (n) => `Все страницы (${n}) →` },
  vi: { related: 'Trang liên quan', all: (n) => `Tất cả ${n} trang →` },
  ar: { related: 'صفحات ذات صلة', all: (n) => `كل الصفحات (${n}) ←` },
  hi: { related: 'संबंधित पेज', all: (n) => `सभी ${n} पेज →` },
  th: { related: 'หน้าที่เกี่ยวข้อง', all: (n) => `ทั้งหมด ${n} หน้า →` },
};
function labelsFor(locale) {
  return LABELS[locale] || LABELS[String(locale || '').split('-')[0]] || LABELS.en;
}

/** 页脚每个服务一栏最多几条（超过时第 FOOTER_MAX 条换成「全部 N 页 →」）。 */
const FOOTER_MAX = 10;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// ── 规划 ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * 有没有关键词页要建（选中的非主词）。Call 1 之前就要知道（提示词里那两句），那时服务 id 还没有。
 * 「第 i 组」的顺序同 target-keywords.js（payload.services 的顺序）。
 */
function keywordPageCandidates(keywords, services = []) {
  const out = [];
  for (const g of keywordGroups(keywords, services)) {
    for (const e of g.entries) if (e.selected && !e.isPrimary) out.push({ group: g.name, keyword: e.keyword, volume: e.volume });
  }
  return out;
}

/** 新服务 id：组名的 slug（转不了就 `service-<n>`），跟已有 id 撞了加 -2 / -3。 */
function newServiceId(name, taken, n) {
  const stem = keywordSlug(name) || `service-${n}`;
  let id = stem;
  for (let k = 2; taken.has(id); k += 1) id = withDedupSuffix(stem, k);
  taken.add(id);
  return id;
}

/**
 * #1565 —— AI（Call 1）写的服务 id 收进上限：它原样落成 `pages/services/<id>.json` 和 `services/<id>/`，跟关键词页 slug 同一个上限。
 * 提示词只说 kebab-case，喂给它的服务名又不限长 ⟹ 超长 id 写盘抛 ENAMETOOLONG、整站建站失败。
 * 没超的 id 一个字不动；超了的走 keywordSlug()（截在连字符处，转不了退服务名，再不行 `service-<序号>`），
 * 跟别的服务 id 撞了走 withDedupSuffix()。服务名不动 —— 被截的只有网址。
 * 🔴 页面里指着旧 id 的地方一起改（详情页 slug / parentService / `/services/<id>` 链接 / under），否则详情页跟服务对不上。
 * 就地改 services / pages / navigation，回改了的那几个 `{ from, to }`。
 */
function capServiceIds({ services, pages, navigation } = {}) {
  const svcs = (Array.isArray(services) ? services : []).filter((s) => isObj(s) && typeof s.id === 'string');
  const tooLong = (id) => Buffer.byteLength(id) > SLUG_MAX_BYTES;
  const taken = new Set(svcs.filter((s) => !tooLong(s.id)).map((s) => s.id));
  const renames = [];
  svcs.forEach((s, i) => {
    if (!tooLong(s.id)) return;
    const stem = keywordSlug(s.id) || keywordSlug(s.name) || `service-${i + 1}`;
    let id = stem;
    for (let k = 2; taken.has(id); k += 1) id = withDedupSuffix(stem, k);
    taken.add(id);
    renames.push({ from: s.id, to: id });
    s.id = id;
  });
  renameServiceIds(renames, { pages, navigation });
  return renames;
}

/**
 * 把 §capServiceIds 回的那几个 `{ from, to }` 套到页面 / 导航上（就地改）。
 * #1568 —— Call 1 按页拆之后，id 在站级那一通回来时就收了，而每页的 sections 是之后才写的：那几通若仍写了旧 id 的链接，
 * 由调用方拿同一份 renames 再套一次（不靠模型照抄新 id）。renames 为空时一个字节不动。
 */
function renameServiceIds(renames, { pages, navigation } = {}) {
  if (!Array.isArray(renames) || !renames.length) return;
  const to = new Map(renames.map((r) => [r.from, r.to]));
  // 整串等于旧 id（parentService），或 `[/]services/<旧 id>` 后面跟着结尾 / `/` / `?` / `#`（slug、under、链接）。
  const remap = (v) => {
    if (to.has(v)) return to.get(v);
    const m = v.match(/^(\/?services\/)([^/?#]+)(.*)$/);
    return m && to.has(m[2]) ? `${m[1]}${to.get(m[2])}${m[3]}` : v;
  };
  const walk = (v) => {
    if (typeof v === 'string') return remap(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i += 1) v[i] = walk(v[i]); return v; }
    if (isObj(v)) { for (const k of Object.keys(v)) v[k] = walk(v[k]); return v; }
    return v;
  };
  if (Array.isArray(pages)) walk(pages);
  if (isObj(navigation)) walk(navigation);
}

/**
 * #1568 r2 —— 站级那一通（Call 1）的页面清单里混进来的关键词页，丢掉。关键词页只由代码按 T6 的计划建（Call 2，
 * `services/<id>/<slug>`）；站级回包再写一份 ⟹ 同一个词两张页、两份调用费（Chris 2026-10-05 真 AI 建站实测：
 * `jian-fa` / `jian-fa-dian` 两张顶层页，另一次 `haircut/nan-shi-li-fa`）。
 * 判据两条，任一成立就丢：
 *   ① 形状：三段及以上（T6 的 `services/<id>/<词>`），或两段而头一段不是 `services`（旧形状 `<服务名>/<词>`）——
 *      今天正常页只有一段（archetype）和 `services/<id>` 两种；`services/<不认识的 id>` 不按形状丢（r1 起就照常生成）；
 *   ② 重合：末段等于某个候选关键词的 slug（`keywordSlug`），或就是那个词本身。
 *      `home`、CTA 页、`services/<已有服务 id>` 不按 ② 丢：服务 id 可能恰好是那个词的拼音（服务「剪发」id `jian-fa`）。
 * @param {{ pages: object[], keywords: string[], serviceIds: string[], keep?: string[] }} p
 * @returns {{ pages: object[], dropped: { slug: string, why: string }[] }}
 */
function dropKeywordPagesFromPlan({ pages, keywords = [], serviceIds = [], keep = [] } = {}) {
  const ids = new Set(serviceIds.filter((v) => typeof v === 'string' && v));
  const kwBySeg = new Map();
  for (const k of keywords) {
    const raw = str(k);
    if (!raw) continue;
    const slug = keywordSlug(raw);
    if (slug) kwBySeg.set(slug, raw);
    kwBySeg.set(raw.toLowerCase(), raw);
  }
  const exempt = new Set(['home', ...keep.filter((v) => typeof v === 'string' && v)]);
  const out = [];
  const dropped = [];
  for (const p of Array.isArray(pages) ? pages : []) {
    const slug = str(p && p.slug).replace(/^\/+|\/+$/g, '');
    const segs = slug.split('/').filter(Boolean);
    const isServiceDetail = segs.length === 2 && segs[0] === 'services' && ids.has(segs[1]);
    if (segs.length > 2 || (segs.length === 2 && segs[0] !== 'services')) {
      dropped.push({ slug, why: '形状是关键词页（正常页只有一段或 services/<服务 id>）' });
      continue;
    }
    const last = (segs[segs.length - 1] || '').toLowerCase();
    if (!isServiceDetail && !exempt.has(slug) && kwBySeg.has(last)) {
      dropped.push({ slug, why: `跟关键词「${kwBySeg.get(last)}」的关键词页重合` });
      continue;
    }
    out.push(p);
  }
  return { pages: out, dropped };
}

/**
 * 关键词页清单（Call 1 之后：服务 id 这时才有）。
 * @param {{ keywords: object, services?: string[], contentServices: object[] }} p
 * @returns {{
 *   pages: { keyword, volume, group, serviceId, serviceName, slug, path, fallback }[],
 *   addedServices: { id, name, group }[],   // 对不上、且有关键词页的组 ⟹ 代码补的服务
 *   fallbacks: { keyword, slug }[],         // 转写不了、退成 kw-<序号> 的词（slug = 整条路径 services/<id>/kw-<n>）
 * }}
 */
function planKeywordPages({ keywords, services = [], contentServices = [] }) {
  const groups = keywordGroups(keywords, services);
  const svcs = (Array.isArray(contentServices) ? contentServices : []).filter((s) => isObj(s) && typeof s.id === 'string');
  const { ids } = matchGroupsToServices(groups, svcs);
  const taken = new Set(svcs.map((s) => s.id));
  const addedServices = [];
  const rows = [];
  groups.forEach((g, i) => {
    const entries = g.entries.filter((e) => e.selected && !e.isPrimary);
    if (!entries.length) return;
    let id = ids[i];
    let name;
    if (id === null) {
      id = newServiceId(g.name, taken, addedServices.length + 1);
      name = g.name;
      addedServices.push({ id, name, group: g.name });
    } else {
      name = str((svcs.find((s) => s.id === id) || {}).name) || g.name;
    }
    for (const e of entries) rows.push({ keyword: e.keyword, volume: e.volume, group: g.name, serviceId: id, serviceName: name });
  });
  const slugs = assignKeywordSlugs(rows.map((r) => r.keyword));
  const pages = rows.map((r, i) => ({ ...r, slug: slugs[i].slug, path: `services/${r.serviceId}/${slugs[i].slug}`, fallback: slugs[i].fallback }));
  // fallbacks 报**整条路径**（建站页把它显示成网址，只报末段会显示成一个不存在的 `/kw-2`）。
  return { pages, addedServices, fallbacks: pages.filter((p) => p.fallback).map((p) => ({ keyword: p.keyword, slug: p.path })) };
}

/** 代码补的服务 → services.json 里的一条。图标借本站第一个服务的（服务列表块不出空图标）。 */
function serviceEntryFor(added, contentServices) {
  const icon = str(((contentServices || []).find((s) => isObj(s) && str(s.icon)) || {}).icon) || 'shield-check';
  return { id: added.id, name: added.name, shortDescription: '', fullDescription: '', icon, features: [], products: [] };
}

// ── 素材（正文做什么 2）───────────────────────────────────────────────────────────────────────────

// 判「词里哪几个字是地名」时先拿掉的词：服务词本身（按词干）+ 这些常见修饰词。剩下的才可能是地名。
const STOP = new Set(('near me best top cheap affordable local emergency service services company companies the and for with '
  + 'from cost costs price prices how what much does free quote quotes open now hour hours day same fast professional '
  + 'licensed certified insured reviews review area areas nearby around residential commercial home homes house repair '
  + 'repairs installation install installer replacement replace cleaning clean cleaner contractor contractors expert '
  + 'experts specialist specialists shop store near in of to my your 24 7 247').split(/\s+/));
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const stem = (w) => w.slice(0, 5);
const words = (s) => String(s || '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * 词里的地名候选：去掉服务词（按前 5 个字母的词干比，plumber ≈ plumbing）和常见修饰词之后剩下的、3 个字母以上的词。
 * 中日韩（#1605）：只认【站点数据自己写着的地名】（`placeNames`，见 §sitePlaceNames），在词里按子串认 ——
 *   跟 `keyword-service.js` 文件头那条是同一条规矩：没有地名词典，站点数据里没写的城市按「没有地名」处理。
 *   🔴 不再「按空格分段、跟服务词不共用字的那一段」：生产里中文站的服务词是老板填的英文（Haircut），汉字服务字集合恒空，
 *   那条判据把每个词片（「剪 发 店」→ 剪 / 发 / 店）或整个词（「剪发店」）当成地名写进提示词。认不出 ⟹ 不出。
 * 🔴 拉丁字母那半是启发式，不是地名词典 —— 失败的方向只有「这一页少给了一条本地评价」或「多给了一条」，都只是提示词素材。
 */
function placeTokens(keyword, serviceWords, placeNames = []) {
  const svcStems = new Set(words(serviceWords.join(' ')).map(stem));
  const out = [];
  let cjkAt = -1;
  for (const seg of String(keyword || '').split(/\s+/).filter(Boolean)) {
    if (CJK.test(seg)) {
      if (cjkAt < 0) cjkAt = out.length;
      continue;
    }
    for (const w of words(seg)) {
      if (w.length < 3 || STOP.has(w) || svcStems.has(stem(w)) || /^\d+$/.test(w)) continue;
      out.push(w);
    }
  }
  if (cjkAt >= 0) {
    // 词里汉字之间的空格先并掉（老 payload 里的「多伦多 理发 店」/「多 伦多」）；被另一个认得上的地名包住的那个不重复出。
    const kw = collapseCjkSpaces(String(keyword || ''));
    const hits = [...new Set(placeNames.filter((n) => CJK.test(n) && keywordMentions(kw, n)))];
    const kept = hits.filter((n) => !hits.some((o) => o !== n && o.includes(n)));
    kept.sort((a, b) => kw.indexOf(a) - kw.indexOf(b));
    out.splice(cjkAt, 0, ...kept);
  }
  return out;
}

/**
 * 站点数据自己写着的地名（#1605）：建站 payload 的 `location` 与 `locationLocalized`（#1569：「多伦多, 安大略省, 加拿大」）
 * 按逗号切开的那几段。只有这两处 —— 没有别的来源兜底（去掉 `locationLocalized` 的中文站就是一个中文地名都没有）。
 */
function sitePlaceNames(payload = {}) {
  const parts = [payload.location, payload.locationLocalized]
    .flatMap((v) => (typeof v === 'string' ? v.split(/[,，、]/) : []))
    .map((s) => collapseCjkSpaces(s.trim()))
    .filter(Boolean);
  return [...new Set(parts)];
}

/** 评价里有没有提到这个地名：拉丁字母要求它在评价里是大写开头的整词（专有名词）；中日韩按子串。 */
function mentionsPlace(text, token) {
  const t = String(text || '');
  if (CJK.test(token)) return t.includes(token);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})($|[^\\p{L}\\p{N}])`, 'giu');
  for (const m of t.matchAll(re)) if (/^\p{Lu}/u.test(m[2])) return true;
  return false;
}

/**
 * 这一页那次调用的素材。全部来自建站表格和挖词那次已经拿到的结果，不新增任何外部调用。
 * @param {object} page        planKeywordPages 的一行
 * @param {object} payload     建站表格：address / phone / location / reviews / keywordMaterial / keywords
 * @returns {{ address, phone, places: string[], reviews: object[], questions: string[], relatedSearches: string[] }}
 */
function keywordPageMaterial(page, payload = {}) {
  const groupPrimary = ((keywordGroups(payload.keywords || {}, payload.services || []).find((g) => g.name === page.group) || { entries: [] })
    .entries.find((e) => e.isPrimary) || {}).keyword || '';
  const places = placeTokens(page.keyword, [page.serviceName, page.group, groupPrimary].filter(Boolean), sitePlaceNames(payload));
  const reviews = (Array.isArray(payload.reviews) ? payload.reviews : [])
    .filter((r) => isObj(r) && str(r.text) && (r.rating === undefined || r.rating === null || Number(r.rating) >= 4))
    .filter((r) => places.some((p) => mentionsPlace(r.text, p)));
  const mat = isObj(payload.keywordMaterial) && isObj(payload.keywordMaterial[page.group]) ? payload.keywordMaterial[page.group] : {};
  // #1607 —— 素材也去汉字之间的空格：老站重建时 payload 原样进来（「剪 发 店」），写入那一侧的收紧（#1569 / #1605）走不到。
  const list = (v, n) => [...new Set((Array.isArray(v) ? v : []).map((x) => collapseCjkSpaces(str(x))).filter(Boolean))].slice(0, n);
  // 「已选的词」跟素材用同一个键比（§target-keywords.js collapseGroup 那个键），否则「剪 发 店」滤不掉「剪发店」。
  const key = (s) => collapseCjkSpaces(str(s)).trim().toLowerCase();
  const chosen = new Set(Object.values(isObj(payload.keywords) ? payload.keywords : {})
    .flatMap((a) => (Array.isArray(a) ? a : [])).map((k) => key(k && k.keyword)));
  return {
    address: str(payload.address),
    phone: str(payload.phone),
    places,
    reviews,
    questions: list(mat.questions, 8),
    relatedSearches: list(mat.unselected, 10).filter((k) => !chosen.has(key(k))),
  };
}

// ── 单页提示词 ────────────────────────────────────────────────────────────────────────────────────

// 正文做什么 2 的硬规矩：事实只许来自建站表格（年份 / 牌照 / 价格 / 评价数没有就不写）；编没编由 T5 #1549 第 8 条查。
const FACTS_RULE = '- FACTS ONLY FROM THE BUSINESS CONTEXT AND MATERIAL ABOVE: years in business, licenses / insurance / certifications, '
  + 'prices, review counts and service areas may be stated ONLY when they are given above — if they are not given, do not write them.';

/**
 * 一个关键词页那次调用的完整提示词。只含这一页的素材 —— 另一个地区页的评价不会出现在这里。
 * @param {object} p
 */
function keywordPagePrompt({
  page, material, companyName, industry, location, languageInstruction = '', tagline = '', siteDescription = '',
  additionalContext = '', sectionOptions, factsRule = FACTS_RULE, sitePrimaryKeyword = '', detailPageExists = true,
  // #1549 —— 子页 title 的长度说法（create-site §pageTitleSpec：60 − 3 − 主语言品牌名），跟 seoProblems 第 1 条同一个数。
  titleSpec = 'max 60 chars',
  // #1549 —— meta description 的长度说法（description-fit.js §descriptionSpec，目标区间）。默认值也从那里取，不另写数字。
  descriptionSpec = descriptionSpecFor('en'),
  // #1601 —— 站的行动按钮指哪一页（navigation.header.cta.href）。整站配方的站没有 /quote 页（按钮落点是 /contact），
  //    写死 "/quote" 就是让每张关键词页的 CTA 指一张不存在的页。不给时指联系页（#1636：代码里不再有报价页）。
  ctaHref = '',
}) {
  const m = material;
  const facts = [];
  if (m.address) facts.push(`- Address: ${m.address}`);
  if (m.phone) facts.push(`- Phone: ${m.phone}`);
  const local = m.places.length
    ? `This page is about ${m.places.join(' ')}: describe what is typical there for this kind of work in general terms (the kinds of homes and buildings, how people there use the service). Do NOT invent facts or numbers about it.`
    : '';
  const lines = [
    `You are an expert SEO copywriter. Write ONE keyword landing page for a local service business. Return ONLY a valid JSON object for this one page, no markdown fences, no explanation.`,
    '',
    'BUSINESS CONTEXT:',
    `- Company: ${companyName}`,
    `- Industry: ${industry}`,
    location ? `- Location: ${location}` : '',
    tagline ? `- Brand tagline: ${tagline}` : '',
    siteDescription ? `- Site description: ${siteDescription}` : '',
    additionalContext ? `- Additional context from the owner: ${additionalContext}` : '',
    ...facts,
    languageInstruction,
    '',
    `CRITICAL BRAND NAME RULE: the brand name "${companyName}" is canonical and MUST appear LITERALLY VERBATIM wherever the brand is mentioned — never translated, transliterated or localized.`,
    '',
    'THIS PAGE:',
    `- slug: "${page.path}" (write it EXACTLY like this)`,
    `- target keyword: "${page.keyword}" (${page.volume || '?'} searches/mo) — use it naturally in the title, meta description, the page-header headline (the page's only h1), section headlines and body.`,
    `- service: ${page.serviceName}${detailPageExists ? ` — its own page is /services/${page.serviceId}` : ''}`,
    sitePrimaryKeyword ? `- the home page targets "${sitePrimaryKeyword}" — do not compete with it, stay on this page's keyword` : '',
    '',
    'MATERIAL FOR THIS PAGE ONLY (use it; do not add facts that are not here or in the business context):',
    local ? `- ${local}` : '',
    m.reviews.length ? `- Customer reviews that mention this area (quote or paraphrase them faithfully, keep the author name):\n${m.reviews.map((r) => `  - ${str(r.author) || 'A customer'}${r.rating ? ` (${r.rating}★)` : ''}: "${str(r.text)}"`).join('\n')}` : '',
    m.questions.length ? `- Questions people really search for (answer 3-4 of the most relevant in the faq section):\n${m.questions.map((q) => `  - ${q}`).join('\n')}` : '',
    m.relatedSearches.length ? `- Related searches (good FAQ wording or section topics):\n${m.relatedSearches.map((q) => `  - ${q}`).join('\n')}` : '',
    '',
    `The page MUST have 4-6 sections from these options:`,
    sectionOptions,
    '',
    'Return ONE JSON object:',
    '{',
    `  "slug": "${page.path}",`,
    `  "title": "<Page Title with the keyword, ${titleSpec}>",`,
    `  "description": "<Meta description with the keyword + location, ${descriptionSpec}>",`,
    '  "navLabel": "<Short label for the footer>",',
    '  "navOrder": 50,',
    '  "changeFrequency": "monthly",',
    '  "priority": 0.6,',
    '  "sections": [ ... ]',
    '}',
    '',
    'RULES:',
    `- Do NOT re-write the service page: describe ${page.serviceName} itself in ONE sentence only${detailPageExists ? ` and link to its service page (/services/${page.serviceId})` : ''}; spend the rest of the page on what is specific to "${page.keyword}".`,
    factsRule,
    '- Every image object you write ({"imageUrl", "alt"}) gets an "alt": one plain sentence saying what the photo shows (no "image of").',
    '- content body should be 2-3 substantial paragraphs (400-600 words) of unique copy, not 1-2 sentences.',
    '- FAQ answers 2-3 sentences each.',
    ctaHref
      ? `- CTA href points to "${ctaHref}"${detailPageExists ? ` or to /services/${page.serviceId}` : ''} — no other page of this website takes enquiries.`
      : `- CTA href points to the contact page "/contact"${detailPageExists ? `, or to /services/${page.serviceId}` : ''}.`,
    '- navOrder 50+ (keyword pages sort after regular pages).',
  ];
  return lines.filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 单页重写那一次：把这一页的问题原样退给它。 */
function keywordPageRetryMessage(problems) {
  return 'Your page breaks the rules below. Fix ONLY these and respond AGAIN with the COMPLETE JSON object for this one page '
    + '(same structure, no markdown fences):\n' + problems.map((p) => `- ${p}`).join('\n');
}

/**
 * 这一页合不合格（拿不到合格结果 = 只重试这一页）。`validate(page)` 回 problems（create-site 传 validateSite 的
 * scope:'edit' —— 全站级那条「整个站里没有 X」不算到单页头上）。
 */
function keywordPageProblems(got, page, validate) {
  if (!isObj(got)) return [`应该回一个页面对象，收到的是 ${Array.isArray(got) ? '数组' : typeof got}`];
  const out = [];
  if (got.slug !== page.path) out.push(`slug 必须是 "${page.path}"，收到的是 ${JSON.stringify(got.slug)}`);
  if (!str(got.title)) out.push('title 是空的');
  if (!Array.isArray(got.sections) || got.sections.length === 0) out.push('sections 必须是非空数组');
  if (out.length) return out;
  return typeof validate === 'function' ? validate(got) : [];
}

// ── 服务详情页兜底 + 互链（正文做什么 4 / 5）────────────────────────────────────────────────────

const pagesRef = (serviceId, extra = {}) => ({ source: 'pages', under: `services/${serviceId}`, ...extra });
const isPagesRef = (v) => isObj(v) && v.source === 'pages';
const sectionsOf = (p) => (Array.isArray(p.sections) ? p.sections : (p.sections = []));
/** 插在最后一个 cta 之前（页尾那一组在行动号召之上）；没有 cta 就接在最后。 */
function insertBeforeTrailingCta(sections, block) {
  const last = sections.length - 1;
  if (last >= 0 && sections[last] && sections[last].type === 'cta') sections.splice(last, 0, block);
  else sections.push(block);
}

/**
 * 每个有关键词页的服务，`/services/<id>` 必须存在，并且列出它下面的全部关键词页（`features` 的
 * `{source: "pages", under: "services/<id>"}`，代码填，不让 AI 填）。
 *   · 页在：它身上已有的 `{source: "pages"}` 一律改成对的 under；一个都没有就补一个 features 块
 *   · 页不在：按服务数据补出这一页（page-header + 有全文就带 content + features）
 *   · 补不出（服务目录里没有这个 id / 服务没有名字）⟹ 记进 failed，调用方让建站失败
 * @returns {{ added: string[], patched: string[], failed: string[] }}
 */
function ensureServiceDetailPages({ pages, services, serviceIds, locale, disabledBlocks = [] }) {
  const off = new Set(disabledBlocks);
  const label = labelsFor(locale).related;
  const added = [];
  const patched = [];
  const failed = [];
  let order = 10 + pages.filter((p) => p && p.serviceDetailPage === true).length;
  for (const id of [...new Set(serviceIds)]) {
    const slug = `services/${id}`;
    const svc = (services || []).find((s) => isObj(s) && s.id === id);
    let page = pages.find((p) => p && p.slug === slug);
    if (!page) {
      if (!svc || !str(svc.name)) { failed.push(id); continue; }
      const sections = [];
      if (!off.has('page-header')) sections.push({ type: 'page-header', data: { headline: str(svc.name), ...(str(svc.shortDescription) ? { subheadline: str(svc.shortDescription) } : {}) } });
      if (str(svc.fullDescription) && !off.has('content')) sections.push({ type: 'content', data: { body: str(svc.fullDescription) } });
      page = {
        slug, title: str(svc.name), description: str(svc.shortDescription) || str(svc.fullDescription) || str(svc.name),
        navLabel: str(svc.name), navOrder: order++, changeFrequency: 'monthly', priority: 0.8,
        serviceDetailPage: true, parentService: id, sections,
      };
      pages.push(page);
      added.push(id);
    }
    if (off.has('features')) continue;
    const refs = sectionsOf(page).filter((b) => b && b.type === 'features' && b.data && isPagesRef(b.data.items));
    if (refs.length) {
      let changed = false;
      for (const b of refs) if (b.data.items.under !== `services/${id}`) { b.data.items = pagesRef(id); changed = true; }
      if (changed && !added.includes(id)) patched.push(id);
    } else {
      insertBeforeTrailingCta(sectionsOf(page), { type: 'features', data: { headline: label, items: pagesRef(id) } });
      if (!added.includes(id)) patched.push(id);
    }
  }
  return { added, patched, failed };
}

/**
 * 一个服务下的关键词页一页都没留下（seoPass 全丢了）时，AI 自己写的那张详情页上「下面的关键词页」那组展开出来是空的
 * ⟹ 把指向 `services/<id>` 的列表块拿掉。回拿掉了几块。
 */
function removePagesListBlocks(page, serviceId) {
  if (!isObj(page)) return 0;
  const before = sectionsOf(page).length;
  page.sections = sectionsOf(page).filter((b) => !(b && b.type === 'features' && b.data && isPagesRef(b.data.items)
    && b.data.items.under === `services/${serviceId}`));
  return before - page.sections.length;
}

/**
 * 每个关键词页页尾一组「相关页面」= 先一条链回它的服务详情页、再是同服务的兄弟页（展开时排除本页，
 * `item-sources.js §pages` 的 `withParent`）。#1630：面包屑删了之后这是关键词页回服务详情页唯一的路，所以一个服务
 * 只有一页时也加（原来「同服务少于 2 页就不加」那条去掉了）。
 */
function addRelatedBlocks(kwPages, locale, disabledBlocks = []) {
  if (new Set(disabledBlocks).has('features')) return 0;
  const label = labelsFor(locale).related;
  let n = 0;
  for (const p of kwPages) {
    const id = serviceIdOfKeywordPath(p.slug);
    if (!id) continue;
    // AI 自己已经写了一组本服务的页面列表：不再加第二组，给它补上父页那一条（指向别的服务的那种不算，照加）。
    const own = blockListOf(p).filter((b) => b && b.type === 'features' && b.data && isPagesRef(b.data.items)
      && b.data.items.under === `services/${id}`);
    if (own.length) {
      for (const b of own) b.data.items = { ...b.data.items, withParent: true };
      continue;
    }
    insertRelated(p, { type: 'features', data: { headline: label, items: pagesRef(id, { withParent: true }) } });
    n += 1;
  }
  return n;
}

// #1639 —— 「更新网站」那条路（`site-data-migration.js`）也调 §addRelatedBlocks，而它传进来的是**磁盘上的**页面：
//    #998 之后是 `blocks` 形状（建站写盘时 `blocks.js` §pageWithBlocks 转的），#998 之前的站仍是 `sections`。
//    建站这条路传进来的永远是 `sections`，下面两个函数对它跟原来一字不差。
//    🔴 不改 `sectionsOf`：它在 `blocks` 形状的页上会凭空建一个 `sections: []`，别的函数还靠它那个行为。
const blockListOf = (p) => (Array.isArray(p.blocks) ? p.blocks : sectionsOf(p));

/**
 * 把页尾那一组放进页面。`sections` 形状照旧插在最后一个 cta 之前（数组位置就是顺序）。
 * `blocks` 形状的顺序看 `weight`（`blocks.js` §effectiveWeight，没写就是位置 × 10）⟹ 新块补齐 `id / role / region / weight`
 * （同 §pageWithBlocks 写的那几个键），`weight` 取排在最后的 cta 与它前一块的中点；最后一块不是 cta 就排到最后。
 */
function insertRelated(p, block) {
  if (!Array.isArray(p.blocks)) {
    insertBeforeTrailingCta(sectionsOf(p), block);
    return;
  }
  const { effectiveWeight, roleFor, generatedBlockId } = require('../blocks');
  const list = p.blocks;
  const order = list.map((b, i) => ({ b, i, w: effectiveWeight(b || {}, i) })).sort((x, y) => (x.w - y.w) || (x.i - y.i));
  const last = order[order.length - 1];
  const beforeCta = !!(last && last.b && last.b.type === 'cta');
  let weight;
  if (!last) weight = 0;
  else if (!beforeCta) weight = last.w + 10;
  else weight = order.length > 1 ? (order[order.length - 2].w + last.w) / 2 : last.w - 10;
  const ids = new Set(list.map((b) => b && b.id));
  let k = list.length;
  while (ids.has(generatedBlockId(p.slug, block.type, k))) k += 1;
  const full = { id: generatedBlockId(p.slug, block.type, k), type: block.type, role: roleFor(block.type), region: 'content', weight, data: block.data };
  if (beforeCta) list.splice(last.i, 0, full);
  else list.push(full);
}

/** `services/<id>/<词>` → id；别的形状 → null。 */
function serviceIdOfKeywordPath(slug) {
  const m = typeof slug === 'string' ? slug.match(/^services\/([^/]+)\/[^/]+$/) : null;
  return m ? m[1] : null;
}

/**
 * 页脚：每个服务一栏，最多 FOOTER_MAX 条；超过时最后一条是「全部 N 页 →」链到该服务详情页。
 * 新形状按服务 id 分组、栏名取服务目录里的名字；老形状（`<服务slug>/<词>`）照旧按第一段分组、栏名由 slug 拼。
 * `create-site.js`（建站）和 `sync-config.js`（重建导航）调的是这同一个函数。
 */
function keywordFooterColumns(kwPages, services, locale) {
  const label = labelsFor(locale);
  const groups = new Map();
  for (const p of kwPages || []) {
    if (!p || typeof p.slug !== 'string') continue;
    const id = serviceIdOfKeywordPath(p.slug);
    const key = id ? `services/${id}` : p.slug.split('/')[0];
    if (!groups.has(key)) {
      const svc = id ? (services || []).find((s) => isObj(s) && s.id === id) : null;
      const title = svc && str(svc.name) ? str(svc.name) : (id || key).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      groups.set(key, { title, id, pages: [] });
    }
    groups.get(key).pages.push(p);
  }
  // 栏内顺序按页面的 navOrder（建站时由代码写成 50 + 它在挖词清单里的位置 ⟹ Gold 高的在前），同值保持原顺序。
  // 🔴 不按文件顺序：sync-config 读到的是按文件名排的页，按那个排会跟建站时那一份不一样（#1550 测试抓到过）。
  const ord = (p) => (typeof p.navOrder === 'number' && Number.isFinite(p.navOrder) ? p.navOrder : Infinity);
  return [...groups.values()].map((g) => {
    g.pages = g.pages.map((p, i) => ({ p, i })).sort((a, b) => (ord(a.p) - ord(b.p)) || (a.i - b.i)).map((x) => x.p);
    const link = (p) => ({ label: p.title, href: `/${p.slug}` });
    if (g.pages.length <= FOOTER_MAX || !g.id) return { title: g.title, links: g.pages.slice(0, FOOTER_MAX).map(link) };
    return {
      title: g.title,
      links: [...g.pages.slice(0, FOOTER_MAX - 1).map(link), { label: label.all(g.pages.length), href: `/services/${g.id}` }],
    };
  });
}

module.exports = {
  FOOTER_MAX,
  capServiceIds,
  renameServiceIds,
  dropKeywordPagesFromPlan,
  labelsFor,
  keywordPageCandidates,
  planKeywordPages,
  serviceEntryFor,
  placeTokens,
  sitePlaceNames,
  mentionsPlace,
  keywordPageMaterial,
  keywordPagePrompt,
  keywordPageRetryMessage,
  keywordPageProblems,
  ensureServiceDetailPages,
  addRelatedBlocks,
  removePagesListBlocks,
  serviceIdOfKeywordPath,
  keywordFooterColumns,
};
