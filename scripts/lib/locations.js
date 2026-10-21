'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// locations.js —— 一个网站的地点（`brand.json` 的 `locations[]`）：主地点、整站评分、老网站的搬迁、坐标并入（#1976，
//                  Epic:MultiLocation 的 T1，设计文档 docs/superpowers/specs/2026-10-20-multi-location-design.md 第 3 节）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **主地点 = `locations[0]`**，读它一律经 §mainLocation（Chris 2026-10-20：只放得下一个的地方用第一个地点）。
// 🔴 **营业时间、评分按地点存**（`locations[i].hours` / `.rating`）。老网站的在 `seo.json` 的 `schema.openingHours` /
//    `schema.aggregateRating`（每种语言一份）。规则只有一句（设计文档 3.2）：**默认语言的 `seo.json` 里还有它，它就是第一个
//    地点的** —— 没搬过的老站、AI 改站刚写回去的、回退到老版本的，三种都走这一条。
//    · 读的时候（`derive-core.js` §runDerive）：§liftLocationFacts 把它放进 `locations[0]`，各语言内存里那份删掉；
//    · 写的时候（`derive-core.js` §contentPatchesOf）：同一个函数的结果写进 `brand.json`，各语言 `seo.json` 删掉这两项；
//    · 直接读站点数据、没经过派生的地方（建站 / AI 改站脚本、编辑器）经 §mainLocationFacts，同一条规则。
// 🔴 **坐标不进版本**：住在 `sites.geo`，一组 `[{address, lat, lng, …}]`，**按地址对，不按下标对**（拖动排序不用重查）。
//    老的单个对象 `{lat, lng, address}` 当成只有一项（§geoEntries）。渲染时 §mergeGeo 把地址对上的那一项的 lat/lng 并进地点。

// 📌 不 require 任何 node 模块：contact-facts / block-placeholders 经它进编辑器和块的浏览器包（随机 id 用 Math.random，不要 crypto）。

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 主地点（`locations[0]`）；没有 ⟹ null。 */
function mainLocation(brand) {
  const locs = isObj(brand) && Array.isArray(brand.locations) ? brand.locations : [];
  return isObj(locs[0]) ? locs[0] : null;
}

/**
 * 一组地点的评分 → 一项能用的 `{rating, count}`；不合格 ⟹ null。判法照抄 reviews 块（`blocks/reviews/Section.tsx` §platformOf）：
 * 分数是 0..5 的有限数、条数是 > 0 的有限数，条数取整。
 */
function usableRating(r) {
  if (!isObj(r)) return null;
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);
  const rating = num(r.ratingValue);
  const count = num(r.reviewCount);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5 || !Number.isFinite(count) || count <= 0) return null;
  return { rating, count: Math.round(count) };
}

/**
 * 整站评分：各地点 `rating` 按条数加权（Σ ratingValue×reviewCount ÷ Σ reviewCount，四舍五入到一位小数），条数求和 ——
 * 同 reviews 块的总分（`blocks/reviews/Section.tsx` 的 totalRating，显示用 `toFixed(1)`）。不存，读的时候算。
 * 没有一个地点有能用的评分 ⟹ null。
 */
function siteRating(brand) {
  const locs = isObj(brand) && Array.isArray(brand.locations) ? brand.locations : [];
  const rated = locs.map((l) => (isObj(l) ? usableRating(l.rating) : null)).filter(Boolean);
  const reviewCount = rated.reduce((s, r) => s + r.count, 0);
  if (!reviewCount) return null;
  const ratingValue = Math.round((rated.reduce((s, r) => s + r.rating * r.count, 0) / reviewCount) * 10) / 10;
  return { ratingValue, reviewCount };
}

/** `seo.json` 里还留着的老形状：`{ hours?, rating? }`，只放「有这一项」的那几个键（值原样，包括空壳）。 */
function legacyFactsOf(seo) {
  const schema = isObj(seo) && isObj(seo.schema) ? seo.schema : {};
  return {
    ...(has(schema, 'openingHours') ? { hours: schema.openingHours } : {}),
    ...(has(schema, 'aggregateRating') ? { rating: schema.aggregateRating } : {}),
  };
}

/** 新地点的 id：`loc-` + 4 位随机十六进制，不跟 `taken` 里的重复。 */
function newLocationId(taken = []) {
  const used = new Set(taken);
  for (;;) {
    const id = `loc-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')}`;
    if (!used.has(id)) return id;
  }
}

