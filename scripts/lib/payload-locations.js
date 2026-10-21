'use strict';
// #1977（Epic:MultiLocation T2）—— 建站 payload 的 `locations` 怎么读成要写进 `brand.json` 的地点。只有建站脚本用（create-site.js、
// lib/fallback-site.js 收它的结果），所以不放进 `locations.js`：那一份进浏览器的 runtime 包，多一个函数整个包的哈希就变了。

const { usableRating } = require('./locations');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * #1977 —— 建站 payload 的 `locations`（确认页那张地点列表，一行一项）→ `{ location, hours }` 一组：`location` 是要写进 `brand.json`
 * 的字段（字符串字段原样，空的不写这一键；`rating` 能用（§usableRating）才写，原样），`hours` 是老板给的那段营业时间文字（要转写
 * 成段，create-site.js §locationsWithFacts 的事，这里不碰）。什么都没填的那一行去掉；不是数组 / 一行都不剩 ⟹ null（走没有地点的老路）。
 */
const PAYLOAD_LOCATION_TEXT = ['label', 'address', 'phone', 'googleMapsUrl', 'city', 'streetAddress', 'postalCode'];
function payloadLocations(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const l of list) {
    if (!isObj(l)) continue;
    const location = {};
    for (const k of PAYLOAD_LOCATION_TEXT) if (typeof l[k] === 'string' && l[k].trim()) location[k] = l[k];
    if (usableRating(l.rating)) location.rating = l.rating;
    const hours = typeof l.hours === 'string' ? l.hours.trim() : '';
    if (Object.keys(location).length || hours) out.push({ location, hours });
  }
  return out.length ? out : null;
}

module.exports = { payloadLocations };
