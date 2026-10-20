'use strict';
// #1838 (SiteAsData T4b) —— 块的数据版本 + 迁移（设计文档 §8.4 ①、§8.2 ①）。
//
// 每个块文件夹的 manifest 写 `schemaVersion`（内容该是哪一版）和 `renders`（组件还画得了哪几版）；块实例在内容里记自己的
// `schemaVersion`（没写 = 1）。顶栏 / 页脚这两个外壳区的号记在 `<语言>/navigation.json` 的 `header` / `footer` 对象上。
// 块改了数据形状就在它的文件夹里写一份可选的 `migrations.js`：
//
//   module.exports = {
//     '1→2': { migrate: (block) => block, preservesLook: true },     // 同类型、相邻两版
//     'cta→buttons': { migrate: …, preservesLook: false },          // 跨类型（T4c 用；这里只认形状、不跑）
//   };
//
// `migrate` 只改数据形状，拿到的是一份深拷贝；**版本号由这里写上 `to`**，迁移函数自己不写。
// 🔴 只跑 `preservesLook: true` 的那几步（样子不变 ⟹ 老板看不出来，可以悄悄升）。一步是 `false` 就停在它前面：
//    样子会变的那一步要老板点头（弹窗归 T4c），这里只登记、不跑。
//
// 用的地方（都只跑 `true` 的）：
//   · 写库那一笔（`derive-core.js` §contentPatchesOf 的 `touchedFiles`）—— 只迁这一笔本来就碰的文件，其余原样
//   · 读的时候（§migrateInMemory，`editor-data` / `render`）—— 全量迁、不落库
const fs = require('fs');
const path = require('path');
const blockPaths = require('./block-paths');

const PAGE_KEY_RE = /(^|\/)pages\/.+\.json$/;
const SHARED_KEY_RE = /(^|\/)blocks\/site-blocks\.json$/;
const NAV_KEY_RE = /(^|\/)navigation\.json$/;
const REGIONS = ['header', 'footer'];
const STEP_RE = /^(\d+)→(\d+)$/;
const TYPE_STEP_RE = /^([a-z0-9-]+)→([a-z0-9-]+)$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** 一份 `migrations.js` 的表，形状不对当场 throw（写歪的方向是静默的：认不出的一步永远不跑）。 */
function checkMigrationTable(type, table, file) {
  if (!isObj(table)) throw new Error(`${file}: 要导出一个对象 { '<from>→<to>': { migrate, preservesLook } }`);
  for (const [key, step] of Object.entries(table)) {
    const where = `${file} 的 ${JSON.stringify(key)}`;
    const num = key.match(STEP_RE);
    if (num) {
      if (Number(num[2]) !== Number(num[1]) + 1 || Number(num[1]) < 1) throw new Error(`${where}: 同类型的一步只能是相邻两版（n→n+1，n ≥ 1）`);
    } else if (!TYPE_STEP_RE.test(key)) {
      throw new Error(`${where}: 键只能是 '<n>→<n+1>' 或 '<旧类型>→<新类型>'`);
    }
    if (!isObj(step) || typeof step.migrate !== 'function') throw new Error(`${where}: 要有 migrate 函数`);
    if (typeof step.preservesLook !== 'boolean') throw new Error(`${where}: preservesLook 必须写明 true 或 false`);
  }
  return table;
}

const cache = new Map();

/**
 * 块目录里每个块的版本信息：类型 → `{ schemaVersion, renders, region, migrations, retired, label }`。没写版本 = 1 / [1]。
 * 默认块目录经 §block-paths（测试改道到带假块的临时目录时跟着走）。同一个目录一个进程只读一次。
 */
function loadBlockVersions(dir = blockPaths.blocksDir()) {
  if (cache.has(dir)) return cache.get(dir);
  const out = new Map();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const type = typeof m.type === 'string' && m.type ? m.type : e.name;
    const schemaVersion = Number.isInteger(m.schemaVersion) ? m.schemaVersion : 1;
    const migFile = path.join(dir, e.name, 'migrations.js');
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const migrations = fs.existsSync(migFile) ? checkMigrationTable(type, require(migFile), path.relative(dir, migFile)) : {};
    out.set(type, {
      schemaVersion,
      renders: Array.isArray(m.renders) ? m.renders : [schemaVersion],
      region: m.region === true,
      migrations,
      // #1839 (T4c) —— 退役（只是不可添加，代码留着照画）和弹窗里说的名字（manifest 的 `displayName`，没写 = 类型名）。
      retired: m.retired === true,
      label: typeof m.displayName === 'string' && m.displayName ? m.displayName : type,
    });
  }
  cache.set(dir, out);
  return out;
}

