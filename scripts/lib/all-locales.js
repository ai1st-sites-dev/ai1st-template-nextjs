'use strict';
/**
 * all-locales.js — 一次调用产出全部语言（#1593 做什么 1）。
 *
 * 以前第二语言是主语言写完之后、再把每一页**整页翻译一遍**（`translatePageWithClaude`，一页一次、串行；中文 7 服务站
 * 16 分钟 / $1.29）。现在站级那一通、每页那一通、关键词页那一通各自**一次**把全部语言写回来：
 *   每页：{ "<主语言>": { "sections": [...] }, "<第二语言>": { "title", "description", "navLabel", "targetKeyword"?, "sections": [...] } }
 *
 * 🔴 第二语言的**版式不靠 AI 守**：主语言那一页是骨架（块的 type / options / imageUrl / 链接 / 图标 … 一切非文字字段），
 *    第二语言回包只贡献文字（§mergeLocale）。所以两种语言的页面集合、每页的 type / options / imageUrl 按构造逐字相同 ——
 *    之后生图、补 alt、挂表单这些只改主语言的步骤，第二语言在写盘时自动跟上。
 * 🔴 第二语言那一份「坏了」= 跟主语言结构对不上（块数 / type / 列表条数不同、缺文字，§localeShapeProblems）。调用方重试一次，
 *    仍坏 ⟹ 放弃**整个**第二语言（§LocaleBook.fail），主语言照常发布（正文做什么 1 的子条款；跟 TICKET-122b「第二语言不拦主语言」一致）。
 *
 * 只有主语言的站（没有第二语言）：提示词和回包形状跟改之前一样，这个文件里的东西一样都不参与。
 */

const { loadManifests } = require('./block-manifest');
const { SOURCES, isSourceRef } = require('./item-sources');

