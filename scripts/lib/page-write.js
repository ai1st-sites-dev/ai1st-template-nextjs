'use strict';

// page-write.js —— 编辑器存盘「页面那一半」的判与写，两个脚本共用一份（#1405 从 `scripts/write-page.js`
// 原样抽出来，判据、退出码、每句话都没改）。
//
//   · `scripts/write-page.js`         只存页面（#1409 那条路，早于 #1405 的编辑器页走它）
//   · `scripts/write-editor-save.js`  页面 + 外壳四样一起存（#1405）
//
// 🔴 为什么要抽：#1405 要求「所有校验先于所有写入」—— 页面判过了、外壳被拒，就不能已经写下了页面。
//    所以页面这一半必须拆成「判」（§planPageWrite，回要写的字节、一个字节不落盘）和「写」（§commitWrites）
//    两步。两个脚本各抄一份判据的话，总有一天一个收、一个不收。
//
// 失败一律抛 `PageWriteError`（带退出码），由脚本换成 `die(code, msg)`。退出码的意思见 write-page.js 文件头。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { linkRejection } = require('./link-href');

/**
 * 拒收：给老板看的一句话（#1416 起页面那一半也有）。跟 `editor-root.js` §REFUSED 同一个码 ——
 * worker 那个 `switch code` 是两个脚本共用的，11 就从 stdout 最后一行取 `message` 原样给老板
 * （`worker/blocks_task.go` 的 `editorRefused`）。
 */
const REFUSED = 11;

class PageWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, msg) {
  throw new PageWriteError(code, msg);
}

/**
 * 这次存盘落在哪种语言、哪个目录。形状的判据只有一条（`site-shape.js`：site_meta.json 在不在）。
 * @returns {{ shape: object, locale: string, localeDir: string }}
 */
function resolveTarget(root, siteShape, localeIn) {
  const SITE = path.join(root, 'site');
  let locale = localeIn || '';
  if (locale && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale)) fail(5, `locale 形状不对：${JSON.stringify(locale)}`);
  const shape = siteShape.readSiteShape(SITE);
  if (!shape) fail(5, '读不到 site/ —— 这不是一个网站仓');
  if (shape.flat) {
    locale = '';
  } else {
    if (!locale) {
      try {
        locale = JSON.parse(fs.readFileSync(path.join(SITE, 'site_meta.json'), 'utf-8')).defaultLocale || '';
      } catch (e) {
        fail(5, `读不到 site/site_meta.json：${e.message}`);
      }
    }
    if (!locale || (shape.locales.length && !shape.locales.includes(locale))) fail(4, `这个网站没有这种语言：${JSON.stringify(locale)}`);
  }
  return { shape, locale, localeDir: shape.flat ? SITE : path.join(SITE, locale) };
}

/**
 * 判这一页能不能写成 `next`。判过了回 `{ file, content, hash }`（绝对路径 + 要写的字节 + 它的 sha256），**不落盘**。
 * @param {object} a
 * @param {string} a.root       仓根（`/app/repo`）
 * @param {object} a.blocks     `scripts/blocks.js`
 * @param {object} a.pageFiles  `scripts/lib/page-files.js`
 * @param {{ locale: string, localeDir: string }} a.target  §resolveTarget 的结果
 * @param {string} a.slug
 * @param {string} a.baseHash
 * @param {unknown} a.next      整份页面 JSON
 * @param {object} [a.siteBlocks] #1406：这一次存盘同时要写的块库（写完之后那一份）。校验要拿它，不拿磁盘上那份 ——
 *                              页面和块库一起写，建得出来的判据是两份**写完以后**放在一起。缺 ⟹ 读磁盘上那份。
 */