/**
 * 一个块往当前版走，只走 `preservesLook: true` 的那几步。`type` 不给 = 读块自己的 `type`（外壳区的对象上没有 type，调用方给）。
 * 回 `{ block, changed }`；没变的时候 `block` 就是传进来的那一个（不拷）。版本号不是整数的块原样不动（画不出来由渲染入口报）。
 */
function migrateBlock(block, versions, type = block && block.type) {
  if (!isObj(block)) return { block, changed: false };
  const info = versions.get(type);
  if (!info) return { block, changed: false };
  let v = block.schemaVersion === undefined ? 1 : block.schemaVersion;
  if (!Number.isInteger(v)) return { block, changed: false };
  let cur = block;
  let changed = false;
  while (v < info.schemaVersion) {
    const step = info.migrations[`${v}→${v + 1}`];
    if (!step || step.preservesLook !== true) break;
    const next = step.migrate(clone(cur));
    if (!isObj(next)) throw new Error(`${type} 的迁移 ${v}→${v + 1} 没有返回一个对象`);
    v += 1;
    cur = { ...next, schemaVersion: v };
    changed = true;
  }
  return { block: cur, changed };
}

/** content 里一份文件迁一遍（页面 / 共用块 / 菜单的顶栏页脚；别的文件原样）。回新对象，没变回 `null`。 */
function migrateFile(rel, value, versions) {
  const isPage = PAGE_KEY_RE.test(rel);
  const isShared = SHARED_KEY_RE.test(rel);
  const isNav = NAV_KEY_RE.test(rel);
  if (!isPage && !isShared && !isNav) return null;
  let doc;
  try { doc = parsed(value); } catch { return null; } // 不是合法 JSON 的由派生那一步报
  if (!isObj(doc)) return null;
  let changed = false;
  const out = { ...doc };
  if (isPage) {
    for (const field of ['blocks', 'sections']) {
      if (!Array.isArray(doc[field])) continue;
      out[field] = doc[field].map((b) => {
        const r = migrateBlock(b, versions);
        if (r.changed) changed = true;
        return r.block;
      });
    }
  } else if (isShared) {
    for (const [id, b] of Object.entries(doc)) {
      const r = migrateBlock(b, versions);
      if (r.changed) { out[id] = r.block; changed = true; }
    }
  } else {
    for (const region of REGIONS) {
      const r = migrateBlock(doc[region], versions, region);
      if (r.changed) { out[region] = r.block; changed = true; }
    }
  }
  return changed ? out : null;
}

/**
 * 只迁 `touchedFiles` 里那几份（写库那一笔本来就碰的文件）。回 `{ '<相对路径>': 迁过的对象 }`，没变的不在里面。
 * 🔴 只落碰到的文件：平台涨了版本之后，老板第一次保存不该顺手改掉所有含旧块的页（另一个标签页 / AI 改别的页会撞 409）。
 */
function migrateTouched(content, touchedFiles = [], { blocksDir } = {}) {
  const out = {};
  if (!touchedFiles.length) return out;
  const versions = loadBlockVersions(blocksDir);
  for (const rel of touchedFiles) {
    if (!Object.prototype.hasOwnProperty.call(content, rel)) continue;
    const m = migrateFile(rel, content[rel], versions);
    if (m) out[rel] = m;
  }
  return out;
}

/** 读的时候用（`editor-data` / `render`）：整份 content 全量迁、不落库。回一份新 content（没变的文件原样共享）。 */
function migrateInMemory(content, { blocksDir } = {}) {
  if (!isObj(content)) return content;
  return { ...content, ...migrateTouched(content, Object.keys(content), { blocksDir }) };
}

module.exports = { loadBlockVersions, migrateBlock, migrateFile, migrateTouched, migrateInMemory, checkMigrationTable };
