'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// review-facts.js —— 建站时 AI 写完页面之后，评价上那两样由代码写，不靠 AI 抄（#1981，Epic:MultiLocation T6）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ① testimonials 每条评价是哪一家（`items[].location`）：
//    🔴 存的是地点的 `id`（`brand.locations[k].id`），**不是下标**，第一家也写。payload 评价的 `location` 是下标（#1993 之后跟
//       `brand.json` 的 `locations` 对齐），在这里换成那一家的 id。
//    认法：这条评价的 `name` 等于 payload 某条评价的 `author`，而且只等于一条（两条 payload 评价同名 ⟹ 分不清，不写）；
//    payload 那条没有 `location` / 下标对不上地点 ⟹ 不写。AI 自己写的 `location` 一律先删掉 —— 这个字段只有代码写。
// ② 块头总分：testimonials `summary`、reviews `platforms` 里 `source` 是 Google 的那一项，`rating` / `count` 改成各地点 Google 评分
//    按条数加权（`locations.js` §siteRating）。参与加权的地点评分**全是** Google 的才改：有一家带 `source` 且不是 google
//    （`ratingFrom` 在 Google 没抓到条数时退回 Yelp 那种）⟹ 整条不动（PM 裁定 1，#1981 r2）—— 不是剔掉它用剩下几家算：
//    剩下几家的条数不是整站的 Google 条数，写上去同样是一句假话。没写 `source` 的算 google，同确认页 `locationRows.ts`
//    §googleRatingOf 的判法。没有一家有评分 ⟹ 不动。块里压根没有 Google 那一项 ⟹ 不新造（裁定 2）。
//    单地点时这个数就是那一家的，跟 AI 本来该写的相同。
//
// 📌 只改内存里的页（`page.sections` 或 `page.blocks`），返回改了几处，不写盘。

const { siteRating } = require('./locations');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sectionsOf = (page) => (isObj(page) && Array.isArray(page.sections) ? page.sections : isObj(page) && Array.isArray(page.blocks) ? page.blocks : []);
const trim = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 各地点的评分按条数加权（§siteRating），只在参与加权的评分全是 Google 的时候：
 * `{ rating }` = 能写；`{ rating: null, why }` = 不写，`why` 是给 debug 的人话。
 */
function googleSiteRating(brand) {
  const locations = isObj(brand) && Array.isArray(brand.locations) ? brand.locations : [];
  const others = locations
    .filter((l) => isObj(l) && siteRating({ locations: [l] }))
    .map((l) => trim(l.rating.source).toLowerCase())
    .filter((src) => src && src !== 'google');
  if (others.length) return { rating: null, why: `有地点的评分来自 ${[...new Set(others)].join(' / ')}，不是 Google` };
  const rating = siteRating({ locations });
  return rating ? { rating } : { rating: null, why: '没有地点有评分' };
}

/**
 * @param {{ pages: object[], brand: object, reviews?: object[] }} args
 * @returns {{ located: number, rated: number, why: string }} 写了 `location` 的评价条数 · 改了总分的平台项数 · 总分没动的原因（动了是 ''）
 */
function applyReviewFacts({ pages, brand, reviews = [] }) {
  const locations = isObj(brand) && Array.isArray(brand.locations) ? brand.locations : [];
  const byAuthor = new Map();
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const a = isObj(r) ? trim(r.author) : '';
    if (a) byAuthor.set(a, [...(byAuthor.get(a) || []), r]);
  }
  const idFor = (name) => {
    const hits = byAuthor.get(trim(name)) || [];
    if (hits.length !== 1) return '';
    const at = hits[0].location;
    const loc = Number.isInteger(at) ? locations[at] : null;
    return isObj(loc) && typeof loc.id === 'string' && loc.id ? loc.id : '';
  };
  const { rating, why = '' } = googleSiteRating(brand);
  const setGoogle = (list) => {
    let n = 0;
    if (!rating || !Array.isArray(list)) return n;
    for (const p of list) {
      if (!isObj(p) || trim(p.source).toLowerCase() !== 'google') continue;
      p.rating = rating.ratingValue;
      p.count = rating.reviewCount;
      n += 1;
    }
    return n;
  };
  let located = 0;
  let rated = 0;
  for (const page of Array.isArray(pages) ? pages : []) {
    for (const sec of sectionsOf(page)) {
      if (!isObj(sec) || !isObj(sec.data)) continue;
      if (sec.type === 'testimonials') {
        for (const it of Array.isArray(sec.data.items) ? sec.data.items : []) {
          if (!isObj(it)) continue;
          delete it.location;
          const id = idFor(it.name);
          if (id) { it.location = id; located += 1; }
        }
        rated += setGoogle(sec.data.summary);
      } else if (sec.type === 'reviews') {
        rated += setGoogle(sec.data.platforms);
      }
    }
  }
  return { located, rated, why };
}

module.exports = { applyReviewFacts, googleSiteRating };
