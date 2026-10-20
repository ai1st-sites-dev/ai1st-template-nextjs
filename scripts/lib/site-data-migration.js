'use strict';
// site-data-migration.js —— 「更新网站」那条路（#1166）在铺完今天的模板之后、构建之前，对站的数据做的两件事。
//
// 🔴 #1916 —— 这份文件原来还是一台【块改名机器】：两张迁移表（按类型改名 / 带条件改形状）+ 改写函数，把老块类型名改成
//    今天的名字。那两张表 #1425 起就是空的，块的数据迁移从 #1838 起只有一条路：块文件夹里的 `migrations.js`
//    （`lib/block-migrations.js`；跨类型的 `'<旧类型>→<新类型>'` 那里今天只认形状、不跑，归 T4c）。改名那一半整个删了，这里只剩：
//   ① 升级前的检查 —— 页面 / 站级块库里出现一个今天的模板不认识的块类型 ⟹ 报出是哪一页哪一块、整站不升、一个字节都不写
//      （#1166 的「宁可升不了，也不许静默删掉客人的内容」：未知类型在新模板上走 `SectionRenderer` 那条 console.warn +
//      return null，块从页面上消失而构建照样 exit 0）
//   ② #1639 关键词页页尾回服务详情页那一组链接的回填
//
// 🔴 文件名不改：worker 那张升级前置清单按文件名查它（`worker/main.go` §upgradeScriptsInTemplate），查不到就拒跑升级。
// 📌 这条路**不跑** `migrations.js`：它只读 `pages/**` 和 `blocks/site-blocks.json`，顶栏 / 页脚住在 `navigation.json`。
const fs = require('fs');
const path = require('path');
const { addRelatedBlocks, serviceIdOfKeywordPath } = require('./keyword-pages');

// knownBlockTypes —— 今天的模板认得哪些块类型。
//
// 🔴 权威是 `src/lib/sections/block-roles.json` 的键，不是 `registry.ts`：后者是 TypeScript，node
// require 不动，而按正则去抠一份 TS 文件就是第二份实现。那张 JSON 是类型级角色表，CLAUDE.md 的
// 「Adding a New Section」第 3 步要求每个新类型都在里面有一行，`978-theme-preview-layout.spec.ts`
// 会当场抓住漏的。两边的键集相等由 §site-data-migration.test.js 盯着。
// 🔴 #1353 —— 这个集合问的是「**页面 JSON 里**写得出哪些 type」，所以**外壳区不算**。顶栏 / 页脚
// 今天在角色表里各占一行（它们是块：有 manifest、有形态、受同一批守卫），但它们**不进页面 JSON**：
// 哪一页有它们由 page layout 库说、`SiteShell.tsx` 渲染，`registry.ts` 那张「页面 JSON 的 type →
// 组件」的表里按构造没有它们。不滤掉的后果是这个函数会把 `{"type":"header"}` 判成一个认得的页面块
// —— 升级放行、构建不拦，而 `SectionRenderer` 查不到组件，那一块**静默不渲染**。
// 判据用 manifest 自己声明的 `region: true`，不推断（同 `block-manifest.js` 的 `isRegionManifest`）。
function knownBlockTypes(rootDir) {
  let manifests;
  try {
    manifests = require(path.join(rootDir, 'scripts', 'lib', 'block-manifest.js'))
      .loadManifests(path.join(rootDir, 'blocks'));
  } catch {
    manifests = null; // 读不到 manifest 就不滤 —— 失败方向是「多认几个」，跟本函数此前的行为一致。
  }
  return new Set(Object.keys(blockRoles(rootDir))
    .filter((t) => !(manifests && manifests.get(t) && manifests.get(t).region === true)));
}

// blockRoles —— 今天那张类型级角色表本身（`knownBlockTypes` / §planSiteMigration 只要它的键）。
function blockRoles(rootDir) {
  const p = path.join(rootDir, 'src', 'lib', 'sections', 'block-roles.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// siteDataFiles —— 这次要看的文件：每一页，加上站级块库（如果有）。
//
// 两种布局都收：`site/pages/*.json`（老的单语言，扁平）和 `site/<locale>/pages/*.json`
// （`site_meta.json` 在场时的多语言）。判据是**目录里有没有 `pages/`**，不是读 `site_meta.json`
// —— 后者是「用哪种布局」的开关，而这里问的是「有哪些页面文件」，前者答得更直接，也顺带收得住
// 「两种布局同时存在」这种手改出来的树。
function siteDataFiles(siteDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.json')) {
        const rel = path.relative(siteDir, full).split(path.sep);
        if (rel.includes('pages')) out.push(full);
        else if (rel[rel.length - 2] === 'blocks' && e.name === 'site-blocks.json') out.push(full);
      }
    }
  };
  walk(siteDir);
  return out.sort();
}

