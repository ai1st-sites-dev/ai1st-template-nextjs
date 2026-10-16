#!/usr/bin/env node

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// derive-site.js —— 派生的 CLI / require 薄壳（#1797，Epic:SiteAsData T2a-1）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 派生本身（校验 · 菜单同步 · theme.css / custom.css / site.css）住在 `lib/derive-core.js` §deriveSite，是纯函数：
// 不 process.exit、没有模块级状态、输入输出走参数。这份文件只做「今天磁盘上那个 site/」那一半：
//   ① 读 `SYNC_SITE_DIR` 或 `<模板>/site`（没有就退出 —— 它是 CLI）、读 `AI1ST_RENDER`（preview ⟹ site.css 不剪）
//   ② 把 site/ 读成 content（原文），按 git log / 文件 mtime 算好每份文件的 lastModified（`lib/page-lastmod.js`，规则没变）
//   ③ 调 deriveSite，产物先进一个临时目录
//   ④ 在站点文件锁里（#1807）：把返回的 `contentPatches`（菜单、custom.css）写回 site/ —— 写前拿开头读到的字节跟盘上
//      现在那份比，不一样就不写；再把临时目录里的三份 CSS 搬进 public/
//   ⑤ `ready` 交出 `d`（键集跟改前逐字一样：sync-config.js 的 prebuild 拿它拼 config-data.ts）
//
// 谁调它：worker §refreshLivePreview（`worker/preview_live.go`）· 容器启动（`worker/entrypoint.sh`）· 建站各阶段
// （`lib/staged-preview.js` §liveStage，靠退出码判派生失败）· `sync-config.js` 头一件事就 require 本文件。
//
// 🔴 不给 deriveSite 缓存目录：这里每次都真编 site.css（`derive-site-concurrent.test.js` 靠「编 site.css 要几秒」咬住
//    写盘窗口；命中缓存那格会当场报「尺子没咬到窗口」）。缓存是 T2a-2 / T2c 的事。
// 🔴 stdout 里 `Regenerated navigation.json` 和 `Generated public/site.css` 两行是 `derive-site-concurrent.test.js` 的同步点。
//    它们由 derive-core 打，别在这里吞掉 stdout。

const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
// #1599 —— 分段建站的预览构建读一份快照（lib/staged-preview.js：给预览写的文件不进 site/、不进阶段提交），由 SYNC_SITE_DIR
//    给路径。不给 = site/。快照不在 git 里 ⟹ sitemap 的 <lastmod> 落到 mtime 那一档（lib/page-lastmod.js），预览站不发布，无所谓。
const siteDir = process.env.SYNC_SITE_DIR ? path.resolve(process.env.SYNC_SITE_DIR) : path.join(rootDir, 'site');

if (!fs.existsSync(siteDir) || !fs.existsSync(path.join(siteDir, 'brand.json'))) {
  console.error(`Site config not found: ${siteDir}/brand.json`);
  process.exit(1);
}

// #1666 —— 预览还是发布（取值与报错同 `next.config.js`：只认 preview / publish，不给 = publish）。
const renderMode = process.env.AI1ST_RENDER || 'publish';
if (renderMode !== 'preview' && renderMode !== 'publish') {
  console.error(`AI1ST_RENDER 只认 preview / publish（不给 = publish），拿到的是 ${JSON.stringify(process.env.AI1ST_RENDER)}`);
  process.exit(1);
}
const isPreview = renderMode === 'preview';

const { deriveSite, DeriveError } = require('./lib/derive-core');
const { createLastModifiedResolver } = require('./lib/page-lastmod');
const { withSiteFilesLock } = require('./lib/site-files-lock');

/**
 * site/ → content（键 = 相对路径，值 = 原文）。原文而不是解析后的对象：坏掉的 JSON 要在 derive-core 原来那一处、用原来那句话
 * 报出来（forms.json 坏了只说不拦，页面坏了拒）。`bytesAtStart` 是 #1807 写回前比字节用的：🔴 记的是**拿去派生的那同一份字节**，
 * 不是事后再读一遍 —— 两次读之间又是一个窗口。不是 UTF-8 的文件（图）派生不读，不进 content。
 */
