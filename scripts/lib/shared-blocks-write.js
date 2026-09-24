'use strict';

// shared-blocks-write.js —— #1406：编辑器存盘「站级共用块那一半」的判与写（`scripts/write-editor-save.js` 调它）。
//
// 编辑器对共用块的三种动作里有两种落在块库文件（`<语言目录>/blocks/site-blocks.json`），不在这一页：
//   · 改内容 → 那个块的 `data` 整份换成编辑器合好的那一份
//   · 删除，而它的 `visibility` 数组列了这一页 → 从数组里移除这一页
// 挪位置、以及删掉只靠 `{ref}` 出现的块，都只改这一页的页面 JSON（`lib/page-write.js` 那一半）。
// 为什么这样分、`"*"` 为什么不许删、字符串 `visibility` 为什么不碰：`lib/editor-convert.js` §#1406 那段。
//
// stdin 里的 `shared`：{ "<块 id>": { "data"?: { … }, "unlist"?: true } }
//   🔴 `unlist` 不带页名：移除的是**这一次存盘那一页**（参数里的 page），不收浏览器给的另一个名字。
//   🔴 合并是在这里对着**现在磁盘上**那一份做的（§applySharedChanges，跟编辑器那一侧同一个函数），不是拿浏览器
//      手上的整份块库盖回去：只动点名的那几个块、点名的那几个键。
//
// 失败抛 `SharedWriteError`（带退出码，意思同 write-editor-save.js 文件头）：
//   4 块库里没有这个块 / 这种语言没有块库   5 形状不对   9 写进去这个站就建不出来了
//  11 拒收：`"*"` 的块不能只从这一页删（那句话原样进编辑器状态栏）

const fs = require('fs');
const path = require('path');
const { applySharedChanges, deepEqual } = require('./editor-convert.js');

const REFUSED = 11;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_BLOCKS = 32;

class SharedWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, msg) => { throw new SharedWriteError(code, msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 判 + 算出块库要写的字节，**不落盘**（落盘归 `lib/page-write.js` §commitWrites，跟页面那一半一起）。
 * @param {object} a
 * @param {object} a.blocks     `scripts/blocks.js`
 * @param {object} a.pageFiles  `scripts/lib/page-files.js`
 * @param {{ locale: string, localeDir: string }} a.target
 * @param {string} a.slug       这一次存盘的那一页
 * @param {unknown} a.shared
 * @returns {{ file: string, content: string, next: object } | null}  一个字节都不用改 ⟹ `null`（不写这份文件）
 */
function planSharedWrite({ blocks, pageFiles, target, slug, shared }) {
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(slug || '')) fail(5, `page slug 形状不对：${JSON.stringify(slug)}`);
  if (!isObj(shared)) fail(5, 'shared 必须是一个对象 { <块 id>: { data?, unlist? } }');
  const ids = Object.keys(shared);
  if (ids.length === 0) return null;
  if (ids.length > MAX_BLOCKS) fail(5, `一次最多改 ${MAX_BLOCKS} 个共用块`);
  for (const id of ids) {
    if (!ID.test(id)) fail(5, `共用块 id 形状不对：${JSON.stringify(id)}`);
    const c = shared[id];
    if (!isObj(c)) fail(5, `共用块 ${id} 的改动必须是一个对象`);
    for (const k of Object.keys(c)) if (k !== 'data' && k !== 'unlist') fail(5, `共用块 ${id} 的改动里有不认识的键 ${JSON.stringify(k)}`);
    if (Object.prototype.hasOwnProperty.call(c, 'data') && !isObj(c.data)) fail(5, `共用块 ${id} 的 data 必须是一个对象`);
    if (Object.prototype.hasOwnProperty.call(c, 'unlist') && c.unlist !== true) fail(5, `共用块 ${id} 的 unlist 只能是 true`);
  }

  const { locale, localeDir } = target;
  const file = path.join(localeDir, 'blocks', 'site-blocks.json');
  if (!fs.existsSync(file)) fail(4, 'this language has no shared sections');
  const text = fs.readFileSync(file, 'utf-8');
  let before;
  try {
    before = JSON.parse(text);
  } catch (e) {
    fail(5, `site-blocks.json 不是合法 JSON：${e.message}`);
  }
  if (!isObj(before)) fail(5, 'site-blocks.json 必须是一个对象');
  for (const id of ids) {
    if (!isObj(before[id])) fail(4, `这个共用块已经不在网站上了：${id}`);
    const vis = before[id].visibility;
    if (shared[id].unlist && Array.isArray(vis) && vis.includes('*')) {
      fail(REFUSED, 'This section is on every page, so it can\'t be removed from just this one. Nothing was saved.');
    }
  }

  const next = applySharedChanges(before, shared, slug);
  if (deepEqual(next, before)) return null;

  // 写之前让构建自己的校验过一遍（跟 page-write.js 同一条理由：它不收的块库会让整站从此建不出来）。
  const pages = [];
  try {
    pageFiles.readPagesRecursive(path.join(localeDir, 'pages'), '', pages, new Map());
    blocks.normalizeLocalePages(pages, JSON.parse(JSON.stringify(next)), locale || 'en', {});
  } catch (e) {
    fail(9, `这份共用块会让网站建不出来：${e.message}`);
  }
  // 两空格缩进（跟 page-write.js 写页面同形）；结尾换行照原文件，diff 只落在改过的那几行。
  const content = `${JSON.stringify(next, null, 2)}${text.endsWith('\n') ? '\n' : ''}`;
  return { file, content, next };
}

module.exports = { SharedWriteError, REFUSED, planSharedWrite };
