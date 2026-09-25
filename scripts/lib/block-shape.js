// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-shape.js — 一个块今天戴哪个形态（`data-shape` 的三级取值），一处实现（#1318 / #1331 / #1350）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **为什么从 `sync-config.js` 搬出来：这个判据有不止一个消费者。** 当年（#1350）是检查器的单块形态
//    端点要在入队之前回答同一个问题；那条端点 #1444 删了，今天的消费者是构建（`lib/block-decorate.js`）、
//    编辑器的 schema（`lib/editor-schema.js`）和下面的「全部恢复」。判据留在一个
//    1400 行、没有 `module.exports` 的构建脚本里时，别的消费者按构造只能自己再写一份。
//
// 📌 搬动本身**零行为改动**：函数体逐字不变，调用方 `sync-config.js` 改成 require 它。
//
'use strict';

const fs = require('fs');
const path = require('path');
const blockManifest = require('./block-manifest');

// #1318 —— `data-shape` 的取值，spec D18 的三级，**一处实现**：
//
//     ① 页面 JSON 里这个块自己的 `shape`   —— 站级的选择。本票用不到（建站 AI 还不写它），先接上，
//                                             免得第三步（站级覆盖那张票）再把这个函数拆一遍。
//     ② 这套主题的选择单                    —— `theme-pool.json` 的 `shapes`，今天两套各 31 个键。
//     ③ 块 manifest 的默认                  —— `blocks/<type>.json` 的 `shapes[0]`。今天 31 份里
//                                             **0 份**有这个键（那是设计文档第一步的活，PM 裁定 ④
//                                             说本票不加），所以这一级现在恒回 undefined。
//
// 🔴 三级都取不到就**不写这个属性**，不造一个兜底值。造一个（比如 "default"）会让
//    `public/shapes.css` 里 `[data-shape="default"]` 这类选择器选中一批「其实没人选过画法」的块，
//    而那是静默的：页面照样打开。同一条理由写在 `blockAttrs.ts` 的 `data-shape` 那一段上
//    （#1341 之前它是写在已退役的 `block_layout` 那一段上的）。
//
// #1331 —— 第 ③ 级填上了（31 份 manifest 都有 `shapes`，第 0 项是默认），而且取到形态之后**多问一句**
// （设计文档 D11 ⑥）：这个站的这块填了它 `needs` 的槽位没有 —— 没填就落回 manifest 默认，并在构建
// 日志说一行。判据是 block-manifest.js 的 `shapeNeedsGap`，跟 validateSite 第 ⑥ 条是**同一个函数**
// （那里说「会落回」，这里真落回；两份实现会静默分叉）。形态不在清单里（主题选择单或页面 JSON 写了
// 一个 CSS 里没有的名字）也落回默认 —— 写一个没人排它的名字，跟造兜底值是同一种静默失败。
// 🔴 默认形态自己不再核 needs：checkManifestShape 保证 shapes[0].needs 为空，落回它就是落地。
function shapeForBlock(block, selection, manifests, log = (line) => console.log(line)) {
  const m = manifests[block.type];
  const fallback = blockManifest.defaultShapeOf(m);
  let shape; let from;
  if (typeof block.shape === 'string' && block.shape) { shape = block.shape; from = '页面 JSON'; }
  else if (typeof selection[block.type] === 'string' && selection[block.type]) { shape = selection[block.type]; from = '主题选择单'; }
  else {
    // #1338 —— 这条路以前是**静默**的：页面 JSON 没点名形态、主题选择单里也没有这个块 ⟹ 直接落回
    // manifest 的默认形态，一行日志都不打。同一个函数里「形态不在这个块的清单里」那条（下面那行
    // ⚠️）是说话的，而两条的后果一模一样 —— 这个块戴的不是主题想给它的那个形态 —— 所以这条也要
    // 说一句。格式跟那条逐字同构，只有中间说原因的那半句不同。
    // 🔴 拿不到这个块的 manifest 时**不说话**：那时 `fallback` 是 undefined，打出来就是「落回默认
    //    undefined」，一句会把读日志的人带偏的话。「这个块类型没有 manifest」是另一回事，不在这条
    //    日志的射程里。
    if (m) log(`  ⚠️  块 ${block.type} 页面 JSON 和主题选择单都没给它形态，落回默认 ${fallback}`);
    return fallback;
  }
  if (!m) return shape;
  // #1384 —— **候选形态点名了也落回默认。** 候选 = 过了全部机器检查、Chris 还没点头；它进 `shapes.css`、
  // 进图册、被每一道守卫量，唯独不许真站戴上它。两条会让站戴上形态的路各堵一处，这里是第二条
  // （第一条是主题选择单，堵在 `theme-pipeline/shape-sheet.js` 的 `shapeSheetFor`）。
  // 🔴 **不按来源分**：正文点名的是页面 JSON 那一条，而这里对两个来源一视同仁 —— 选择单那一侧虽然有
  //    生成器和 `pool.test.js` ⑪ 两道在前面挡着，但它们挡的是「新产出的 / 池里的」单子，手改一份
  //    `theme-pool.json` 或者装一套候选主题都能绕过去，而绕过去的后果正好是本票要防的那一件事。
  //    分来源写就是把这条堵法做成「只在一条路上成立」，那不是堵。
  // 🔴 落回的是 manifest 默认，而默认按 `checkManifestShape` 不许是候选 ⟹ 落点一定是实的。
  // 📌 #1350 r5 —— 这一段是 #1384 写在 `sync-config.js` 里那份 `shapeForBlock` 上的，而本票把这个函数
  //    搬来了这里。合并时**原样搬过来**，不是重写：两份实现会静默分叉，而这恰好是搬家那张票自己的理由。
  const chosen = (Array.isArray(m.shapes) ? m.shapes : []).find((x) => x && x.name === shape);
  if (chosen && chosen.candidate === true) {
    log(`  ⚠️  块 ${block.type} 选了形态 ${shape}（${from}）但它是候选（还没签字进库），落回默认 ${fallback}`);
    return fallback;
  }
  const gap = blockManifest.shapeNeedsGap(m, shape, block.data);
  if (gap === null) {
    log(`  ⚠️  块 ${block.type} 选了形态 ${shape}（${from}）但 blocks/${block.type}.json 的 shapes 清单里没有它，落回默认 ${fallback}`);
    return fallback;
  }
  if (gap.length > 0) {
    log(`  ⚠️  块 ${block.type} 选了形态 ${shape} 但缺槽位 ${gap.join('、')}，落回默认 ${fallback}`);
    return fallback;
  }
  return shape;
}