function readSite(dir) {
  const content = {};
  const bytesAtStart = new Map();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(r); continue; }
      if (!e.isFile()) continue;
      const bytes = fs.readFileSync(path.join(dir, r));
      let text;
      try { text = utf8.decode(bytes); } catch { continue; }
      content[r] = text;
      bytesAtStart.set(r, bytes);
    }
  }(''));
  return { content, bytesAtStart };
}

const { content, bytesAtStart } = readSite(siteDir);

// #1026 —— 这次构建的时刻。只在「既拿不到 git 提交时间、也读不到文件修改时间」时才会被用上，而且那时会在日志里点名说出来。
const buildTime = new Date().toISOString();
const resolver = createLastModifiedResolver({
  rootDir,
  pathspec: path.relative(rootDir, siteDir) || 'site',
  buildTime,
  git: !isPreview,   // #1666 —— 预览只看文件改动时间，不跑 git log（理由在 lib/page-lastmod.js 那个参数上）
});
if (resolver.shallow) {
  // #1033 —— 浅克隆里 git 只有一个提交，每个文件「上次被哪次提交碰过」都是那一次 ⟹ 全站页面的日期并成一个。
  console.log('  ⚠️  这是一个浅克隆（git 历史被砍掉了）：所有页面的 <lastmod> 会并成同一次提交的'
    + '时间，而不是各自上次真的变化的时间');
}
const lastModified = {};
for (const rel of Object.keys(content)) lastModified[rel] = resolver.resolveLatest([path.join(siteDir, rel)]).value;

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-site-out-'));
const publicDir = path.join(rootDir, 'public');

const ready = deriveSite({
  content, outDir, purge: !isPreview, lastModified, siteLabel: siteDir, buildTime,
}).then((r) => withSiteFilesLock(() => {
  try {
    // #1807 —— 写回 site/：开头读过的那份跟盘上现在这份不一样 = 派生读完之后别处（编辑器存盘 / AI 改站）改过它 ⟹ 不写。
    //    不写也不丢东西：那一笔自己提交之后 worker 会再派生一次，那一次读到的就是新内容。
    for (const [rel, text] of Object.entries(r.contentPatches)) {
      const file = path.join(siteDir, rel);
      let now = null;
      try { now = fs.readFileSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const then = bytesAtStart.has(rel) ? bytesAtStart.get(rel) : null;
      if (now === null ? then !== null : (then === null || !now.equals(then))) {
        console.log(`  #1807 ${path.relative(rootDir, file)} changed while this derive was running (an editor save or an AI edit) `
          + '— not overwriting it; that change\'s own commit derives again');
        continue;
      }
      if (text === null) fs.rmSync(file, { force: true });
      else if (now === null || !now.equals(Buffer.from(text))) fs.writeFileSync(file, text);
    }
    // 产物：三份 CSS 搬进 public/。site.css 编不出来时 outDir 里没有它 ⟹ 删掉上一次那份（derive-core 已经喊过一行）。
    fs.mkdirSync(publicDir, { recursive: true });
    for (const name of ['theme.css', 'custom.css', 'site.css']) {
      const from = path.join(outDir, name);
      if (fs.existsSync(from)) fs.writeFileSync(path.join(publicDir, name), fs.readFileSync(from));
      else fs.rmSync(path.join(publicDir, name), { force: true });
    }
  } catch (e) {
    console.error(`🔴 派生文件写盘失败：${e && e.message}`);
    fs.rmSync(outDir, { recursive: true, force: true }); // exit 之后下面那个 .finally 不会跑（QA2 #1797 r1：每坏一次留一个空目录）
    process.exit(1);
  }
}).then(() => r.data)).catch((e) => {
  // deriveSite 的拒绝（DeriveError）报错原文就是那句话；别的异常（坏 JSON、代码 bug）连栈一起打。
  console.error(e instanceof DeriveError ? e.message : (e && e.stack) || String(e));
  fs.rmSync(outDir, { recursive: true, force: true }); // 同上
  process.exit(1);
}).finally(() => fs.rmSync(outDir, { recursive: true, force: true }));

module.exports = { ready };
