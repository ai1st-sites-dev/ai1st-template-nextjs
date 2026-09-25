#!/usr/bin/env node
// #1409 —— 把编辑器存下来的**整份页面 JSON** 写回这一页的文件。
//
// 在**站自己的容器里**跑
// （`docker exec -i -w /app/repo <siteId> node scripts/write-page.js '<定位>' < 页面 JSON`），由 worker
// 调用（`worker/blocks_task.go` §processBlockPatchTask 的「整页」那一支）。只写磁盘上那一份，不 commit、
// 不构建 —— 那两件事归 worker。
//
// 用法：
//   node scripts/write-page.js '{"page":"<页面 slug>","locale":"<语言，可空>","baseHash":"<sha256>"}'
//   页面 JSON 从 stdin 进
//
//   🔴 页面 JSON 走 stdin 不走 argv：一页的 JSON 可以比 Linux 单个 argv 的 128 KiB 上限还大
//      （检查器那条单块路当年就为同一个上限付过账，#1352；那条路 #1444 删了）。
//
// 成功时 stdout 打**一行** JSON：{"ok":true,"file":"site/en/pages/home.json","hash":"<写完之后文件字节的 sha256>"}（`hash` 是 #1415 加的）
//
// 退出码（worker 一一对上一句给老板看的话）：
//   0 成功   4 找不到那一页   5 参数或页面 JSON 的形状不对
//   9 这份页面放进去，这个站就建不出来了（构建自己那套校验不收）—— 不写
//  10 这一页在编辑器打开之后被别处改过了（`baseHash` 对不上当前文件）—— 不写
//  11 **拒收**：老板填的链接不是能用的地址（#1416，判据在 `lib/link-href.js`）。stdout 也打一行
//     {"ok":false,"message":"<给老板看的一句话>"}，worker 原样放进编辑器状态栏 —— 不写
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

function die(code, msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

// #1405 —— 判与写搬进了 `lib/page-write.js`（`write-editor-save.js` 共用同一份），这里只剩读参数。
let blocks;
let pageFiles;
let siteShape;
let pageWrite;
try {
  blocks = require(path.join(ROOT, 'scripts', 'blocks.js'));
  pageFiles = require(path.join(ROOT, 'scripts', 'lib', 'page-files.js'));
  siteShape = require(path.join(ROOT, 'scripts', 'lib', 'site-shape.js'));
  pageWrite = require(path.join(ROOT, 'scripts', 'lib', 'page-write.js'));
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
const localeIn = typeof loc.locale === 'string' ? loc.locale : '';
if (localeIn && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(localeIn)) die(5, `locale 形状不对：${JSON.stringify(localeIn)}`);

let next;
try {
  next = JSON.parse(fs.readFileSync(0, 'utf-8'));
} catch (e) {
  die(5, `stdin 不是合法 JSON：${e.message}`);
}

try {
  const target = pageWrite.resolveTarget(ROOT, siteShape, localeIn);
  const w = pageWrite.planPageWrite({ root: ROOT, blocks, pageFiles, target, slug, baseHash, next });
  pageWrite.commitWrites([w]);
  // #1415 —— `hash`：写进去那份字节的 sha256（`lib/page-write.js` §planPageWrite 算的）。worker 在 commit + push
  // 成功之后把它随 `page-saved` 发给编辑器，当下一次存盘的 baseHash —— 不用等重建完再取一份烤出来的底稿。
  process.stdout.write(`${JSON.stringify({ ok: true, file: path.relative(ROOT, w.file).split(path.sep).join('/'), hash: w.hash })}\n`);
} catch (e) {
  if (e instanceof pageWrite.PageWriteError && e.code === pageWrite.REFUSED) {
    process.stdout.write(`${JSON.stringify({ ok: false, message: e.message })}\n`);
  }
  if (e instanceof pageWrite.PageWriteError) die(e.code, e.message);
  throw e;
}