function planPageWrite({ root, blocks, pageFiles, target, slug, baseHash, next, siteBlocks }) {
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(slug)) fail(5, `page slug 形状不对：${JSON.stringify(slug)}`);
  if (!/^[0-9a-f]{64}$/.test(baseHash || '')) fail(5, 'baseHash 缺失或形状不对（要 64 位小写 hex 的 sha256）');
  if (!next || typeof next !== 'object' || Array.isArray(next)) fail(5, '页面 JSON 必须是一个对象');
  const hasBlocks = Object.prototype.hasOwnProperty.call(next, 'blocks');
  const hasSections = Object.prototype.hasOwnProperty.call(next, 'sections');
  if (hasBlocks === hasSections) fail(5, '页面 JSON 必须恰好写 blocks 或 sections 其中一个');
  if (!Array.isArray(hasBlocks ? next.blocks : next.sections)) fail(5, 'blocks / sections 必须是数组');

  const { locale, localeDir } = target;
  const pagesDir = path.join(localeDir, 'pages');
  if (!fs.existsSync(pagesDir)) fail(4, `找不到页面目录：${path.relative(root, pagesDir)}`);

  const localePages = [];
  const sourceBySlug = new Map();
  try {
    pageFiles.readPagesRecursive(pagesDir, '', localePages, sourceBySlug);
  } catch (e) {
    fail(5, `读不出这一种语言的页面：${e.message}`);
  }
  const file = sourceBySlug.get(slug);
  if (!file) fail(4, `找不到这一页：${slug}`);

  // 🔴 slug 不许借存盘改掉：顶层页面的 slug 就是文件内容里那个键，改了等于把这一页挪到另一个地址
  //    （还可能撞上另一页）。子目录里的页面 slug 由路径定，内容里写什么构建都会覆盖掉。
  const beforeBytes = fs.readFileSync(file);
  const currentHash = crypto.createHash('sha256').update(beforeBytes).digest('hex');
  if (currentHash !== baseHash) {
    fail(10, `这一页在编辑器打开之后被改过了（底稿 ${baseHash.slice(0, 12)} ≠ 当前 ${currentHash.slice(0, 12)}）`);
  }
  const before = JSON.parse(beforeBytes.toString('utf-8'));
  const nested = path.dirname(file) !== pagesDir;
  if (!nested && next.slug !== before.slug) fail(5, `不能在这里改页面地址：${JSON.stringify(before.slug)} → ${JSON.stringify(next.slug)}`);

  // #1416 —— 老板填的链接只收那几种地址（判据在 `lib/link-href.js`，三条写入路径共用）。拿写之前那份比：
  // 文件里本来就有的不合规链接，这一次没碰它就不拦（老数据不炸）。
  const badLink = linkRejection('page', next, before);
  if (badLink) fail(REFUSED, badLink);

  // ── 写之前先让构建自己的校验过一遍（见 write-page.js 文件头）──────────────────────────────────
  const trial = localePages.map((p) => {
    if (p.slug !== slug) return JSON.parse(JSON.stringify(p));
    const q = JSON.parse(JSON.stringify(next));
    if (nested) q.slug = slug; // 同 readPagesRecursive：子目录页面的 slug 由路径定
    return q;
  });
  // #1420 —— 从输入直接可达：编辑器交来的这一页自己就能带一个构建不收的形状（例：一个既没 type 也没 ref 的块）。
  //    格子在 editor-shared.test.js ⑫。
  try {
    const lib = siteBlocks ? JSON.parse(JSON.stringify(siteBlocks)) : blocks.readSiteBlocks(localeDir);
    blocks.normalizeLocalePages(trial, lib, locale || 'en', {});
  } catch (e) {
    fail(9, `这份页面会让网站建不出来：${e.message}`);
  }

  // 格式跟建站脚本写出来的逐字同形（两空格缩进 + 结尾换行），diff 只落在改过的那几行。
  // #1415 —— `hash` 是这份要写的字节的 sha256（跟上面比 baseHash 同一个算法）：写完之后文件就是这份字节，
  // 两个脚本都把它回给 worker，编辑器拿它当下一次存盘的 baseHash。只在这里算一次，两个脚本不各算一份。
  const content = `${JSON.stringify(next, null, 2)}\n`;
  return { file, content, hash: crypto.createHash('sha256').update(content, 'utf-8').digest('hex') };
}

/**
 * 把判过的那几份一起落盘。先把**每一份**写成临时文件，全部写成之后再逐个改名：写到一半被打断也不会
 * 留下半份 JSON（那一份会让整站建不出来），而改名这一步不会半途失败在「写了一半的内容」上。
 *
 * #1427 —— 🔴 **落盘之前，每一份都过一遍链接判据**（`lib/link-href.js`，kind `'any'`），一份被拒就一个字节都不写。
 * 编辑器那一侧的每一种写入（页面 / 站级共用块 / 外壳四样）最后都交到这里，所以帽子扣在这里 ——
 * 以后新加一种写入，不用记得接线。各 plan 函数里更早的那几处检查留着（报错更早），这里是兜底。
 * `before` 从盘上现读（此刻还没换掉）；读不出 / 不是 JSON 的旧文件当「没有旧链接」—— 方向是多拦。
 * 要写的内容不是 JSON ⟹ 里面没有判据认得的链接，跳过。
 * @param {{ file: string, content: string }[]} writes
 */
function commitWrites(writes) {
  for (const w of writes) {
    let next;
    try { next = JSON.parse(w.content); } catch (e) { continue; }
    let before = null;
    try { before = JSON.parse(fs.readFileSync(w.file, 'utf-8')); } catch (e) { before = null; }
    const badLink = linkRejection('any', next, before);
    if (badLink) fail(REFUSED, badLink);
  }
  const staged = writes.map((w) => {
    const tmp = `${w.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, w.content);
    return { tmp, file: w.file };
  });
  for (const s of staged) fs.renameSync(s.tmp, s.file);
}

module.exports = { REFUSED, PageWriteError, resolveTarget, planPageWrite, commitWrites };