/** 没有 `id` 的地点按下标补 `loc-<下标>`（撞上已有的就再接 `-<n>`）—— 读和写两边算出同一个，第一次写 `brand.json` 时落盘。 */
function withLocationIds(locations) {
  const used = new Set(locations.map((l) => (isObj(l) && typeof l.id === 'string' && l.id ? l.id : null)).filter(Boolean));
  return locations.map((l, i) => {
    if (!isObj(l) || (typeof l.id === 'string' && l.id)) return l;
    let id = `loc-${i}`;
    for (let n = 1; used.has(id); n += 1) id = `loc-${i}-${n}`;
    used.add(id);
    return { id, ...l };
  });
}

/**
 * 读的时候搬（见文件头）：`seo`（默认语言那份）里还有营业时间 / 评分 ⟹ 它们就是 `locations[0]` 的；没有 `id` 的地点补上。
 * 纯函数，返回新的 brand（不改入参）；没有地点 ⟹ 原样返回（营业时间留在 `seo.json`，§mainLocationFacts 照样读得到，不丢）。
 */
function liftLocationFacts(brand, seo) {
  if (!isObj(brand) || !Array.isArray(brand.locations) || !isObj(brand.locations[0])) return brand;
  const legacy = legacyFactsOf(seo);
  const locations = withLocationIds(brand.locations);
  if (has(legacy, 'hours') || has(legacy, 'rating')) locations[0] = { ...locations[0], ...legacy };
  return { ...brand, locations };
}

/**
 * 主地点的营业时间 / 评分（`{ hours, rating }`，没有就是 undefined）。直接读站点数据（没经过派生）的地方用它：
 * `seo` 里还有老形状就以它为准（同 §liftLocationFacts 那条规则），否则读 `locations[0]`。
 */
function mainLocationFacts(brand, seo) {
  const legacy = legacyFactsOf(seo);
  const loc = mainLocation(brand) || {};
  return {
    hours: has(legacy, 'hours') ? legacy.hours : loc.hours,
    rating: has(legacy, 'rating') ? legacy.rating : loc.rating,
  };
}

const validLatLng = (g) => isObj(g) && Number.isFinite(g.lat) && Number.isFinite(g.lng);

/** `sites.geo` → 一组项。老的单个对象当成一项；不是对象的项丢掉。 */
function geoEntries(geo) {
  if (Array.isArray(geo)) return geo.filter(isObj);
  return isObj(geo) ? [geo] : [];
}

/**
 * `sites.geo` 并进地点：某个地点的 `address` 等于某一项的 `address` ⟹ 那一项的 lat/lng 并进它的 `geo`（只并 lat/lng，设计文档 3.3）。
 * 一个都对不上 ⟹ 原样返回同一个对象（content 里自带的 `geo` 照用）。
 */
function mergeGeo(brand, geo) {
  const entries = geoEntries(geo).filter((e) => typeof e.address === 'string' && validLatLng(e));
  if (!entries.length || !isObj(brand) || !Array.isArray(brand.locations)) return brand;
  let hit = false;
  const locations = brand.locations.map((loc) => {
    const e = isObj(loc) ? entries.find((x) => x.address === loc.address) : null;
    if (!e) return loc;
    hit = true;
    return { ...loc, geo: { lat: e.lat, lng: e.lng } };
  });
  return hit ? { ...brand, locations } : brand;
}

/**
 * 内容里写着的坐标剥出来（坐标住 `sites.geo`、不进版本）：每个带 `geo` 键的地点去掉那一键；lat/lng 能用的各成一项
 * `{lat, lng, address}`（address 去掉首尾空白）。返回 `{ brand, entries }`；没有一个地点带 `geo` ⟹ brand 原样。
 */
function stripGeo(brand) {
  if (!isObj(brand) || !Array.isArray(brand.locations) || !brand.locations.some((l) => isObj(l) && has(l, 'geo'))) {
    return { brand, entries: [] };
  }
  const entries = [];
  const locations = brand.locations.map((loc) => {
    if (!isObj(loc) || !has(loc, 'geo')) return loc;
    const { geo: g, ...rest } = loc;
    if (validLatLng(g)) entries.push({ lat: g.lat, lng: g.lng, address: typeof loc.address === 'string' ? loc.address.trim() : '' });
    return rest;
  });
  return { brand: { ...brand, locations }, entries };
}

module.exports = {
  mainLocation, usableRating, siteRating, legacyFactsOf, newLocationId, withLocationIds, liftLocationFacts, mainLocationFacts,
  geoEntries, mergeGeo, stripGeo,
};
