'use strict';
// #1839 (SiteAsData T4c) —— 块的「② 弹窗升级」「③ 弹窗退役」两类变化：哪块该弹、弹哪种、点了 Update 怎么迁、冻结怎么换（设计文档 §8.2）。
//
// 纯函数（输入 content + §block-migrations.js loadBlockVersions 的那张表；测试拿假块目录读的那张喂）：
//   pendingChangesOf(content, versions, { uiFlags })
//       → { upgrades: [{ blockId, type, label, from, to, toType?, toLabel?, file }], retired: [{ blockId, type, label, file }] }
//       upgrade：块停在旧 `schemaVersion`（往上走的路上有一步 `preservesLook: false`），或它的类型有一步 `<旧>→<新>` 跨类型迁移
//                标着 `preservesLook: false`。只算带 id 的页面块和共用块（没 id 的老形状锁不住、也点不了 Update）。
//       retired：Custom HTML 块带 `frozenFrom`，而 `uiFlags.frozenAcknowledged` 里没有它的 id（老板还没点过 OK）。
//   migrateBlocks(content, ids, versions)   点 Update：只迁 `ids` 里还待升级的那几块，整条链（`false` 的那几步也跑）+ 跨类型那一步，
//       版本号写成新号（§stamp-schema-versions 对带号的块不动 ⟹ 不会被盖回旧号）。→ { content, migrated: [{ blockId, type, toType, label }] }
//   upgradeAt(content, scope, versions)     AI 改站的 `--scope` 指到的是不是一块待升级的块（`needs-upgrade`，§site-edit.js）。
//   freezeContent(content, type, rendered, versions, { ids?, label? })   冻结：那一型的每一块（给了 ids 就只那几块）换成
//       Custom HTML（`frozenFrom`、`attrs`），`rendered` 是 `site.js render --only-blocks` 的产物（`<locale>/<id>` → { html, css, attrs }）。
//
// 🔴 「样子会不会变」只问迁移表自己的 `preservesLook`，不另判；`true` 的那几步由 §block-migrations 在读写时悄悄跑，这里不碰。
const { loadBlockVersions } = require('./block-migrations');

const PAGE_KEY_RE = /(^|\/)pages\/.+\.json$/;
const SHARED_KEY_RE = /(^|\/)blocks\/site-blocks\.json$/;
const TYPE_STEP_RE = /^([a-z0-9-]+)→([a-z0-9-]+)$/;
const CUSTOM_HTML = 'custom-html';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parsed = (v) => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
};
const clone = (v) => JSON.parse(JSON.stringify(v));

