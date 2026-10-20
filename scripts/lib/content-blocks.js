'use strict';
// #1826 —— `site.js render` 入口的「这份 content 里有没有这份包画不出来的块」（设计文档 §8.3）。
//
// 🔴 为什么在入口扫、不在 `SectionRenderer` 里抛：画布、T2f 的图册路由、T3c 的只读画布都用 `SectionRenderer`，
//    在那里抛，一遇到未知块整页崩。渲染这一层照旧静默跳过（`SectionRenderer.tsx` 的 `console.warn` + `return null`）；
//    拦在入口，是因为 R2 没有版本控制：坏产物一传上去，最后一份好的就没了 —— 不认识就整跑不出产物。
//
// 🔴 两种错的措辞是这份包的对外合同（包发出去就改不了，manager 和 T4d 的自愈按它判）：
//      unknown block type <t> at <文件>#<块 id>
//      unsupported schemaVersion <n> of <t> at <文件>#<块 id>
//    第二种的判据：块的 schemaVersion（没写 = 1）不在 manifest 的 `renders` 里（#1838 起每份 manifest 都写了 `renders`）。
//
// 扫的范围：页面（`pages/**.json` 的 `blocks` 和老形状的 `sections`）、共用块（`blocks/site-blocks.json`，键是块 id）。
// 博客文章是 markdown 正文，没有块。顶栏 / 页脚是外壳区（manifest `region: true`），不进页面 JSON，也不算「认识的页面块」。
const fs = require('fs');
const path = require('path');

const PAGE_KEY_RE = /(^|\/)pages\/.+\.json$/;
const SHARED_KEY_RE = /(^|\/)blocks\/site-blocks\.json$/;

/** 这份模板认识的页面块：类型 → manifest 的 `renders`（没写 = null，即不按版本判）。 */
function knownBlockTypes(templateDir) {
  const dir = require('./block-paths').blocksDir(templateDir); // #1838：测试可改道到带假块的临时目录
  const out = new Map();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const file = path.join(dir, e.name, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const m = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (m.region === true) continue;
    out.set(m.type || e.name, Array.isArray(m.renders) ? m.renders : null);
  }
  return out;
}

const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** content 里的每一个页面块 / 共用块：`{ key, id, type, schemaVersion }`，次序固定（键排序、块按出现次序）。 */
function contentBlocks(content) {
  const out = [];
  for (const key of Object.keys(content).sort()) {
    if (PAGE_KEY_RE.test(key)) {
      let page;
      try { page = parsed(content[key]); } catch { continue; } // 不是合法 JSON 的由派生那一步报
      if (!isObj(page)) continue;
      for (const field of ['blocks', 'sections']) {
        const list = Array.isArray(page[field]) ? page[field] : [];
        list.forEach((b, i) => {
          if (!isObj(b)) return;
          out.push({ key, id: typeof b.id === 'string' && b.id ? b.id : `${field}[${i}]`, type: b.type, schemaVersion: b.schemaVersion });
        });
      }
    } else if (SHARED_KEY_RE.test(key)) {
      let shared;
      try { shared = parsed(content[key]); } catch { continue; }
      if (!isObj(shared)) continue;
      for (const [id, b] of Object.entries(shared)) {
        if (isObj(b)) out.push({ key, id, type: b.type, schemaVersion: b.schemaVersion });
      }
    }
  }
  return out;
}

/** 画不出来的那些块，每个一句（措辞见文件头）。空数组 = 都认识。 */
function unrenderableBlocks(content, known) {
  const problems = [];
  for (const b of contentBlocks(content)) {
    const where = `${b.key}#${b.id}`;
    if (typeof b.type !== 'string' || !known.has(b.type)) {
      problems.push(`unknown block type ${typeof b.type === 'string' ? b.type : JSON.stringify(b.type)} at ${where}`);
      continue;
    }
    const renders = known.get(b.type);
    const v = b.schemaVersion === undefined ? 1 : b.schemaVersion;
    if (renders && !renders.includes(v)) problems.push(`unsupported schemaVersion ${v} of ${b.type} at ${where}`);
  }
  return problems;
}

const NAV_KEY_RE = /(^|\/)navigation\.json$/;

/**
 * #1941 —— 写进库之前：`keys` 这几份文件里，每个块的 schemaVersion 必须是整数（没写 = 1，不算）。页面块、共用块，
 * 加上 navigation.json 的 header / footer（外壳区的号记在那儿，迁移拿它做 `<` 比较）。一条一句，空数组 = 都对。
 * 🔴 判据跟上面 §unrenderableBlocks 读的是同一个值：渲染入口拿 `renders.includes(v)` 比，`"2"` / `2.5` / `null` 一律画不出 ——
 *    这里不收，它们就进不了库（AI 改站的 `validate`、编辑器的 `save` 都走这里）。
 */
function schemaVersionProblems(content, keys) {
  const wanted = new Set(keys);
  const say = (v, type, where) => `schemaVersion ${JSON.stringify(v)} of ${typeof type === 'string' ? type : JSON.stringify(type)} at ${where} is not a whole number`;
  const out = [];
  const only = {};
  for (const k of wanted) if (Object.prototype.hasOwnProperty.call(content, k)) only[k] = content[k];
  for (const b of contentBlocks(only)) {
    if (b.schemaVersion !== undefined && !Number.isInteger(b.schemaVersion)) out.push(say(b.schemaVersion, b.type, `${b.key}#${b.id}`));
  }
  for (const key of Object.keys(only).sort()) {
    if (!NAV_KEY_RE.test(key)) continue;
    let nav;
    try { nav = parsed(only[key]); } catch { continue; }
    if (!isObj(nav)) continue;
    for (const region of ['header', 'footer']) {
      const r = nav[region];
      if (isObj(r) && r.schemaVersion !== undefined && !Number.isInteger(r.schemaVersion)) out.push(say(r.schemaVersion, region, `${key}#${region}`));
    }
  }
  return out;
}

module.exports = { knownBlockTypes, contentBlocks, unrenderableBlocks, schemaVersionProblems };
