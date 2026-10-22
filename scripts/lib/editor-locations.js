'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// editor-locations.js —— 编辑器 Website settings 的 Locations 区（#1980，Epic:MultiLocation T5）：root 字段 `locations` 的
//                         读值 / 校验 / 写盘合并，和「排序 / 删除之后，按下标的地点引用跟着挪」
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 编辑器只碰一家地点的这几样（§EDITABLE）：Name（`label`）/ Address / Phone / Email / Hours / Google Maps link，
//    以及「Fill from Google」带回来的评分和城市 / 街道 / 邮编。别的键（`slug` 地点页地址、`reviews` 建站存的评价、`geo` 坐标）
//    **不归编辑器**：读值时不给它（§editorLocations），写盘时按 `id` 从盘上那一家原样拿（§mergeLocations）——
//    · `geo` 不进版本（`locations.js` 文件头）：editor-data 把 `sites.geo` 并进了内存那份，编辑器交回来就会写进库；
//    · `slug` 生成一次就不再改（#1979 规则，正文做什么 6「改名不改 slug」）。
// 🔴 老站的营业时间还在默认语言 `seo.json` 里时，读值经 `liftLocationFacts`（同一条规则，#1976）—— 不然第一家读成没有营业时间，
//    老板一存就把它清掉。写盘那一侧由 `site-editor.js` §touchedFilesOf 先搬（`brand.json` 算这一笔碰到的）。
// 🔴 按下标的引用（`{source: "phone", location: 1}`，`item-sources.js` §locationOf）：排序 / 删除之后由 §remapLocationRefs 按 id
//    改成新下标；指向被删那一家的去掉 `location`（回到主地点）。没写 `location` 的 = 主地点，不动（拖到第一的那一家就是新的主地点）。
//
// 📌 浏览器包也用它（编辑器 Done 前的同一句话）：只 require 纯函数文件，不碰 node 模块。

const { withLocationIds, liftLocationFacts } = require('./locations');
const { canonicalDay, canonicalTime, hoursSegments } = require('./local-business-facts');
const { SOURCES } = require('./item-sources');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** 一家地点里编辑器能交的键（`id` 另算）。字符串那几样空了 = 删掉那个键。 */
const TEXT_KEYS = ['label', 'address', 'phone', 'email', 'googleMapsUrl', 'city', 'streetAddress', 'postalCode'];
const EDITABLE = [...TEXT_KEYS, 'hours', 'rating'];
/** 一个网站最多几家（列表一屏放得下；构建那一侧不限，这里给老板的列表定一个界，同菜单的 MENU_MAX）。 */
const MAX_LOCATIONS = 30;
/** 一家最多几段营业时间（同 `local-business-facts.js` 的 MAX_SEGMENTS：一周七天）。 */
const MAX_HOUR_ROWS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 引用里 `location` 是下标的那几种源：从 `item-sources.js` §SOURCES 现取（带 `params: { location: INDEX }` 的），以后加一个源这里自动跟上。 */
const INDEXED_SOURCES = Object.keys(SOURCES).filter((k) => SOURCES[k].params && SOURCES[k].params.location === 'index');

/** 这一家在列表、确认框里叫什么（同 `location-pages.js` §locName 的顺序：名字 → 城市 → 地址）。 */
const locationName = (l) => str(l && l.label).trim() || str(l && l.city).trim() || str(l && l.address).trim() || 'this location';

const pick = (l) => {
  const out = { id: l.id };
  for (const k of EDITABLE) if (l[k] !== undefined) out[k] = JSON.parse(JSON.stringify(l[k]));
  // 营业时间读成规整过的一组（老站那种单个对象、`Mon` 这种写法都认，`local-business-facts.js` §hoursSegments）—— 编辑器交回来的就是这个形状。
  if (out.hours !== undefined) {
    const rows = hoursSegments(out.hours);
    if (rows.length) out.hours = rows; else delete out.hours;
  }
  return out;
};

/**
 * Locations 区的现值：`brand.json` 的地点（老站的营业时间 / 评分经 §liftLocationFacts 放进第一家，没有 id 的按下标补），
 * 每家只留 §EDITABLE 那几样 + `id`。
 * @param {object} brand  `brand.json`
 * @param {object|null} seo 默认语言的 `seo.json`（没有 ⟹ null）
 */
function editorLocations(brand, seo) {
  if (!isObj(brand) || !Array.isArray(brand.locations)) return [];
  const lifted = liftLocationFacts(brand, seo);
  return withLocationIds(lifted.locations.filter(isObj)).map(pick);
}