/** `pricing` → `Pricing`，`page-header` → `Page header`（块代码删了、manifest 读不到时的名字；同 custom-html Section §typeName）。 */
function humanize(type) {
  const t = String(type).replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

const labelOf = (versions, type) => (versions.get(type) && versions.get(type).label) || humanize(type);

/** 跨类型的那几步：旧类型 → `{ to, step }`。只认目标类型还在块目录里的。 */
function crossStepsOf(versions) {
  const out = new Map();
  for (const info of versions.values()) {
    for (const [key, step] of Object.entries(info.migrations || {})) {
      const m = key.match(TYPE_STEP_RE);
      if (m && versions.has(m[2]) && !out.has(m[1])) out.set(m[1], { to: m[2], step });
    }
  }
  return out;
}

/** 一块待不待升级：`{ from, to, toType? }` 或 null。走不通的链（缺一步）不算 —— 那是画不出来，由渲染入口报。 */
function upgradeOf(block, versions, cross) {
  if (!isObj(block) || typeof block.type !== 'string') return null;
  const info = versions.get(block.type);
  if (!info) return null;
  const from = block.schemaVersion === undefined ? 1 : block.schemaVersion;
  if (!Number.isInteger(from)) return null;
  let needsOwner = false;
  for (let v = from; v < info.schemaVersion; v += 1) {
    const step = info.migrations[`${v}→${v + 1}`];
    if (!step) return null;
    if (step.preservesLook !== true) needsOwner = true;
  }
  const x = cross.get(block.type);
  if (x && x.step.preservesLook !== true) return { from, to: versions.get(x.to).schemaVersion, toType: x.to };
  return needsOwner ? { from, to: info.schemaVersion } : null;
}

/** 整条链 + 跨类型那一步，样子会变的也跑（老板点了 Update）。 */
function migrateFully(block, versions, cross) {
  const info = versions.get(block.type);
  let cur = block;
  let v = cur.schemaVersion === undefined ? 1 : cur.schemaVersion;
  while (v < info.schemaVersion) {
    const next = info.migrations[`${v}→${v + 1}`].migrate(clone(cur));
    if (!isObj(next)) throw new Error(`${block.type} 的迁移 ${v}→${v + 1} 没有返回一个对象`);
    v += 1;
    cur = { ...next, schemaVersion: v };
  }
  const x = cross.get(block.type);
  if (x && x.step.preservesLook !== true) {
    const next = x.step.migrate(clone(cur));
    if (!isObj(next)) throw new Error(`${block.type}→${x.to} 的迁移没有返回一个对象`);
    cur = { ...next, type: x.to, schemaVersion: versions.get(x.to).schemaVersion };
  }
  return cur;
}

/**
 * content 里每一个页面块 / 共用块：`fn({ rel, block, id })`，回一个新块 = 换掉它（回原块 = 不动）。回 `{ content, changed }`，
 * 没变的文件原样共享。
 */
function mapBlocks(content, fn) {
  if (!isObj(content)) return { content, changed: false };
  let out = content;
  let changed = false;
  for (const rel of Object.keys(content)) {
    const isPage = PAGE_KEY_RE.test(rel);
    if (!isPage && !SHARED_KEY_RE.test(rel)) continue;
    const doc = parsed(content[rel]);
    if (!isObj(doc)) continue;
    let fileChanged = false;
    const next = { ...doc };
    const visit = (b, id) => {
      const r = fn({ rel, block: b, id });
      if (r !== b) fileChanged = true;
      return r;
    };
    if (isPage) {
      for (const field of ['blocks', 'sections']) {
        if (Array.isArray(doc[field])) next[field] = doc[field].map((b) => (isObj(b) ? visit(b, typeof b.id === 'string' && b.id ? b.id : '') : b));
      }
    } else {
      for (const [id, b] of Object.entries(doc)) if (isObj(b)) next[id] = visit(b, id);
    }
    if (fileChanged) {
      if (out === content) out = { ...content };
      out[rel] = next;
      changed = true;
    }
  }
  return { content: out, changed };
}

function forEachBlock(content, fn) {
  mapBlocks(content, (x) => { fn(x); return x.block; });
}

/** content 里这一型的块的 id（去重；没 id 的老形状块不在里面 —— 它冻不了，§freezeContent 会把它报成 missing）。 */
function blockIdsOfType(content, type) {
  const ids = [];
  forEachBlock(content, ({ block, id }) => { if (block.type === type && id && !ids.includes(id)) ids.push(id); });
  return ids;
}

function pendingChangesOf(content, versions = loadBlockVersions(), { uiFlags } = {}) {
  const cross = crossStepsOf(versions);
  const acked = new Set(isObj(uiFlags) && Array.isArray(uiFlags.frozenAcknowledged) ? uiFlags.frozenAcknowledged.filter((x) => typeof x === 'string') : []);
  const upgrades = [];
  const retired = [];
  forEachBlock(content, ({ rel, block, id }) => {
    if (!id) return;
    const u = upgradeOf(block, versions, cross);
    if (u) {
      upgrades.push({
        blockId: id, type: block.type, label: labelOf(versions, block.type), from: u.from, to: u.to,
        ...(u.toType ? { toType: u.toType, toLabel: labelOf(versions, u.toType) } : {}), file: rel,
      });
      return;
    }
    const from = block.type === CUSTOM_HTML && isObj(block.data) && typeof block.data.frozenFrom === 'string' ? block.data.frozenFrom : '';
    if (from && !acked.has(id)) retired.push({ blockId: id, type: from, label: labelOf(versions, from), file: rel });
  });
  return { upgrades, retired };
}

function migrateBlocks(content, ids, versions = loadBlockVersions()) {
  const want = new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && x));
  const cross = crossStepsOf(versions);
  const migrated = [];
  const seen = new Set();
  const r = mapBlocks(content, ({ block, id }) => {
    if (!id || !want.has(id) || !upgradeOf(block, versions, cross)) return block;
    const next = migrateFully(block, versions, cross);
    if (!seen.has(id)) {
      seen.add(id);
      migrated.push({ blockId: id, type: block.type, toType: next.type, label: labelOf(versions, block.type) });
    }
    return next;
  });
  return { content: r.content, migrated };
}

