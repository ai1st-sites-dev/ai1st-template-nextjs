/**
 * keyword-service.js —— 关键词页的 Service 结构化数据算什么（#1551，SEO epic T7 做什么 2）。
 *
 * 规则（设计文档 S4，正文做什么 2 —— 只有这一种说法）：
 *   · 只在**关键词页**出，而且那一页要带 `seo.targetKeyword`（T4 #1548 写进 `pages/<slug>.json` 的那个字段）；
 *   · `name` = `targetKeyword` 原文，只把第一个字母改成大写（不做 Title Case，也不改别的字）；
 *   · `areaServed` = 词里的地名；词里没有地名 ⟹ 站的地区（跟 LocalBusiness 的 `areaServed` 同一份）；
 *   · `provider` = 本站 LocalBusiness（组件那一侧填名字和电话）。
 *
 * 🔴 「词里的地名」只认【站点数据自己写着的地名】：`seo.schema.areaServed` 的每一项、`seo.schema.addresses` 的城市、
 *    `brand.locations[].city`。没有地名词典 —— 词里出现一个站点数据里没写的城市（比如站只写了 Toronto，词是
 *    「plumber markham」），按「没有地名」处理、退回站的地区。认一个地名用它全名或逗号前那一截
 *    （`Toronto, ON` 认词里的 `toronto`），出的是站点数据里那一项原样（`{type, name}`），不是词里那几个字母。
 *    拉丁字母的地名按整词认（`york` 不认 `yorkville` 里那一截）；中日韩文字没有词边界，按子串认。几个都认得上取最长的
 *    （`North York` 胜过 `York`）。
 *
 * 📌 T4 落地前，真实站点的页面数据里没有 `seo.targetKeyword` ⟹ 这里对每一页都返回 null，一条 Service 都不出。
 */
'use strict';

const { isServiceDetailPage } = require('./service-detail-page');

/** 关键词页：建站脚本标了 `keywordPage`，或者是嵌在子目录里、又不是服务详情页的那种页（跟导航 / sitemap 同一个判断）。 */
function isKeywordPage(page) {
  if (!page || typeof page.slug !== 'string') return false;
  return (page.keywordPage === true || page.slug.includes('/')) && !isServiceDetailPage(page);
}

/** 这一页的目标词（T4 #1548 的 `seo.targetKeyword`）；没有就是 ''。 */
function targetKeywordOf(page) {
  const k = page && page.seo && page.seo.targetKeyword;
  return typeof k === 'string' ? k.trim() : '';
}

/** 第一个字母大写，其余一个字不动。 */
function capitalizeFirst(s) {
  const str = String(s || '');
  const i = str.search(/\p{L}/u);
  return i < 0 ? str : str.slice(0, i) + str.charAt(i).toLocaleUpperCase() + str.slice(i + 1);
}

const norm = (s) => String(s || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 词里有没有这个地名（拉丁字母按整词，中日韩按子串）。 */
function keywordMentions(keyword, place) {
  const k = norm(keyword);
  const p = norm(place);
  if (!k || !p) return false;
  if (CJK.test(p)) return k.includes(p);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}($|[^\\p{L}\\p{N}])`, 'u').test(k);
}

/** 站点数据里写着的全部地名 → [{ entry: {type, name}, keys: [认它用的几种写法] }]。 */
function sitePlaces({ seo, brand }) {
  const schema = (seo && seo.schema) || {};
  const out = [];
  const add = (type, name) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const head = name.split(',')[0];
    out.push({ entry: { type: type || 'City', name: name.trim() }, keys: [name, head].map(norm).filter(Boolean) });
  };
  for (const a of Array.isArray(schema.areaServed) ? schema.areaServed : []) if (a) add(a.type, a.name);
  for (const a of Array.isArray(schema.addresses) ? schema.addresses : []) if (a) add('City', a.locality);
  for (const l of brand && Array.isArray(brand.locations) ? brand.locations : []) if (l) add('City', l.city);
  return out;
}

/** 词里的地名（站点数据里那一项原样）；认不出 ⟹ null。几个都认得上取最长的那种写法。 */
function placeInKeyword(keyword, places) {
  let best = null;
  let bestLen = 0;
  for (const p of places) {
    for (const key of p.keys) {
      if (key.length > bestLen && keywordMentions(keyword, key)) { best = p.entry; bestLen = key.length; }
    }
  }
  return best;
}

/**
 * 一页 → 它的 Service 该是什么；不是关键词页 / 没有目标词 ⟹ null。
 * @returns {{ name: string, keyword: string, areaServed: {type: string, name: string}[], placeFromKeyword: boolean } | null}
 */
function keywordServiceFor(page, { seo, brand } = {}) {
  if (!isKeywordPage(page)) return null;
  const keyword = targetKeywordOf(page);
  if (!keyword) return null;
  const place = placeInKeyword(keyword, sitePlaces({ seo, brand }));
  const siteArea = ((seo && seo.schema && Array.isArray(seo.schema.areaServed)) ? seo.schema.areaServed : [])
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({ type: a.type || 'City', name: a.name }));
  return { name: capitalizeFirst(keyword), keyword, areaServed: place ? [place] : siteArea, placeFromKeyword: !!place };
}

module.exports = { capitalizeFirst, isKeywordPage, keywordMentions, keywordServiceFor, placeInKeyword, sitePlaces, targetKeywordOf };