/** 一段营业时间合不合格：星期是英文全名（`Monday` …）、时间是 `HH:MM`（00:00–24:00），同 `local-business-facts.js` 的判法。 */
function hoursRowOk(seg) {
  if (!isObj(seg) || Object.keys(seg).some((k) => k !== 'days' && k !== 'opens' && k !== 'closes')) return false;
  if (!Array.isArray(seg.days) || !seg.days.length || seg.days.some((d) => typeof d !== 'string' || canonicalDay(d) !== d)) return false;
  return [seg.opens, seg.closes].every((t) => typeof t === 'string' && canonicalTime(t) === t);
}

/**
 * 这一份 `locations` 能不能存。回 `null`（能）或 `{ bad: 句子 }`（形状不对 —— 编辑器发不出来的东西）/ `{ refuse: 句子 }`（给老板看的那句）。
 * 编辑器 Done（子页）和写盘（`editor-root.js` §checkShape）问的是同一个函数。
 */
function locationsProblem(list) {
  if (!Array.isArray(list)) return { bad: `locations 必须是数组：${JSON.stringify(list)}` };
  if (list.length > MAX_LOCATIONS) return { refuse: `A website can have up to ${MAX_LOCATIONS} locations. Nothing was changed.` };
  const ids = new Set();
  for (const [i, l] of list.entries()) {
    if (!isObj(l)) return { bad: `locations[${i}] 必须是对象：${JSON.stringify(l)}` };
    const extra = Object.keys(l).find((k) => k !== 'id' && !EDITABLE.includes(k));
    if (extra) return { bad: `locations[${i}] 里有编辑器改不了的键：${JSON.stringify(extra)}` };
    const textBad = TEXT_KEYS.find((k) => l[k] !== undefined && typeof l[k] !== 'string');
    if (textBad) return { bad: `locations[${i}].${textBad} 必须是字符串：${JSON.stringify(l[textBad])}` };
    if (l.rating !== undefined && !isObj(l.rating)) return { bad: `locations[${i}].rating 必须是对象：${JSON.stringify(l.rating)}` };
    const name = locationName(l);
    if (typeof l.id !== 'string' || !l.id.trim()) {
      return { refuse: `The location "${name}" is missing its id. Reload the editor and try again. Nothing was changed.` };
    }
    if (ids.has(l.id)) return { refuse: `Two locations have the same id (${l.id}). Reload the editor and try again. Nothing was changed.` };
    ids.add(l.id);
    const email = str(l.email).trim();
    if (email && !EMAIL_RE.test(email)) return { refuse: `The email "${email.slice(0, 60)}" of ${name} is not an email address. Nothing was changed.` };
    if (l.hours !== undefined) {
      if (!Array.isArray(l.hours)) return { bad: `locations[${i}].hours 必须是数组：${JSON.stringify(l.hours)}` };
      if (l.hours.length > MAX_HOUR_ROWS) return { refuse: `${name} can have up to ${MAX_HOUR_ROWS} rows of opening hours. Nothing was changed.` };
      if (!l.hours.every(hoursRowOk)) {
        return { refuse: `The opening hours of ${name} are not valid: pick at least one day, and use times from 00:00 to 24:00. Nothing was changed.` };
      }
    }
  }
  return null;
}

/**
 * 写盘：老板交来的这一份（已过 §locationsProblem）× 盘上那一份 → 要写进 `brand.json` 的 `locations`。
 * 顺序、增删照老板的；每一家按 `id` 从盘上那一家起步，§EDITABLE 那几样换成交来的（没交 / 空串 = 删掉那个键），
 * 别的键（`slug` / `reviews` / `geo` …）原样留着。盘上那一份没有 id 的按下标补（同读值那一侧，两边对得上）。
 */
function mergeLocations(stored, incoming) {
  const before = new Map(withLocationIds((Array.isArray(stored) ? stored : []).filter(isObj)).map((l) => [l.id, l]));
  return incoming.map((l) => {
    const base = before.get(l.id) || {};
    const value = (k) => {
      if (TEXT_KEYS.includes(k)) return str(l[k]).trim() || undefined;
      if (k === 'hours') return Array.isArray(l.hours) && l.hours.length ? l.hours.map((s) => ({ days: [...s.days], opens: s.opens, closes: s.closes })) : undefined;
      return l[k] === undefined ? undefined : JSON.parse(JSON.stringify(l[k]));
    };
    // 键序照盘上那一家（diff 只落在真改的那一格）；新出现的几样接在后面。
    const out = { id: l.id };
    for (const [k, v] of Object.entries(base)) {
      if (k === 'id') continue;
      if (!EDITABLE.includes(k)) out[k] = v;
      else if (value(k) !== undefined) out[k] = value(k);
    }
    for (const k of EDITABLE) if (!(k in out) && value(k) !== undefined) out[k] = value(k);
    return out;
  });
}

