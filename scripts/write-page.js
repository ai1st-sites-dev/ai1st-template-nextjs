#!/usr/bin/env node
// #1409 —— 把编辑器存下来的**整份页面 JSON** 写回这一页的文件。
//
// 跟 `patch-block.js` 同一个位置、同一种调用：在**站自己的容器里**跑
// （`docker exec -i -w /app/repo <siteId> node scripts/write-page.js '<定位>' < 页面 JSON`），由 worker
// 调用（`worker/blocks_task.go` §processBlockPatchTask 的「整页」那一支）。只写磁盘上那一份，不 commit、
// 不构建 —— 那两件事归 worker。
//
// 用法：
//   node scripts/write-page.js '{"page":"<页面 slug>","locale":"<语言，可空>","baseHash":"<sha256>"}'
//   页面 JSON 从 stdin 进
//
//   🔴 页面 JSON 走 stdin 不走 argv：一页的 JSON 可以比 Linux 单个 argv 的 128 KiB 上限还大
//      （`manager/blocks_api.go` §maxBlockPatchBytes 为同一个上限付过账）。
//
// 成功时 stdout 打**一行** JSON：{"ok":true,"file":"site/en/pages/home.json","hash":"<写完之后文件字节的 sha256>"}（`hash` 是 #1415 加的）
//
// 退出码（worker 一一对上一句给老板看的话）：
//   0 成功   4 找不到那一页   5 参数或页面 JSON 的形状不对
//   9 这份页面放进去，这个站就建不出来了（构建自己那套校验不收）—— 不写
//  10 这一页在编辑器打开之后被别处改过了（`baseHash` 对不上当前文件）—— 不写
//
// ── baseHash：编辑器的底稿是不是当前这份文件（#1409 QA2 r1）──────────────────────────────────────
// 🔴 编辑器页是**构建时**烤出来的，它手上那份页面 JSON 是那一刻的文件。它打开期间，检查器 / AI 聊天 /
//    另一个标签页都可能改同一页；编辑器拿旧底稿整份写回，就把那些改动悄悄冲掉了（QA2 实测：检查器藏掉
//    cta-banner，编辑器再存一次标题，cta-banner 回到了真页面上）。所以调用方必须带上它底稿那份文件字节
//    的 sha256，这里拿当前文件比，不一样就拒绝 —— 让老板重新打开编辑器、在最新的那份上改，而不是这里
//    猜怎么合并。缺了 baseHash 也拒（exit 5）：这道检查不许因为调用方忘了带就静默跳过。
//
// ── 写哪个文件：自己算，不收调用方给的路径 ─────────────────────────────────────────────────────
// 🔴 「slug → 文件」只有一份实现（`scripts/lib/page-files.js`，构建读页面用的就是它）。顶层页面的 slug
//    取自文件**内容**，不一定等于文件名；照 `pages/<slug>.json` 拼路径会在那种站上写进一个构建不读的
//    文件，而保存照样「成功」。调用方也不给路径：路径是从网络上来的值，不收它就不用挡它。
//
// ── 写之前先过一遍构建自己的校验 ─────────────────────────────────────────────────────────────────
// 🔴 页面 JSON 是整份从浏览器来的。写进去之后下一次构建会跑 `blocks.js` §normalizeLocalePages ——
//    它不收的形状（没有 blocks/sections、ref 指向不存在的块、visibility 里写了不存在的页面 …）会让
//    **整站**从此建不出来。所以写之前拿同一个函数、用这一种语言的**全部**页面（这一页换成新的）跑一次，
//    抛了就 exit 9、一个字节不写。判据跟构建是同一个函数，不是这里另写一套。

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SITE = path.join(ROOT, 'site');

function die(code, msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

let blocks;
let pageFiles;
let siteShape;
try {
  blocks = require(path.join(ROOT, 'scripts', 'blocks.js'));
  pageFiles = require(path.join(ROOT, 'scripts', 'lib', 'page-files.js'));
  siteShape = require(path.join(ROOT, 'scripts', 'lib', 'site-shape.js'));
} catch (e) {
  die(5, `读不到构建脚本：${e.message}`);
}

// ── 参数 ────────────────────────────────────────────────────────────────────────────────────────
let loc;
try {
  loc = JSON.parse(process.argv[2] || '');
} catch (e) {
  die(5, `第一个参数不是合法 JSON：${e.message}`);
}
if (!loc || typeof loc !== 'object' || Array.isArray(loc)) die(5, '第一个参数必须是一个对象');
const slug = typeof loc.page === 'string' ? loc.page : '';
if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(slug)) die(5, `page slug 形状不对：${JSON.stringify(slug)}`);
const baseHash = typeof loc.baseHash === 'string' ? loc.baseHash : '';
if (!/^[0-9a-f]{64}$/.test(baseHash)) die(5, 'baseHash 缺失或形状不对（要 64 位小写 hex 的 sha256）');
let locale = typeof loc.locale === 'string' ? loc.locale : '';
if (locale && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale)) die(5, `locale 形状不对：${JSON.stringify(locale)}`);