// blocksOf —— 一个文件里的块数组，连它叫什么一起返回。
//
// 页面有两种形状并存（#998）：新建的站写 `blocks`，#998 之前建的站磁盘上仍然是 `sections`。站级块
// 库是第三种：键是块 id、值是块。三种都要查，因为认不出的类型名在三种里都可能出现。
function blocksOf(doc) {
  if (Array.isArray(doc.blocks)) return { kind: 'array', key: 'blocks', list: doc.blocks };
  if (Array.isArray(doc.sections)) return { kind: 'array', key: 'sections', list: doc.sections };
  // 站级块库：整份就是一张 id → 块 的表，没有 blocks/sections 键。
  const values = Object.values(doc);
  if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
    return { kind: 'map', key: null, list: values };
  }
  return { kind: 'none', key: null, list: [] };
}

// planSiteMigration —— 先把整个站算一遍，再决定动不动手。
//
// 🔴 两阶段是硬要求，不是洁癖：**认不出的一律不许升**（#1166 AC10 反向那一半）。数据里出现一个
// 今天的模板不认识的类型名 ⟹ 在动任何文件之前中止，报出是哪几页哪几个块。
// 边写边发现 = 半新半旧的磁盘，而那正是「宁可升不了，也不许静默删掉客人的内容」要防的东西。
//
// 返回 { blockers, related, files }：
//   blockers  [{ file, index, id, type }]  —— 非空就不许写
//   related   [{ file, slug }]                —— #1639：补了页尾那一组回服务详情页链接的关键词页
//   files     [{ file, doc, changed }]     —— applyPlan 要写的那些
function planSiteMigration(siteDir, options = {}) {
  const rootDir = options.rootDir || path.resolve(siteDir, '..');
  const known = options.knownTypes || new Set(Object.keys(options.blockRoles || blockRoles(rootDir)));
  const blockers = [];
  const related = [];
  const files = [];

  for (const file of options.files || siteDataFiles(siteDir)) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      // 读不出来的 JSON 也是「不许升」：它可能正是那一页的内容，而我们无从判断它里面有什么。
      blockers.push({ file, index: -1, id: null, type: null, reason: `unreadable JSON: ${e.message}` });
      continue;
    }
    const { list } = blocksOf(doc);
    let changed = false;
    list.forEach((block, index) => {
      if (!block || typeof block !== 'object') return;
      // `{ "ref": "<id>" }` 那种条目没有自己的 type，它指向站级块库里那一条（#998）。
      if (typeof block.type !== 'string') return;
      if (!known.has(block.type)) {
        blockers.push({ file, index, id: block.id || null, type: block.type, reason: 'unknown block type' });
      }
    });
    // #1639 —— 关键词页页尾那一组回服务详情页的链接（#1630 把面包屑删了，回去只剩这一条）。建站那条路由
    //    `keyword-pages.js` §addRelatedBlocks 写；升级不重新建站 ⟹ 这里调**同一个函数**补上，不另写规则。
    //    它幂等（已经带 `withParent` 的不动），所以「改了没有」按改前改后的 JSON 比，不按它的返回值。
    if (isKeywordPage(doc)) {
      const before = JSON.stringify(doc);
      addRelatedBlocks([doc], localeOfPageFile(siteDir, file), []);
      if (JSON.stringify(doc) !== before) {
        related.push({ file, slug: doc.slug });
        changed = true;
      }
    }
    files.push({ file, doc, changed });
  }
  return { blockers, related, files };
}

// 关键词页 = slug 是 `services/<id>/<词>` 的页面（同 §addRelatedBlocks 自己那一道判据；老形状 `<服务slug>/<词>` 不算）。
function isKeywordPage(doc) {
  return !!doc && typeof doc === 'object' && !Array.isArray(doc)
    && (Array.isArray(doc.blocks) || Array.isArray(doc.sections))
    && serviceIdOfKeywordPath(doc.slug) !== null;
}

// 页尾那一组的标题用哪种语言：`<siteDir>/<语言>/pages/…` 取那一段；没有语言目录的老站（`<siteDir>/pages/…`）
// 读 site_meta.json 的 defaultLocale，没有就 en（同 sync-config.js 的老站兜底）。
function localeOfPageFile(siteDir, file) {
  const rel = path.relative(siteDir, file).split(path.sep);
  if (rel.length > 2 && rel[1] === 'pages') return rel[0];
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf-8'));
    if (meta && typeof meta.defaultLocale === 'string' && meta.defaultLocale) return meta.defaultLocale;
  } catch { /* 老站没有这份文件 */ }
  return 'en';
}

// applyPlan —— 把改过的文件写回去。计划里有 blocker 时它拒绝动手（第二道，第一道是调用方）。
//
// 🔴 写法是 `JSON.stringify(doc, null, 2) + '\n'` —— 跟 `create-site.js` / worker 写 theme.json
// 用的同一种，所以「没有要补的站，文件逐字节不变」这件事靠的是**根本不写**（`changed` 为 false
// 的文件跳过），不是靠格式化碰巧一致。
function applyPlan(plan) {
  if (plan.blockers.length) {
    throw new Error(`refusing to write: ${plan.blockers.length} block(s) cannot be migrated`);
  }
  const written = [];
  for (const f of plan.files) {
    if (!f.changed) continue;
    fs.writeFileSync(f.file, `${JSON.stringify(f.doc, null, 2)}\n`);
    written.push(f.file);
  }
  return written;
}

module.exports = {
  knownBlockTypes,
  blockRoles,
  siteDataFiles,
  blocksOf,
  planSiteMigration,
  applyPlan,
};
