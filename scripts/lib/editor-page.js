'use strict';

// editor-page.js —— 编辑器页（#1409）在构建时要知道的三件事：这一页的**原始**页面 JSON、它住在
// 哪个文件、画布上每个可编辑的块对应原始 JSON 里的哪一条。
//
// ── 为什么要原始 JSON，不能拿 config 里那份 ───────────────────────────────────────────────────
// 🔴 config 里的页面是**归一化之后**的（`scripts/blocks.js` §normalizeLocalePages）：老 `sections`
//    形状被映成 `blocks`、站级共用块按 `visibility` 注进来、每个块补了 id / role / region / weight、
//    整页按 weight 重排。把那一份当页面 JSON 写回文件，就是把共用块抄进这一页（下次构建又按
//    `visibility` 注一次 ⟹ 出现两遍）、把老站的形状静默改掉。所以存盘的底一律是**文件里那一份**，
//    编辑器只把老板改过的那个字段写回它对应的那一条。
//
// ── 「对应哪一条」用的是两份现成的实现，不另写 ──────────────────────────────────────────────────
// · 新 `blocks` 形状 → `blocks.js` §findBlockInPage（检查器的保存链也用它）。
// · 老 `sections` 形状 → 块 id 是构建时现算的 `blocks.js` §generatedBlockId(slug, type, 下标)，
//   这里按同一个函数反查下标。
// · 站级共用块（一条 `{ref}`，或者靠 `visibility` 注进来、这一页根本没有它的条目）→ **不可写**：
//   它的字住在 `blocks/site-blocks.json`，写在这一页的条目上是静默无效的（解 ref 时条目自己的键
//   一个都不读）。那一格归 #1406。

const fs = require('fs');
const path = require('path');
const { readSiteShape } = require('./site-shape.js');
const { readPagesRecursive } = require('./page-files.js');
const { readSiteBlocks, findBlockInPage, generatedBlockId } = require('../blocks.js');

/**
 * @param {string} rootDir 模板根（`site/` 的上一层）
 * @param {string} locale
 * @param {string} slug
 * @returns {{ file: string, raw: Record<string, unknown>, siteBlocks: Record<string, any> } | { error: string }}
 *   `file` 是相对仓根的路径（`site/en/pages/home.json` / 扁平站 `site/pages/home.json`）。
 */
function editorSource(rootDir, locale, slug) {
  const siteDir = path.join(rootDir, 'site');
  const shape = readSiteShape(siteDir);
  // 🔴 问不出形状就什么都不判（site-shape.js 文件头第三条）—— 猜成扁平会去读一个构建不读的文件。
  if (!shape) return { error: 'no-site' };
  const localeDir = shape.flat ? siteDir : path.join(siteDir, locale);
  const pagesDir = path.join(localeDir, 'pages');
  if (!fs.existsSync(pagesDir)) return { error: 'no-pages' };
  const sourceBySlug = new Map();
  readPagesRecursive(pagesDir, '', [], sourceBySlug);
  const abs = sourceBySlug.get(slug);
  if (!abs) return { error: 'no-page' };
  // 重新读一遍文件：readPagesRecursive 会把子目录页面的 slug 覆盖进内容里，那不是文件里的字节。
  const raw = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  return {
    file: path.relative(rootDir, abs).split(path.sep).join('/'),
    raw,
    siteBlocks: readSiteBlocks(localeDir),
  };
}

/**
 * 归一化之后的一个块，在原始页面 JSON 里是哪一条。
 * @returns {{ at: number, writable: boolean, reason: string }}
 *   `reason`：'' | 'shared'（字住在站级块库里）| 'not-found'
 */
function locateInRaw(raw, siteBlocks, slug, block) {
  const id = block && typeof block.id === 'string' ? block.id : '';
  if (raw && Array.isArray(raw.sections) && !Object.prototype.hasOwnProperty.call(raw, 'blocks')) {
    const at = raw.sections.findIndex((s, i) => s && generatedBlockId(slug, s.type, i) === id);
    return at === -1 ? { at: -1, writable: false, reason: 'not-found' } : { at, writable: true, reason: '' };
  }
  const r = findBlockInPage(raw, siteBlocks, { blockId: id, slug });
  if (r.error) return { at: -1, writable: false, reason: 'not-found' };
  if (r.at === -1 || (r.entry && typeof r.entry.ref === 'string')) return { at: r.at, writable: false, reason: 'shared' };
  return { at: r.at, writable: true, reason: '' };
}

module.exports = { editorSource, locateInRaw };
