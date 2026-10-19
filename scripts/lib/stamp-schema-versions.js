'use strict';
// #1829 (SiteAsData T3a) 定接口、#1838 (T4b) 填实 —— 给 content 里的块盖上它这一型的 schemaVersion（设计文档 §8.4 ①）。
//   prev  这一笔之前的 content（建站没有之前，传 null）。`save` 传**迁移后的**那份（不然刚迁到 v2 的块又被盖回 1）
//   next  这一笔之后的 content
//   返回  盖过版本号的 next（没变的文件原样共享；入参不被改）
//
// 规则（所有写入方走这一个函数：`save` / `validate` / `create`）：
//   · 已经带号的块不动
//   · 在 prev 里找得到「同一个块」的 ⟹ 继承它的号；它没写号（= 1）⟹ 这边也不写（没碰的页因此逐字节不变）
//   · 找不到的 = 新块 ⟹ 盖这一型当前的号（manifest 的 `schemaVersion`）
// 「同一个块」：同一份文件里同一个 `id` 且同一个 `type`；没有 `id` 的老形状 `sections` 按位置（同一个下标、同一个 type）；
// 共用块按 `site-blocks.json` 的键；顶栏 / 页脚按 `navigation.json` 的 `header` / `footer`。块目录里没有的类型不盖。
// 🔴 已知残留（本票不出现，第一次有机会是 T4b-2）：AI 改站**就地**改了一个老块（id 不变）却按新形状写回来，它继承旧号。
const { loadBlockVersions } = require('./block-migrations');

const PAGE_KEY_RE = /(^|\/)pages\/.+\.json$/;
const SHARED_KEY_RE = /(^|\/)blocks\/site-blocks\.json$/;
const NAV_KEY_RE = /(^|\/)navigation\.json$/;
const REGIONS = ['header', 'footer'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parsed = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
};

function stampOne(block, before, type, versions) {
  if (!isObj(block) || block.schemaVersion !== undefined) return block;
  const info = versions.get(type);
  if (!info) return block;
  if (isObj(before) && (before.type === undefined || before.type === block.type)) {
    return before.schemaVersion === undefined ? block : { ...block, schemaVersion: before.schemaVersion };
  }
  return { ...block, schemaVersion: info.schemaVersion };
}

function stampFile(rel, value, prevValue, versions) {
  const doc = parsed(value);
  if (!isObj(doc)) return null;
  const was = parsed(prevValue);
  const prevDoc = isObj(was) ? was : {};
  let changed = false;
  const out = { ...doc };
  const put = (block, before, type) => {
    const s = stampOne(block, before, type, versions);
    if (s !== block) changed = true;
    return s;
  };
  if (PAGE_KEY_RE.test(rel)) {
    for (const field of ['blocks', 'sections']) {
      if (!Array.isArray(doc[field])) continue;
      const old = Array.isArray(prevDoc[field]) ? prevDoc[field] : [];
      const byId = new Map();
      for (const b of old) if (isObj(b) && typeof b.id === 'string' && b.id && !byId.has(b.id)) byId.set(b.id, b);
      out[field] = doc[field].map((b, i) => {
        if (!isObj(b)) return b;
        const hasId = typeof b.id === 'string' && b.id;
        const before = hasId ? byId.get(b.id) : (isObj(old[i]) && !old[i].id ? old[i] : undefined);
        return put(b, before && before.type === b.type ? before : undefined, b.type);
      });
    }
  } else if (SHARED_KEY_RE.test(rel)) {
    for (const [id, b] of Object.entries(doc)) {
      if (!isObj(b)) continue;
      const before = isObj(prevDoc[id]) && prevDoc[id].type === b.type ? prevDoc[id] : undefined;
      out[id] = put(b, before, b.type);
    }
  } else if (NAV_KEY_RE.test(rel)) {
    for (const region of REGIONS) {
      if (!isObj(doc[region])) continue;
      out[region] = put(doc[region], isObj(prevDoc[region]) ? prevDoc[region] : undefined, region);
    }
  } else {
    return null;
  }
  return changed ? out : null;
}

function stampSchemaVersions(prev, next, { blocksDir } = {}) {
  if (!isObj(next)) return next;
  const versions = loadBlockVersions(blocksDir);
  const before = isObj(prev) ? prev : {};
  let out = next;
  for (const rel of Object.keys(next)) {
    const s = stampFile(rel, next[rel], before[rel], versions);
    if (s) {
      if (out === next) out = { ...next };
      out[rel] = s;
    }
  }
  return out;
}

module.exports = { stampSchemaVersions };
