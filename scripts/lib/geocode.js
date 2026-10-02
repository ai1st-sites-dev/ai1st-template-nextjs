'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// geocode.js —— 地址 → 坐标，查一次存进站点数据（#1489，contact 的地图要 bbox / marker）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 走 OSM 的 Nominatim（`nominatim.openstreetmap.org/search`，不要 key）。它的使用条款
// （operations.osmfoundation.org/policies/nominatim/）要三条，这里逐条照做：
//   ① 每秒最多 1 次 —— 本进程内两次请求之间至少隔 MIN_INTERVAL_MS（下面 §throttle）；
//   ② User-Agent 要认得出是哪个应用 —— 产品名 + 产品网址；🔴 不写任何个人邮箱，也不许是 http 库的默认值；
//   ③ 结果缓存 —— 查到的坐标写进站点数据（`brand.locations[0].geo`），页面打开时不查；同一进程里同一个地址也只查一次。
// 🔴 调用点只有两处：建站（`create-site.js`，组好 brand 之后）与改站时地址变了（`edit-site.js` 写 brand.json 那一步）。
//    「一个地址写入时查一次」不是条款禁的批量地理编码。
// 🔴 **查不到 / 网络错 / 超时 ⟹ 返回 null，不抛**：调用方据此不写 `geo`，地图不渲染，其余照常 —— 建站不许因为地图失败。
// 🔴 这里只查坐标。地图**瓦片**一张都不取、不存（瓦片条款第 4 节禁预取和离线用，正文「地图」②）。

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'ai1st-site-builder/1.0 (+https://www.ai1st.site)';
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 8000;

let lastAt = 0;
const cache = new Map();

/** 两次请求之间至少隔 MIN_INTERVAL_MS（条款 ①）。`now` / `sleep` 可注入，单测不真等。 */
async function throttle({ now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const wait = lastAt + MIN_INTERVAL_MS - now();
  if (wait > 0) await sleep(wait);
  lastAt = now();
}

/**
 * @param {string} address
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, sleep?: (ms: number) => Promise<void>, log?: (m: string) => void }} [opts]
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
async function geocodeAddress(address, opts = {}) {
  const q = typeof address === 'string' ? address.trim() : '';
  if (!q) return null;
  if (cache.has(q)) return cache.get(q);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const log = opts.log || (() => {});
  if (typeof fetchImpl !== 'function') { log('geocode: no fetch available'); return null; }
  await throttle(opts);
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ q, format: 'json', limit: '1' })}`;
  let result = null;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: ac ? ac.signal : undefined });
    if (!res || !res.ok) {
      log(`geocode: HTTP ${res ? res.status : '?'} for "${q}"`);
    } else {
      const rows = await res.json();
      const hit = Array.isArray(rows) ? rows[0] : null;
      const lat = hit ? Number(hit.lat) : NaN;
      const lng = hit ? Number(hit.lon) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) result = { lat, lng };
      else log(`geocode: no result for "${q}"`);
    }
  } catch (e) {
    log(`geocode: ${e && e.message ? e.message : e} for "${q}"`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  cache.set(q, result);
  return result;
}

/**
 * 站点数据里第一个地点：地址有值就查一次写 `geo`，查不到就删掉 `geo`（不留一个指着别处的旧坐标）。原地改 `brand`。
 * @returns {Promise<'set' | 'cleared' | 'skipped'>}
 */
async function geocodeBrand(brand, opts = {}) {
  const loc = brand && Array.isArray(brand.locations) ? brand.locations[0] : null;
  if (!loc || typeof loc !== 'object') return 'skipped';
  const geo = await geocodeAddress(loc.address, opts);
  if (geo) { loc.geo = geo; return 'set'; }
  delete loc.geo;
  return 'cleared';
}

/**
 * 改站那条路（`edit-site.js`）：这一次编辑写过 `brand.json`、而第一个地点的地址跟编辑前不一样 ⟹ 重查一次坐标写回文件
 * （查不到就删掉旧 `geo` —— 地址改了、钉子还扎在老地方，比没有地图更坏）。地址没变 ⟹ 一个请求都不发、文件不动。
 * `before` 是编辑前那份文件的字节（`writeSnapshots` 里记的；文件原来不存在就是 null）。
 * @returns {Promise<'set' | 'cleared' | 'unchanged' | 'skipped' | 'raced'>}
 */
async function refreshGeoAfterEdit(brandPath, before, opts = {}) {
  const fs = opts.fs || require('fs');
  const addrOf = (doc) => {
    const loc = doc && Array.isArray(doc.locations) ? doc.locations[0] : null;
    return loc && typeof loc.address === 'string' ? loc.address.trim() : '';
  };
  let now;
  try { now = JSON.parse(fs.readFileSync(brandPath, 'utf-8')); } catch (e) { return 'skipped'; }
  let prev = null;
  try { prev = before ? JSON.parse(Buffer.isBuffer(before) ? before.toString('utf-8') : String(before)) : null; } catch (e) { prev = null; }
  if (addrOf(now) === addrOf(prev)) return 'unchanged';
  const r = await geocodeBrand(now, opts);
  if (r === 'skipped') return 'skipped';
  // `opts.write` —— 调用方（edit-site.js §rewriteOnBehalfOfAi）要在写的那一刻核对盘上还是不是 AI 写的那份，并把这一笔
  // 记进它的「AI 写过」台账（否则回滚认不出它）。回 false = 没写（查坐标那几秒里别处存过这个文件）。
  const bytes = `${JSON.stringify(now, null, 2)}\n`;
  if (opts.write) return opts.write(brandPath, bytes) ? r : 'raced';
  fs.writeFileSync(brandPath, bytes);
  return r;
}

/** 单测用：清掉进程内的缓存与节流时间点。 */
function _reset() { lastAt = 0; cache.clear(); }

module.exports = { NOMINATIM_URL, USER_AGENT, MIN_INTERVAL_MS, geocodeAddress, geocodeBrand, refreshGeoAfterEdit, _reset };
