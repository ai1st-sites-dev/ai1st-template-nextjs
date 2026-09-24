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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readSiteShape } = require('./site-shape.js');
const { readPagesRecursive } = require('./page-files.js');
const { readSiteBlocks, findBlockInPage, generatedBlockId, normalizeLocalePages } = require('../blocks.js');
const { decorateBlocks } = require('./block-decorate.js');
const { resolveSiteRegionLayout } = require('./site-regions.js');

/**
 * @param {string} rootDir 模板根（`site/` 的上一层）
 * @param {string} locale
 * @param {string} slug
 * @returns {{ file: string, raw: Record<string, unknown>, baseHash: string, siteBlocks: Record<string, any> } | { error: string }}
 *   `file` 是相对仓根的路径（`site/en/pages/home.json` / 扁平站 `site/pages/home.json`）。
 *   `baseHash` 是那个文件**字节**的 sha256（hex）—— 编辑器存盘时带回去，`scripts/write-page.js` 拿它跟
 *   容器里当前的文件比：不一样就说明编辑器打开之后这一页被别处改过（检查器 / AI 聊天 / 另一个标签页），
 *   拒绝写入，而不是拿这份旧底稿把别人的改动冲掉（#1409 QA2 r1 第 1 条）。
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
  const bytes = fs.readFileSync(abs);
  const raw = JSON.parse(bytes.toString('utf-8'));
  return {
    file: path.relative(rootDir, abs).split(path.sep).join('/'),
    raw,
    baseHash: crypto.createHash('sha256').update(bytes).digest('hex'),
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

/**
 * #1404 —— 归一化之后每一块在构建里的**有效权重**（`blocks.js` §effectiveWeight 的同一套算法）。
 * config 里的块不带 `__order`，没写 `weight` 的块它的权重是「位置 × 10」，这里按原始 JSON 把它还原：
 *   · 文件里有的那一条（含 `{ref}`）：它自己写的 `weight`，否则 `下标 × 10`
 *   · 按 `visibility` 注进来的共用块：站级块自带的 `weight`，否则排在页面全部条目之后
 *     （`(条目数 + 第几个注入) × 10`，跟 normalizeLocalePages 里 `extra++` 同一个顺序）
 * 编辑器存盘时拿注入块的这个数当锚点（`editor-convert.js` §assignWeights）。
 */
function effectiveWeights(raw, siteBlocks, blocks, located) {
  const arr = raw && (Array.isArray(raw.blocks) ? raw.blocks : raw.sections);
  const n = Array.isArray(arr) ? arr.length : 0;
  const injectedOrder = Object.keys(siteBlocks || {});
  const injectedHere = blocks
    .map((b, i) => (located[i] && located[i].at === -1 ? b.id : null))
    .filter(Boolean)
    .sort((a, b) => injectedOrder.indexOf(a) - injectedOrder.indexOf(b));
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  return blocks.map((b, i) => {
    const at = located[i] ? located[i].at : -1;
    if (at >= 0) {
      const e = arr[at];
      return e && num(e.weight) ? e.weight : at * 10;
    }
    const sb = siteBlocks && siteBlocks[b.id];
    return sb && num(sb.weight) ? sb.weight : (n + injectedHere.indexOf(b.id)) * 10;
  });
}