// ── 哪些格子跟主语言共用（不取第二语言那份）—— 按「这个值在块里是什么」判，不按键名（#1593 r2，QA2 打回）──────────
// r1 借的是 seo-problems.js 的 NOT_TEXT（「这是不是给 SEO 数的字」），答的是另一个问题，真块上两头都错：
//   · 同一个键名两种意思：块那一层的 `role` 是区块角色枚举（essential / lead / optional），而 `team.members[].role`、
//     `testimonials.items[].role` 是访客读的职位 / 身份 ⟹ 按键名锁成主语言，英文页上就出现中文职位；
//   · 颜色槽（`pricing.featuredColor`、各块的 `bg`）是版式，却不在那份清单里 ⟹ 取 AI 那份、或因为 AI 没写就判「缺字」丢掉整个第二语言。
// 现在分三层判：
//   ① 块这一层（`{ type, data, role?, … }`）：除了 `data` 全是结构 ⟹ 主语言。
//   ② `data` 顶上那一层：先问这个块的 manifest —— 槽是 `kind: "color"`（含 `bg`）⟹ 主语言；`options` 是旋钮 ⟹ 主语言；
//      `_` 开头的是代码挂的标记（`_sourced`）⟹ 主语言；其余往下走。
//   ③ 更深的地方：引用写法（`{ source: "services" … }`，item-sources.js 的源）整个是结构 ⟹ 主语言；
//      键在 STRUCT_KEYS 里的是链接 / 图片 / 图标 / 枚举 ⟹ 主语言；数字、布尔一律主语言；其余字符串是访客读的字。
// 🔴 STRUCT_KEYS 里的枚举键（style / size / kind / show …）对着 manifest 的 shape 有一格单测在看：manifest 里新写一个
//    `键: "a" | "b"` 形状的枚举而这里没登记，那一格就红（create-site-all-locales.test.js「枚举键全在 STRUCT_KEYS」）。
const STRUCT_KEYS = new Set(['href', 'imageUrl', 'logoUrl', 'url', 'icon', 'id', 'style', 'size', 'arrow', 'kind', 'show',
  'source', 'under', 'stops', 'angle', 'bg', 'options']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

let manifests = null;
function slotKind(type, key) {
  if (!manifests) manifests = loadManifests();
  const m = manifests.get(type);
  const slot = m && m.slots && Object.prototype.hasOwnProperty.call(m.slots, key) ? m.slots[key] : null;
  return slot ? slot.kind : undefined;
}

/**
 * 这一格取主语言吗。`zone` = 'section'（块这一层）| 'data'（data 顶上一层，`type` = 块的 type）| 'nested'（更深）。
 */
function keepsPrimary(zone, key, value, type) {
  if (zone === 'section') return key !== 'data';
  if (typeof value !== 'string' && !isObj(value) && !Array.isArray(value)) return true;  // 数字 / 布尔 / null
  if (isSourceRef(value) && Object.prototype.hasOwnProperty.call(SOURCES, value.source)) return true;
  if (zone === 'data') {
    if (key.startsWith('_') || key === 'options') return true;
    const kind = slotKind(type, key);
    if (kind === 'color') return true;
    if (kind === 'text' || kind === 'richtext') return false;
  }
  return STRUCT_KEYS.has(key);
}

/** 往下一层时的 zone：数组不换层；块这一层的 `data` 进 'data'；data 顶上那一层往下进 'nested'。 */
function childZone(zone, key) {
  if (zone === 'section') return key === 'data' ? 'data' : 'nested';
  return 'nested';
}

/**
 * 第二语言那一份跟主语言的结构差在哪（空数组 = 对得上）。按主语言走：主语言有字的地方第二语言必须有字，
 * 列表条数相同，取主语言的格子（§keepsPrimary）不看 —— 它们写盘时取主语言的。块的 type 不同也算对不上。
 * `primary` 是一组块（数组）或一块（对象）。
 */
function localeShapeProblems(primary, secondary, at = '', out = []) {
  const walk = (p, s, zone, type, where) => {
    if (out.length >= 8) return;
    if (typeof p === 'string') {
      if (filled(p) && !filled(s)) out.push(`${where || '(root)'}: missing text`);
      return;
    }
    if (Array.isArray(p)) {
      if (!Array.isArray(s)) { out.push(`${where || '(root)'}: expected a list of ${p.length}`); return; }
      if (s.length !== p.length) { out.push(`${where || '(root)'}: ${s.length} items, the main language has ${p.length}`); return; }
      p.forEach((x, i) => walk(x, s[i], zone, type, `${where}[${i}]`));
      return;
    }
    if (isObj(p)) {
      if (!isObj(s)) { out.push(`${where || '(root)'}: expected an object`); return; }
      if (zone === 'section' && typeof s.type === 'string' && s.type !== p.type) {
        out.push(`${where || '(root)'}: type "${s.type}", the main language has "${p.type}"`);
        return;
      }
      const t = zone === 'section' ? p.type : type;
      for (const k of Object.keys(p)) {
        if (keepsPrimary(zone, k, p[k], t)) continue;
        walk(p[k], s[k], childZone(zone, k), t, where ? `${where}.${k}` : k);
      }
    }
  };
  walk(primary, secondary, 'section', undefined, at);
  return out;
}

/**
 * 主语言的结构 + 第二语言的字。取主语言的格子（§keepsPrimary）原样取；第二语言缺的字退回主语言那一句。`primary` 是一块或一组块。
 *
 * 🔴 一个例外：图片对象（带 `imageUrl` 的那个对象）里的 `alt`，第二语言缺就留空串，**不退回主语言**（#1593 r3，QA2 打回）。
 *    第二语言缺 alt 只有一种来路：AI 两份回包都没写这张图，是回包之后代码在主语言页上求的图、写的 alt（`fillImageSlots` /
 *    `writeImageAlts`，主语言那一侧的唯一一处 —— QA1 r2 逐个步骤枚举过）。退回主语言 ⟹ 英文页上是中文 alt。
 *    留空之后由调用方对第二语言那一页再跑一次 `writeImageAlts`（§buildSecondaryContent），按这一页自己的标题和翻译过的目标词写。
 */
function mergeLocale(primary, secondary) {
  const walk = (p, s, zone, type) => {
    if (typeof p === 'string') return filled(s) ? s : p;
    if (Array.isArray(p)) return p.map((x, i) => walk(x, Array.isArray(s) ? s[i] : undefined, zone, type));
    if (isObj(p)) {
      const t = zone === 'section' ? p.type : type;
      const out = {};
      for (const k of Object.keys(p)) {
        if (k === 'alt' && 'imageUrl' in p && typeof p.alt === 'string' && !(isObj(s) && filled(s.alt))) { out.alt = ''; continue; }
        out[k] = keepsPrimary(zone, k, p[k], t) ? clone(p[k]) : walk(p[k], isObj(s) ? s[k] : undefined, childZone(zone, k), t);
      }
      return out;
    }
    return p;
  };
  return walk(primary, secondary, 'section', undefined);
}

/**
 * 每页回包里第二语言那一份的问题（空 = 能用）。`page` 是主语言那一页（要它的 title / description / navLabel 判「该有的字有没有」），
 * `sections` 是主语言这次定下来的块，`needKeyword` = 这一页有目标词（第二语言要给出翻译过的目标词）。
 */
function secondaryPageProblems({ page = {}, sections, group, needKeyword = false }) {
  if (!isObj(group)) return ['missing'];
  const out = [];
  for (const f of ['title', 'description', 'navLabel']) if (filled(page[f]) && !filled(group[f])) out.push(`${f}: missing text`);
  if (needKeyword && !filled(group.targetKeyword)) out.push('targetKeyword: missing');
  return out.concat(localeShapeProblems(sections, group.sections, 'sections'));
}

/**
 * 回包按语言拆开。分组的回包（有主语言那个键）⟹ 主语言取那一份；没分组（模型只回了一种）⟹ 整个回包当主语言，第二语言都缺。
 * @returns {{ primary: any, others: Record<string, any> }}
 */
function splitLocaleReply(got, primaryLocale, otherLocales) {
  const grouped = isObj(got) && isObj(got[primaryLocale]);
  const others = {};
  for (const loc of otherLocales) others[loc] = grouped && isObj(got[loc]) ? got[loc] : null;
  return { primary: grouped ? got[primaryLocale] : got, others };
}

/**
 * 提示词里那一段：这一页（或站级那一份）要同时写哪几种语言、回包长什么样。只在有第二语言时出现。
 * @param {{ primary: {code,name}, others: {code,name,hint?}[], kind: 'page'|'keyword'|'site', hasKeyword?: boolean, keywordsByLocale?: Record<string,string[]> }} p
 */
function languagesPrompt({ primary, others, kind, hasKeyword = false, keywordsByLocale = {} }) {
  const names = others.map((o) => `${o.name} ("${o.code}")`).join(', ');
  const head = `LANGUAGES: this website is in ${1 + others.length} languages — ${primary.name} ("${primary.code}") is the main one, plus ${names}. `
    + `You write every language in this one answer: the ${primary.name} part exactly as asked above, and the same content written natively in each other language (not a word-for-word translation; keep the brand name verbatim).`
    + others.map((o) => o.hint || '').join('');
  if (kind === 'site') {
    return `${head}
Add a top-level "locales" object with one entry per other language, holding that language's words for the site-wide texts:
"locales": { ${others.map((o) => `"${o.code}": { "tagline": "...", "ctaLabel": "...", "footerDescription": "...", "homeLabel": "<nav label for the home page>", "quickLinksTitle": "<footer column title, like Quick Links>", "copyright": "<'<company>. All rights reserved.' in this language>", "seo": { "siteTitle": "...", "siteDescription": "...", "offerCatalogName": "..." }, "services": [ { "id": "<same id>", "name": "...", "shortDescription": "...", "fullDescription": "...", "features": ["..."], "products": [ { "name": "...", "description": "..." } ] } ], "forms": [ { "id": "<same id>", "name": "...", "buttonText": "...", "successMessage": "..." } ], "contactPage": { "title": "<like Contact Us>", "navLabel": "<like Contact>", "description": "<like Get in touch with <company>>", "headline": "<like Contact Us>", "subheadline": "<like Send us a message and we'll get back to you shortly.>", "formHeadline": "<like Get in touch>", "formBody": "<like Leave your details and we will reach out soon.>" } }`).join(', ')} }
Same services and forms, same order and ids, as the main ones. Do NOT write pages there.`;
  }
  const extra = others.map((o) => {
    const kws = keywordsByLocale[o.code] || [];
    return kws.length ? `\n- Search phrases people use in ${o.name} for this page (use them where natural): ${kws.join(', ')}` : '';
  }).join('');
  const kw = hasKeyword ? ', "targetKeyword": "<the phrase a speaker of that language would search for — the target keyword, translated>"' : '';
  const primaryShape = kind === 'keyword' ? '{ ...the complete page object asked for above... }' : '{ "sections": [ ... ] }';
  return `${head}
Respond with ONE JSON object keyed by language code:
{ "${primary.code}": ${primaryShape}, ${others.map((o) => `"${o.code}": { "title": "...", "description": "...", "navLabel": "..."${kw}, "sections": [ ... ] }`).join(', ')} }
- Each other language has EXACTLY the same sections as "${primary.code}": same count, same order, same "type", same "options", same images, links, icons and colors, same number of items in every list — only the visitor-facing words change.
- Its "title", "description" and "navLabel" are this page's title, meta description and nav label in that language (same length limits).${extra}`;
}

/**
 * 第二语言的账本：每页回包里第二语言那一份挂在**主语言那一页 / 那一块的对象**上（WeakMap），写盘前按主语言那一页**当时**的
 * 块拼出第二语言那一页。之后代码往主语言页里插的块（关键词页的「相关页面」、服务详情页的列表）没有挂第二语言 ⟹ 拼的时候跳过，
 * 由调用方对第二语言再跑一次同一个代码步骤（用第二语言的文案表 / 服务目录）。
 */
class LocaleBook {
  constructor(locales) {
    this.locales = locales.slice();
    this.failed = new Map();
    this.pageMeta = new WeakMap();
    this.sectionText = new WeakMap();
  }

  /** 放弃这个第二语言（第一次的原因留下）。 */
  fail(locale, why) { if (!this.failed.has(locale)) this.failed.set(locale, why); }

  /** 把一页回包里某个第二语言那一份挂到主语言那一页上（`sections` 是主语言这一页最终用的那组块）。 */
  link(page, sections, locale, group) {
    const meta = this.pageMeta.get(page) || {};
    meta[locale] = { title: group.title, description: group.description, navLabel: group.navLabel, targetKeyword: group.targetKeyword };
    this.pageMeta.set(page, meta);
    (sections || []).forEach((s, i) => {
      if (!isObj(s)) return;
      const t = this.sectionText.get(s) || {};
      t[locale] = group.sections[i];
      this.sectionText.set(s, t);
    });
  }

  /** 拼出第二语言那一页；这一页没有第二语言（代码补出来的页）⟹ null。 */
  build(page, locale) {
    const meta = (this.pageMeta.get(page) || {})[locale];
    if (!meta) return null;
    const out = { ...clone(page) };
    for (const f of ['title', 'description', 'navLabel']) if (filled(meta[f])) out[f] = meta[f];
    out.sections = (page.sections || [])
      .filter((s) => isObj(s) && (this.sectionText.get(s) || {})[locale] !== undefined)
      .map((s) => mergeLocale(s, this.sectionText.get(s)[locale]));
    // #1548 —— 第二语言页的目标词是翻译来的，不是挖的 ⟹ 标 translated: true（validateSite 第 ① 条跳过它）。译文缺了就留原词。
    if (page.seo && typeof page.seo.targetKeyword === 'string') {
      out.seo = { ...page.seo, targetKeyword: filled(meta.targetKeyword) ? meta.targetKeyword.trim() : page.seo.targetKeyword, translated: true };
    }
    return out;
  }
}

module.exports = { STRUCT_KEYS, keepsPrimary, localeShapeProblems, mergeLocale, secondaryPageProblems, splitLocaleReply, languagesPrompt, LocaleBook };