/** 引用指的 `location` 下标该换成什么：`undefined` = 不动；`null` = 去掉 `location`；数字 = 新下标。 */
function nextIndex(i, beforeIds, afterIndex) {
  const id = beforeIds[i];
  if (id === undefined) return undefined; // 本来就指着一家不存在的地点：不是这一笔造成的，不碰
  if (!afterIndex.has(id)) return null;
  const j = afterIndex.get(id);
  return j === i ? undefined : j;
}

/** 就地改一份 JSON 里所有按下标的地点引用；回改了几处。 */
function remapIn(node, beforeIds, afterIndex) {
  let n = 0;
  if (Array.isArray(node)) {
    for (const v of node) n += remapIn(v, beforeIds, afterIndex);
    return n;
  }
  if (!isObj(node)) return 0;
  if (INDEXED_SOURCES.includes(node.source) && Number.isInteger(node.location)) {
    const j = nextIndex(node.location, beforeIds, afterIndex);
    if (j === null) { delete node.location; n += 1; } else if (j !== undefined) { node.location = j; n += 1; }
  }
  for (const v of Object.values(node)) n += remapIn(v, beforeIds, afterIndex);
  return n;
}

/** 排序 / 删除前后的下标对照；前后每一家的位置都没变 ⟹ null（什么都不用挪）。 */
function indexMap(beforeLocations, afterLocations) {
  const beforeIds = withLocationIds((Array.isArray(beforeLocations) ? beforeLocations : []).filter(isObj)).map((l) => l.id);
  const afterIndex = new Map(withLocationIds((Array.isArray(afterLocations) ? afterLocations : []).filter(isObj)).map((l, i) => [l.id, i]));
  return beforeIds.every((id, i) => afterIndex.get(id) === i) ? null : { beforeIds, afterIndex };
}

/**
 * 同 §remapLocationRefs 的那一步，但就地改**一个**值（任意形状的 JSON：一份页面、编辑器画布的一份 data、一条撤销快照）；回改了几处。
 * 编辑器在存盘成功之后拿它把画布手上的那几份对齐到库里（r2：服务器挪过的下标，画布不跟着挪，下一笔就把旧下标写回去）。
 */
function remapLocationRefsIn(doc, beforeLocations, afterLocations) {
  const m = indexMap(beforeLocations, afterLocations);
  return m ? remapIn(doc, m.beforeIds, m.afterIndex) : 0;
}

/** 会写按下标地点引用的那几种文件：页面、`navigation.json`、`blocks/site-blocks.json`（扁平站在根上，多语言站在 `<语言>/` 下）。 */
const REF_FILE_RE = /^(?:[^/]+\/)?(?:pages\/.+\.json|navigation\.json|blocks\/site-blocks\.json)$/;

/**
 * 排序 / 删除之后，content 里按下标的地点引用改成新下标（见文件头）。
 * @param {object} content  键 = site/ 下的相对路径，值 = 解析过的 JSON（或 JSON 字符串）
 * @param {object[]} beforeLocations 这一笔之前的 `brand.locations`（没有 id 的按下标补，同 §editorLocations）
 * @param {object[]} afterLocations  这一笔之后的
 * @returns {{ [rel: string]: object }} 改到的那几份文件（整份；没改 ⟹ `{}`）
 */
function remapLocationRefs(content, beforeLocations, afterLocations) {
  const m = indexMap(beforeLocations, afterLocations);
  if (!m) return {};
  const { beforeIds, afterIndex } = m;
  const out = {};
  for (const [rel, raw] of Object.entries(content || {})) {
    if (!REF_FILE_RE.test(rel)) continue;
    let doc;
    try {
      doc = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(JSON.stringify(raw));
    } catch {
      continue; // 坏的 JSON 由别的校验说
    }
    if (remapIn(doc, beforeIds, afterIndex)) out[rel] = doc;
  }
  return out;
}

module.exports = { EDITABLE, MAX_LOCATIONS, MAX_HOUR_ROWS, locationName, editorLocations, locationsProblem, mergeLocations, remapLocationRefs, remapLocationRefsIn };
