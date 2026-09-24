'use strict';

// shared-blocks-write.js —— #1406：编辑器存盘「站级共用块那一半」的判与写（`scripts/write-editor-save.js` 调它）。
//
// 编辑器对共用块的三种动作里有两种落在块库文件（`<语言目录>/blocks/site-blocks.json`），不在这一页：
//   · 改内容 → 编辑器只交改过的那几个字段，合进那个块**磁盘上现在**的 `data`（没点名的字段原样 —— 别处刚改过的字不被冲掉）
//   · 删除，而它的 `visibility` 数组列了这一页 → 从数组里移除这一页
// 挪位置、以及删掉只靠 `{ref}` 出现的块，都只改这一页的页面 JSON（`lib/page-write.js` 那一半）。
// 为什么这样分、`"*"` 为什么不许删、字符串 `visibility` 为什么不碰：`lib/editor-convert.js` §#1406 那段。
//
// stdin 里的 `shared`：{ "<块 id>": { "data"?: { … }, "was"?: { … }, "unlist"?: true } }
//   🔴 `was`（#1420）：`data` 里每个字段在编辑器画布上是按哪个值取的。磁盘上现在那个值跟它不一样 ⟹ 别处（AI 聊天 /
//      另一页的编辑器）在这期间改过**同一个字段**。照旧后存的赢（同一个老板的两条路，Chris 的产品不做「摆两份让人挑」），
//      但回一句 `notice` 让老板知道那句刚被别处改过的字被他这一笔替换了。`was` 缺 ⟹ 不判（老编辑器）。
//   🔴 `unlist` 不带页名：移除的是**这一次存盘那一页**（参数里的 page），不收浏览器给的另一个名字。
//   🔴 合并是在这里对着**现在磁盘上**那一份做的（§applySharedChanges，跟编辑器那一侧同一个函数），不是拿浏览器
//      手上的整份块库盖回去：只动点名的那几个块、点名的那几个键。
//
// 失败抛 `SharedWriteError`（带退出码，意思同 write-editor-save.js 文件头）：
//   4 块库里没有这个块 / 这种语言没有块库   5 形状不对   9 写进去这个站就建不出来了
//  11 拒收：`"*"` 的块不能只从这一页删（那句话原样进编辑器状态栏）
//  📌 共用块里填的链接不在这里判（#1427）：落盘那一步 `lib/page-write.js` §commitWrites 对每一份写入都判，
//     拒了抛 `PageWriteError(11)`，同一条通道进状态栏。

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
    for (const k of Object.keys(c)) if (k !== 'data' && k !== 'unlist' && k !== 'was') fail(5, `共用块 ${id} 的改动里有不认识的键 ${JSON.stringify(k)}`);
    if (Object.prototype.hasOwnProperty.call(c, 'data') && !isObj(c.data)) fail(5, `共用块 ${id} 的 data 必须是一个对象`);
    if (Object.prototype.hasOwnProperty.call(c, 'was') && !isObj(c.was)) fail(5, `共用块 ${id} 的 was 必须是一个对象`);
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
  const overwrote = overwrittenFields(before, shared);

  // 写之前让构建自己的校验过一遍（跟 page-write.js 同一条理由：它不收的块库会让整站从此建不出来）。
  // #1420 —— 可达，但只有一种来路：这一笔只动 data / visibility，造不出构建会抛的形状；走到这里 = 编辑器打开之后磁盘上
  //    别的页 / 别的块被写坏了（先坏再打开的话，底稿那一步就拒了）。格子在 editor-shared.test.js ⑫。
  const pages = [];
  try {
    pageFiles.readPagesRecursive(path.join(localeDir, 'pages'), '', pages, new Map());
    blocks.normalizeLocalePages(pages, JSON.parse(JSON.stringify(next)), locale || 'en', {});
  } catch (e) {
    fail(9, `这份共用块会让网站建不出来：${e.message}`);
  }
  // 两空格缩进（跟 page-write.js 写页面同形）；结尾换行照原文件，diff 只落在改过的那几行。
  const content = `${JSON.stringify(next, null, 2)}${text.endsWith('\n') ? '\n' : ''}`;
  return { file, content, next, overwrote, notice: overwriteNotice(overwrote) };
}

const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * #1420 —— 这一笔替换掉的、「别处在编辑器打开之后改过」的那几个字段 → `[{ id, slot }]`。
 * 判据：磁盘上现在的值 ≠ 编辑器画布取的那个值（`was`，缺这个键 = 本来没有），且 ≠ 这一笔要写的值
 * （别处恰好改成了一样的字，没有东西被替换）。没带 `was` 的块不判。
 */
function overwrittenFields(before, shared) {
  const out = [];
  for (const [id, c] of Object.entries(shared)) {
    if (!isObj(c.data) || !isObj(c.was)) continue;
    const disk = isObj(before[id].data) ? before[id].data : {};
    for (const slot of Object.keys(c.data)) {
      const now = hasKey(disk, slot) ? disk[slot] : undefined;
      const expected = hasKey(c.was, slot) ? c.was[slot] : undefined;
      if (deepEqual(now, expected) || deepEqual(now, c.data[slot])) continue;
      out.push({ id, slot });
    }
  }
  return out;
}

/** 给老板看的那一句（空数组 ⟹ ''）。字段名是块的 slot 名（编辑器侧栏里的字段就叫这个）。 */
function overwriteNotice(overwrote) {
  if (!overwrote.length) return '';
  const fields = [...new Set(overwrote.map((o) => o.slot))].map((f) => `"${f}"`).join(', ');
  return `Saved. Heads up: ${fields} in a shared section had been changed somewhere else (for example by the AI `
    + 'chat) after you opened the editor — your version replaced that change.';
}

module.exports = { SharedWriteError, REFUSED, planSharedWrite, overwrittenFields };