// 📌 这里原来还有 `shapeVerdict`（「这个块能不能戴这个形态」）和 `checkShapeInSite`（manager 的
//    `PUT /api/sites/{id}/blocks/{blockId}/shape` 入队前去容器里问的那一句）。两个都只为检查器那条
//    单块形态端点存在；检查器 #1411 退役、那条端点 #1444 删了，它们跟着删。Puck 的形态随整页一起存
//    （`PUT /api/sites/{id}/pages`），判据是构建时的 `lib/block-shape.js` §shapeForBlock 那一份。
//    🔴 连带删掉的还有 `checkShapeInSite` 头上那条「老板挑的跟主题一样时不写 `shape` 字段」的规矩 ——
//    #1443 已经把 Puck 的 Layout 下拉改成「点名任何形态都钉住，要跟着主题走就选 `Theme default`」，
//    那条旧规矩跟线上行为相反，不留在仓里。

// ── #1350 —— 「全部恢复主题默认」：一次清空一页 / 整个站手挑的形态 ───────────────────────────────
//
// 单个块的「恢复主题默认」在 Puck 里是 Layout 下拉的 `Theme default`，随整页存。**这个函数是另一件事**：
// 页面级 / 站级的「全部恢复」，票里 AC3 第三句要它「对两个手挑块**一次**清空」。
//
// 🔴 **为什么不是「对每个块各发一笔」**：每一笔改动都 commit，而每个 commit 都重建预览
//    （#1192，worker §settleCommittedWork）。一页上三个手挑的块就是三次 commit、三次重建 ——
//    老板点一次按钮，预览在他眼前重刷三遍，中间两遍还是半成品状态。清空是一个动作，就该是一次写、
//    一个 commit。
//
// 🔴 **只删 `shape` 这个键，别的一个字节不碰**（`role` / `weight` / `data` 都是别人写的）。
//    判据是删完之后那份 JSON 除了少掉这些键之外逐字节相同 —— 测试里量的就是它。
//
// 范围：给了 `page` 就只清那一页；不给就清这个站**全部语言的全部页面**。
// 回 `{ ok, cleared: [{ locale, page, blockId, was }], files: [相对路径…] }`；一个都没有时
// `cleared` 是空数组、`files` 也是空的 —— 那时**一个文件都不写**（没有改动就不该有 commit）。
function resetShapesInSite(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || process.cwd();
  const siteDir = path.join(rootDir, 'site');

  const isLegacy = !fs.existsSync(path.join(siteDir, 'site_meta.json'));
  let locales = [''];
  if (!isLegacy) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf-8'));
      locales = Array.isArray(meta.locales) && meta.locales.length ? meta.locales : [meta.defaultLocale || 'en'];
    } catch (e) {
      return { ok: false, cleared: [], files: [], message: `读不到 site/site_meta.json：${e.message}` };
    }
  }
  if (typeof o.locale === 'string' && o.locale) locales = [o.locale];

  const onlyPage = typeof o.page === 'string' ? o.page : '';
  if (onlyPage && !/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(onlyPage)) {
    return { ok: false, cleared: [], files: [], message: `页面名不对：${JSON.stringify(o.page)}` };
  }

  const cleared = [];
  const files = [];
  for (const locale of locales) {
    if (locale && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale)) {
      return { ok: false, cleared: [], files: [], message: `locale 形状不对：${JSON.stringify(locale)}` };
    }
    const localeDir = isLegacy ? siteDir : path.join(siteDir, locale);
    const pagesDir = path.join(localeDir, 'pages');
    if (!fs.existsSync(pagesDir)) continue;
    for (const f of fs.readdirSync(pagesDir).sort()) {
      if (!f.endsWith('.json')) continue;
      const slug = f.replace(/\.json$/, '');
      if (onlyPage && slug !== onlyPage) continue;
      const file = path.join(pagesDir, f);
      let raw;
      let page;
      try {
        raw = fs.readFileSync(file, 'utf-8');
        page = JSON.parse(raw);
      } catch (e) {
        return { ok: false, cleared: [], files: [], message: `${slug} 这一页的内容读不出来：${e.message}` };
      }
      const list = Array.isArray(page.blocks) ? page.blocks : (Array.isArray(page.sections) ? page.sections : null);
      if (!list) continue;
      let touched = 0;
      list.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
        if (!Object.prototype.hasOwnProperty.call(entry, 'shape')) return;
        cleared.push({
          locale, page: slug, blockId: entry.id || entry.ref || '', index: i, was: entry.shape,
        });
        delete entry.shape;
        touched += 1;
      });
      // 🔴 一个块都没动的页面**不写回**：写回会换掉 mtime，而 `sitemap.ts` 的 `<lastmod>` 有一条
      //    mtime 兜底（`scripts/lib/page-lastmod.js` §createLastModifiedResolver，`sync-config.js` 调它），
//    于是「点了一次全部恢复」
      //    会把全站每一页的 lastmod 都推到今天 —— 一个没人要求过的、对外可见的改动。
      if (touched === 0) continue;
      // 缩进跟 `create-site.js` / `lib/page-write.js` 写盘时一样是两格，不然整份 JSON 会变成一个
      // 看不出改了什么的巨大 diff。
      fs.writeFileSync(file, `${JSON.stringify(page, null, 2)}\n`);
      files.push(path.relative(rootDir, file));
    }
  }
  return { ok: true, cleared, files };
}

module.exports = { shapeForBlock, resetShapesInSite };