/** `scope` = `{ page, locale?, blockId? }`（AI 改站那一份）指到的那块待升级 ⟹ pendingChangesOf 的那一条；否则 null。 */
function upgradeAt(content, scope, versions = loadBlockVersions()) {
  if (!isObj(scope) || typeof scope.blockId !== 'string' || !scope.blockId || typeof scope.page !== 'string') return null;
  const page = scope.page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fileRe = new RegExp(`(^|/)pages/${page}\\.json$`);
  const { upgrades } = pendingChangesOf(content, versions);
  return upgrades.find((u) => {
    const loc = (u.file.match(/^([^/]+)\/(pages|blocks)\//) || [])[1];
    return u.blockId === scope.blockId && (fileRe.test(u.file) || SHARED_KEY_RE.test(u.file)) && (!scope.locale || !loc || loc === scope.locale);
  }) || null;
}

/** 一份 content 文件属于哪种语言：`en/pages/x.json` → en；扁平老站（`pages/x.json`）→ `defaultLocale`。 */
function localeOfFile(rel, defaultLocale) {
  const m = rel.match(/^([^/]+)\/(pages|blocks)\//);
  return m ? m[1] : defaultLocale;
}

/**
 * 冻结（§8.2 ③）：`type` 的每一块换成 Custom HTML。`rendered` 里找不到那块（这一块在哪一页上都没画出来，比如一页
 * 被藏了）⟹ 那块原样不动、记进 `missing`（执行器据此报，不悄悄丢内容）。
 * 换成的块：`{ id, type: 'custom-html', schemaVersion: 1, role?, region?, weight?, visibility?, data: { html, label, frozenFrom, attrs } }`
 *   html  = `<style>`（那一型在 shapes.css 里那一段）+ `<section>` 里面那段，逐字（Custom HTML 没有 css 字段了，样式就写在 html 里）
 *   attrs = 容器自己的属性，去掉 `data-block-id` / `id`（身份只认块的 id）；套回去时过 §sanitize-css.js frozenContainerAttrs
 */
function freezeContent(content, type, rendered, versions = loadBlockVersions(), { defaultLocale = 'en', ids, label: named } = {}) {
  // #1840 (T4d 自愈) —— `ids`：只冻这几块（`unsupported schemaVersion` 只点名停在画不出那一版的块，同型别的块照常画）；
  //   `label`：类型在这份包里已经删了时，名字从画它的那份旧包的 manifest 来（这份包只剩 §humanize）。
  const only = Array.isArray(ids) ? new Set(ids) : null;
  const label = typeof named === 'string' && named ? named : labelOf(versions, type);
  const frozen = [];
  const missing = [];
  const r = mapBlocks(content, ({ rel, block, id }) => {
    if (block.type !== type) return block;
    if (only && !only.has(id)) return block;
    const got = id ? rendered.get(`${localeOfFile(rel, defaultLocale)}/${id}`) || rendered.get(`${defaultLocale}/${id}`) : null;
    if (!got) { missing.push(`${rel}#${id || '(no id)'}`); return block; }
    const { 'data-block-id': _id, id: _htmlId, ...attrs } = got.attrs || {};
    const keep = {};
    for (const k of ['role', 'region', 'weight', 'visibility']) if (block[k] !== undefined) keep[k] = block[k];
    frozen.push(id);
    return {
      id, type: CUSTOM_HTML, schemaVersion: 1, ...keep,
      data: { html: `${got.css ? `<style>${got.css}</style>` : ''}${got.html}`, label, frozenFrom: type, attrs },
    };
  });
  return { content: r.content, frozen, missing, label };
}

module.exports = { pendingChangesOf, blockIdsOfType, migrateBlocks, upgradeAt, freezeContent, crossStepsOf, upgradeOf, humanize, localeOfFile, labelOf };