let next;
try {
  next = JSON.parse(fs.readFileSync(0, 'utf-8'));
} catch (e) {
  die(5, `stdin 不是合法 JSON：${e.message}`);
}
if (!next || typeof next !== 'object' || Array.isArray(next)) die(5, '页面 JSON 必须是一个对象');
const hasBlocks = Object.prototype.hasOwnProperty.call(next, 'blocks');
const hasSections = Object.prototype.hasOwnProperty.call(next, 'sections');
if (hasBlocks === hasSections) die(5, '页面 JSON 必须恰好写 blocks 或 sections 其中一个');
if (!Array.isArray(hasBlocks ? next.blocks : next.sections)) die(5, 'blocks / sections 必须是数组');

// ── 哪一份文件 ──────────────────────────────────────────────────────────────────────────────────
// 形状的判据只有一条（`site-shape.js`：site_meta.json 在不在）。问不出来就什么都不判。
const shape = siteShape.readSiteShape(SITE);
if (!shape) die(5, '读不到 site/ —— 这不是一个网站仓');
if (shape.flat) {
  locale = '';
} else {
  if (!locale) {
    try {
      locale = JSON.parse(fs.readFileSync(path.join(SITE, 'site_meta.json'), 'utf-8')).defaultLocale || '';
    } catch (e) {
      die(5, `读不到 site/site_meta.json：${e.message}`);
    }
  }
  if (!locale || (shape.locales.length && !shape.locales.includes(locale))) die(4, `这个网站没有这种语言：${JSON.stringify(locale)}`);
}
const localeDir = shape.flat ? SITE : path.join(SITE, locale);
const pagesDir = path.join(localeDir, 'pages');
if (!fs.existsSync(pagesDir)) die(4, `找不到页面目录：${path.relative(ROOT, pagesDir)}`);

const localePages = [];
const sourceBySlug = new Map();
try {
  pageFiles.readPagesRecursive(pagesDir, '', localePages, sourceBySlug);
} catch (e) {
  die(5, `读不出这一种语言的页面：${e.message}`);
}
const file = sourceBySlug.get(slug);
if (!file) die(4, `找不到这一页：${slug}`);

// 🔴 slug 不许借存盘改掉：顶层页面的 slug 就是文件内容里那个键，改了等于把这一页挪到另一个地址
//    （还可能撞上另一页）。子目录里的页面 slug 由路径定，内容里写什么构建都会覆盖掉。
const beforeBytes = fs.readFileSync(file);
const currentHash = require('crypto').createHash('sha256').update(beforeBytes).digest('hex');
if (currentHash !== baseHash) {
  die(10, `这一页在编辑器打开之后被改过了（底稿 ${baseHash.slice(0, 12)} ≠ 当前 ${currentHash.slice(0, 12)}）`);
}
const before = JSON.parse(beforeBytes.toString('utf-8'));
const nested = path.dirname(file) !== pagesDir;
if (!nested && next.slug !== before.slug) die(5, `不能在这里改页面地址：${JSON.stringify(before.slug)} → ${JSON.stringify(next.slug)}`);

// ── 写之前先让构建自己的校验过一遍（见文件头）──────────────────────────────────────────────────
const trial = localePages.map((p) => {
  if (p.slug !== slug) return JSON.parse(JSON.stringify(p));
  const q = JSON.parse(JSON.stringify(next));
  if (nested) q.slug = slug; // 同 readPagesRecursive：子目录页面的 slug 由路径定
  return q;
});
try {
  blocks.normalizeLocalePages(trial, blocks.readSiteBlocks(localeDir), locale || 'en', {});
} catch (e) {
  die(9, `这份页面会让网站建不出来：${e.message}`);
}

// ── 写 ──────────────────────────────────────────────────────────────────────────────────────────
// 格式跟 patch-block.js 与建站脚本写出来的逐字同形（两空格缩进 + 结尾换行），diff 只落在改过的那几行。
// 先写临时文件再改名：写到一半被打断也不会留下半份 JSON（那一份会让整站建不出来）。
const tmp = `${file}.tmp-${process.pid}`;
const afterBytes = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf-8');
fs.writeFileSync(tmp, afterBytes);
fs.renameSync(tmp, file);
// #1415 —— `hash` 是写完之后那份文件字节的 sha256（跟上面比对 baseHash 同一个算法）。worker 在 commit + push
// 成功之后把它随 `page-saved` 事件发给 dashboard，编辑器拿它当下一次存盘的 baseHash —— 不用等重建完、
// 重新加载一份烤出来的底稿。算的是**写进去的那份字节**，不是再读一次文件：两者之间没有别人能插进来
// （worker 这一步在按站的锁里），而再读一次多一次 IO、还多一个「读到一半」的窗口。
process.stdout.write(`${JSON.stringify({
  ok: true,
  file: path.relative(ROOT, file).split(path.sep).join('/'),
  hash: require('crypto').createHash('sha256').update(afterBytes).digest('hex'),
})}\n`);