/**
 * #1415 —— 编辑器的底稿，**运行时**在站容器里现算（manager 的 `GET /api/sites/{id}/pages` 经 `docker exec`
 * 调这一个函数，dashboard 拿到后 `postMessage` 进编辑器 iframe）。
 *
 * 回的东西跟编辑器页构建时烤进去的那份（`src/app/~editor/[...target]/page.tsx`）逐项同源：
 *   · `raw` / `siteBlocks` / `hash` —— §editorSource（文件里那一份、它字节的 sha256）
 *   · `blocks` —— 这一页**构建里那一份**块：跟 `sync-config.js` 同样喂整个 locale 的页面给
 *     `blocks.js` §normalizeLocalePages，再经 `block-decorate.js` §decorateBlocks 补 `has` / `shape`。
 *     🔴 两步都不能少：只归一化不补字段的话，画布上每个块落回 manifest 默认形态（穿 azure-29 的站有
 *        16 种块跟默认不同），打开编辑器版式就整片换掉。两步的实现都只有这一份，这里只是调用。
 *   · `located` / `weights` —— §locateInRaw / §effectiveWeights，跟 page.tsx 同一对调用
 * 浏览器那一侧只做 `editor-convert.js` §pageToPuck（纯函数）—— 归一化与定位要读磁盘，不许搬去客户端。
 *
 * @param {{ rootDir?: string, page: string, locale?: string }} opts  `locale` 空 = 默认语言；扁平站不看它
 * @returns {{ ok: true, page, locale, raw, siteBlocks, hash, blocks, located, weights }
 *          | { ok: false, reason: string, message: string }}
 *   `locale` 回的是实际用的那一个（扁平站回 ''）。`reason`：'bad-request' | 'no-site' | 'no-locale' |
 *   'no-pages' | 'no-page' | 'build-error'（这个站现在就建不出来 —— 构建会在同一个地方报错）。
 */
function editorBaseline(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || process.cwd();
  const slug = typeof o.page === 'string' ? o.page : '';
  if (!slug) return { ok: false, reason: 'bad-request', message: '没说是哪一页' };
  const siteDir = path.join(rootDir, 'site');
  const shape = readSiteShape(siteDir);
  if (!shape) return { ok: false, reason: 'no-site', message: '读不到 site/' };
  let locale = '';
  if (!shape.flat) {
    locale = typeof o.locale === 'string' ? o.locale : '';
    if (!locale) {
      try {
        locale = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf-8')).defaultLocale || '';
      } catch {
        locale = '';
      }
    }
    // 跟 `write-page.js` 同一条判据：存盘那头不认的语言，这里也不许给出一份底稿。
    if (!locale || (shape.locales.length && !shape.locales.includes(locale))) {
      return { ok: false, reason: 'no-locale', message: `这个网站没有这种语言：${JSON.stringify(locale)}` };
    }
  }
  const src = editorSource(rootDir, locale, slug);
  if ('error' in src) return { ok: false, reason: src.error, message: `读不到这一页（${src.error}）` };

  // 扁平站在构建里的 locale 是 'en'（sync-config 的 legacy 分支），归一化 / 补字段只拿它当标签。
  const label = locale || 'en';
  const localeDir = shape.flat ? siteDir : path.join(siteDir, locale);
  const localePages = [];
  let blocks;
  try {
    readPagesRecursive(path.join(localeDir, 'pages'), '', localePages, new Map());
    localePages.sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
    // 🔴 站级块库另读一份喂归一化：它会**改**传进去的对象（不合法的 role / weight 被删），而回给编辑器的
    //    `siteBlocks` 必须是文件里那一份（§locateInRaw / §effectiveWeights 跟构建时一样拿原样的算）。
    normalizeLocalePages(localePages, readSiteBlocks(localeDir), label, {});
    decorateBlocks({ [label]: localePages }, {
      rootDir,
      structureThemeId: resolveSiteRegionLayout(siteDir).structureThemeId,
      log: () => {},
    });
    const page = localePages.find((p) => p.slug === slug);
    if (!page) return { ok: false, reason: 'no-page', message: `找不到这一页：${slug}` };
    // 跟 config 里那份同形：sync-config 是 JSON.stringify 写进 config-data.ts 的（undefined 的键不在）。
    blocks = JSON.parse(JSON.stringify(page.blocks));
  } catch (e) {
    return { ok: false, reason: 'build-error', message: e && e.message ? e.message : String(e) };
  }
  const located = blocks.map((b) => locateInRaw(src.raw, src.siteBlocks, slug, b));
  return {
    ok: true,
    page: slug,
    locale,
    raw: src.raw,
    siteBlocks: src.siteBlocks,
    hash: src.baseHash,
    blocks,
    located,
    weights: effectiveWeights(src.raw, src.siteBlocks, blocks, located),
  };
}

module.exports = { editorSource, locateInRaw, effectiveWeights, editorBaseline };
