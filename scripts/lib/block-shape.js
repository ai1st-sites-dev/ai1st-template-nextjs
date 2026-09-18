// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-shape.js — 一个块今天戴哪个形态（`data-shape` 的三级取值），一处实现（#1318 / #1331 / #1350）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **为什么从 `sync-config.js` 搬出来：这个判据现在有第二个消费者。** #1350 的检查器让老板自己挑
//    形态，而 manager 的那个端点必须在**入队之前**回答同一个问题（这个形态这个站能不能戴），否则
//    「校验说能戴、构建时落回另一个形态」就是这张票要治的那种不一致。判据留在一个 1400 行、
//    从头跑到尾、没有 `module.exports` 的构建脚本里时，第二个消费者按构造只能自己再写一份。
//
// 📌 搬动本身**零行为改动**：函数体逐字不变，调用方 `sync-config.js` 改成 require 它。
//
'use strict';

const fs = require('fs');
const path = require('path');
const blockManifest = require('./block-manifest');
// #1350 —— 「找哪一个块」调 blocks.js 那一份（#1351 建的），不在这里另写一份；理由在
// `scripts/lib/block-shape.js` §checkShapeInSite 上面（就是本文件）。`themes` / `site-regions`
// 只为了回带「主题选择单给这个块的形态」。
const blocksLib = require('../blocks');
const siteRegions = require('./site-regions');
const themes = require('../themes');

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

// ── #1350 —— 「这个块能不能戴这个形态」：一个判据，三个消费者 ────────────────────────────────────
//
// 三个消费者问的是同一个问题，所以判据只能有一份：
//
//   ① manager 的 `PUT /api/sites/{id}/blocks/{blockId}/shape` —— 入队之前同步回答，不行就 400
//      并**点名是哪一种**（AC5：清单里没有它 / 缺槽位，缺槽位的要说缺哪个槽）。
//   ② 检查器面板的形态下拉 —— 缺槽位的那几个灰显、并注明缺哪个槽（AC1 / 设计文档 D11 ⑥）。
//   ③ 构建时的 `shapeForBlock`（上面那个函数）—— 同样两种情况都落回默认。
//
// 🔴 它**不是** `shapeNeedsGap` 的包装糖：`shapeNeedsGap` 回的是一个数组或 `null`，而 `null`
//    （清单里没有这个形态）和 `[]`（一个槽不缺）在 JS 里都很容易被读成「假」。上面 §shapeForBlock
//    那三条分支就是为了把这两件事分开写的。让 ① 和 ② 各自再解一次那个三态返回值，就是
//    「两处各判一点、其中一处把 null 当成 []」——那一格的失败方向是**放行**（校验说能戴、
//    构建时落回另一个形态），正是 #1350 要治的那种不一致。
//
// 回 `{ ok: true }`，或 `{ ok: false, kind, missing, message }`：
//   · `kind === 'candidate'` —— 形态在清单里、槽位也不缺，但它**还没签字进库**（manifest 上标着
//     `candidate: true`，#1384）。老板按不到它（下拉里整条不出现），所以走到这里的只有直接打端点
//     的请求 —— 而它必须被拒，理由见下面那段。
//   · `kind === 'unknown'` —— 这个块的清单里没有这个形态（区块库里压根没有，或者后来被删了）
//   · `kind === 'gap'`     —— 形态在清单里，但这个站的这一块缺它 `needs` 的槽位，`missing` 是槽位名
//   · `message` 是给老板看的**一句话**，manager 原样放进 400 的 `error` 里。
//
// 🔴 **候选那一支必须在这里，不能只在构建那一半（#1350 r6）。** 这两半今天读的是**同一个字段**
//    （`shapes[i].candidate`），而在 r5 之前只有构建那一半读它 ⟹ 校验回 `{ ok: true }`、manager 回
//    202、worker 真把它写进页面 JSON、构建再静默落回主题形态。QA3 2026-09-18 把两半分别量过：
//    `checkShapeInSite` 回 `{"ok":true,…}`，同一状态下构建打「它是候选（还没签字进库），落回默认」。
//    那正是本票要治的「点了保存、产物里却是另一个形态」，只是这一次的触发条件是「区块库里进了一个
//    候选形态」而不是「条目种类不对」。#1364 落地之后它不再是假设（main 上 `trusted-brands` 的
//    `heading-side` / `two-row` 就是候选）。
// 🔴 **判据是 manifest 那个字段，不是一份形态名单。** 名单的失败方向是静默的：区块库明天添一个候选
//    形态，写死名单的那一版正向仍然绿（旧的那两个还在名单里），而新来的那个放行 —— 本票 AC 的反向臂
//    （去掉某个形态的 `candidate` 再重建，它该回到下拉里、而另一个仍不在）就是照这个来的。
// 🔴 **顺序跟 §shapeForBlock 一致：候选在缺槽位【之前】。** 一个形态同时是候选又缺槽位时，两半必须
//    说同一句话；先判缺槽位的话校验会说「先填上 X」，而构建说的是「它是候选」，老板填完 X 再存一次
//    还是存不进去。
//
// 🔴 拿不到这个块的 manifest（`m` 是 undefined）时回 `ok: true` —— 跟 `shapeForBlock` 的
//    `if (!m) return shape;` 是同一个立场：「这个块类型没有 manifest」是另一回事，不由这个函数裁。
//    两处要是在这一格上不一致，就会出现「校验拒了、而构建其实会照戴」这种对不上的话。
function shapeVerdict(m, shapeName, data) {
  if (!m) return { ok: true };
  // 候选那一支 —— 读的是 §shapeForBlock 上面那一段读的同一个字段，写法也照它（按名字找那一项，
  // 找不到就不是这一支的事，交给下面的 `unknown`）。
  const chosen = (Array.isArray(m.shapes) ? m.shapes : []).find((x) => x && x.name === shapeName);
  if (chosen && chosen.candidate === true) {
    return {
      ok: false,
      kind: 'candidate',
      missing: [],
      message: `“${shapeName}” 还没签字进库 —— 它过了全部机器检查，但还等着拍板，所以还不能上真站。`,
    };
  }
  const gap = blockManifest.shapeNeedsGap(m, shapeName, data);
  if (gap === null) {
    const known = (Array.isArray(m.shapes) ? m.shapes : []).map((s) => s && s.name).filter(Boolean);
    return {
      ok: false,
      kind: 'unknown',
      missing: [],
      message: `“${shapeName}” 不是 ${m.type} 这个块的形态。它今天有的是：${known.join('、') || '（一个都没有）'}`,
    };
  }
  if (gap.length > 0) {
    return {
      ok: false,
      kind: 'gap',
      missing: gap.slice(),
      message: `“${shapeName}” 这个形态要先填上 ${gap.join('、')}，填好就能选了`,
    };
  }
  return { ok: true };
}

// ── #1350 —— 容器里那一次调用：「这个站的这一块，能不能戴这个形态」 ─────────────────────────────
//
// manager 的 `PUT /api/sites/{id}/blocks/{blockId}/shape` 在**入队之前**要同步回答这个问题
// （AC5：不行就 400、页面 JSON 不动、队列里没有新任务）。它走的是换主题那条链上同一个机制 ——
// `docker exec -w /app/repo <siteID> timeout … node -e`（`manager/theme.go:421` 的写法，PM 在
// #1350 r2 裁定里点名的）—— 而 `-e` 里只有一句：`require(…).checkShapeInSite(JSON.parse(argv[1]))`。
//
// 🔴 **为什么判据写在这里，而不是写在那句 `node -e` 的字符串里**：写在 Go 的字符串字面量里的
//    JS，`npm run test:scripts` 一个字都看不见。而这段要做的事有三处是**已经付过账**的坑：
//    ① 老 `sections` 形状按下标定位、新形状按 id（id 是现算的，挪一次就变）；② `{ref}` 条目
//    自己身上没有 `type` / `data`，要回站级块库取；③ 老扁平站没有 `site_meta.json`，localeDir
//    就是 `site/` 本身。三条都不是能一眼看对的东西。
//
// 🔴 **「找哪一个块」调的是 `blocks.js` 的 `findBlockInPage`（#1351 建的，一份实现两个调用方）**，
//    不在这里另写一份：worker 写文件时用的是同一个函数。两份实现的失败形态是**校验放行的是
//    A 块、写下去的是 B 块**，而两边各自都绿 —— 没有任何东西会红。
//
// 🔴 `materialize: false`：校验这一步**一个字节都不许写**。补 `{ref}` 条目是写动作，归 worker。
//
// 入参（manager 原样 JSON 传进来）：
//   { rootDir?, page, locale?, blockId?, index?, shape }
// 回（一行 JSON，manager 解它）：
//   { ok, kind?, missing?, message?, type?, blockId?, index?, themeShape? }
//     · `kind` —— 'candidate' | 'unknown' | 'gap'（形态本身不合法，manager 回 400 并原样转 `message`）
//                 'no-page' | 'no-block' | 'bad-locator' | 'bad-shape'（定位不对，同样是 400）
//     · `themeShape` —— 这套主题的选择单给这个块的形态。做什么 #5：老板挑的跟它一样时
//       **不写 `shape` 字段**（manager 把这一笔改发成 `{"shape":null}`），免得页面 JSON 里
//       积一堆「跟主题一样」的显式值 —— 那些值会在下次换主题时把新主题的选择单挡住。
function checkShapeInSite(opts) {
  const o = opts || {};
  const rootDir = o.rootDir || process.cwd();
  const siteDir = path.join(rootDir, 'site');
  const shape = typeof o.shape === 'string' ? o.shape : '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(shape)) {
    return { ok: false, kind: 'bad-shape', missing: [], message: `形态名不对：${JSON.stringify(o.shape)}` };
  }

  // 老扁平站（没有 site_meta.json）的 localeDir 就是 `site/` 本身 —— 跟 `sync-config.js` 判
  // 语言目录是同一条判据，不是这里另立的规矩。
  const isLegacy = !fs.existsSync(path.join(siteDir, 'site_meta.json'));
  let locale = typeof o.locale === 'string' ? o.locale : '';
  if (!isLegacy && !locale) {
    try {
      locale = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf-8')).defaultLocale || 'en';
    } catch (e) {
      return { ok: false, kind: 'no-page', missing: [], message: `读不到 site/site_meta.json：${e.message}` };
    }
  }
  if (locale && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale)) {
    return { ok: false, kind: 'bad-locator', missing: [], message: `locale 形状不对：${JSON.stringify(locale)}` };
  }
  const localeDir = isLegacy ? siteDir : path.join(siteDir, locale);

  const slug = typeof o.page === 'string' ? o.page : '';
  // slug 会被拼进文件路径，而这个值是从网络上来的 ⟹ 挡它的责任在拼路径的这一处。
  if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(slug)) {
    return { ok: false, kind: 'bad-locator', missing: [], message: `页面名不对：${JSON.stringify(o.page)}` };
  }
  const file = path.join(localeDir, 'pages', `${slug}.json`);
  if (!fs.existsSync(file)) {
    return { ok: false, kind: 'no-page', missing: [], message: `这个网站上没有 “${slug}” 这一页` };
  }
  let page;
  try {
    page = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return { ok: false, kind: 'no-page', missing: [], message: `${slug} 这一页的内容读不出来：${e.message}` };
  }

  let siteBlocks = {};
  try { siteBlocks = blocksLib.readSiteBlocks(localeDir); } catch (e) {
    return { ok: false, kind: 'no-page', missing: [], message: e.message };
  }

  const found = blocksLib.findBlockInPage(page, siteBlocks, {
    slug, blockId: o.blockId, index: o.index, materialize: false,
  });
  if (found.error) {
    const why = {
      shape: `${slug} 这一页的内容格式不对`,
      'bad-locator': '没说清楚要改哪一个块',
      'out-of-range': `${slug} 这一页没有第 ${o.index} 个块`,
      'not-found': `${slug} 这一页上找不到 ${JSON.stringify(o.blockId)} 这个块`,
    }[found.error] || found.error;
    return { ok: false, kind: found.error === 'bad-locator' ? 'bad-locator' : 'no-block', missing: [], message: why };
  }

  // `{ref}` 条目自己身上没有 type / data —— 那两样在站级块库里（`blocks.js` §readPageBlocks 解
  // ref 那一支摊开的就是站级块本体）。第 ③ 种定位（visibility 命中、这一页没条目）回来的
  // `entry` 已经是解开的，两条都落在下面这一句上。
  let block = found.entry || {};
  if (typeof block.ref === 'string' && block.type === undefined) {
    const target = siteBlocks[block.ref];
    if (!target) {
      return { ok: false, kind: 'no-block', missing: [], message: `${slug} 这一页引用的 ${JSON.stringify(block.ref)} 在站级块库里没有` };
    }
    block = target;
  }
  if (typeof block.type !== 'string' || !block.type) {
    return { ok: false, kind: 'no-block', missing: [], message: `${slug} 这一页上那个块没有 type` };
  }

  // 🔴 **区块库整个读不到 ⟹ 拒，不放行。** `loadBlockManifests` 对不存在的 `blocks/` 目录回空表，
  //    而空表喂给 `shapeVerdict` 是**逐个形态都放行**（它对「这个块没有 manifest」的立场是不裁）。
  //    那一格的失败方向是静默放行：老板在一个建站日期早于区块库的站上点了保存，manager 回 202、
  //    worker 把一个没人排版的形态名写进页面 JSON，构建时再落回默认 —— 正是本票要治的不一致。
  //    「这个块类型没有 manifest」跟「整个区块库不在」是两件事，只有后者在这里变成一句人话。
  const manifests = blocksLib.loadBlockManifests(rootDir);
  if (Object.keys(manifests).length === 0) {
    return {
      ok: false, kind: 'no-catalog', missing: [],
      message: '这个网站要先更新一次才能在这里换形态（它建得比区块库早）',
    };
  }
  const verdict = shapeVerdict(manifests[block.type], shape, block.data);

  const structureThemeId = siteRegions.readStructureThemeId(siteDir);
  const themeShape = structureThemeId ? (themes.shapesFor(structureThemeId) || {})[block.type] : undefined;

  return {
    ...verdict,
    type: block.type,
    blockId: found.blockId,
    index: found.at,
    ...(typeof themeShape === 'string' ? { themeShape } : {}),
  };
}

// ── #1350 —— 「全部恢复主题默认」：一次清空一页 / 整个站手挑的形态 ───────────────────────────────
//
// 单个块的「恢复主题默认」走的是改一个块那条路（`patch: {"shape": null}`）。**这个函数是另一件事**：
// 页面级 / 站级的「全部恢复」，票里 AC3 第三句要它「对两个手挑块**一次**清空」。
//
// 🔴 **为什么不是「对每个块各发一笔」**：每一笔改动都 commit，而每个 commit 都重建预览
//    （#1192，worker §settleCommittedWork）。一页上三个手挑的块就是三次 commit、三次重建 ——
//    老板点一次按钮，预览在他眼前重刷三遍，中间两遍还是半成品状态。清空是一个动作，就该是一次写、
//    一个 commit。
//
// 🔴 **只删 `shape` 这个键，别的一个字节不碰**（`hidden` / `weight` / `data` 都是别人写的）。
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
      // 缩进跟 `patch-block.js` / `create-site.js` 写盘时一样是两格，不然整份 JSON 会变成一个
      // 看不出改了什么的巨大 diff。
      fs.writeFileSync(file, `${JSON.stringify(page, null, 2)}\n`);
      files.push(path.relative(rootDir, file));
    }
  }
  return { ok: true, cleared, files };
}

module.exports = { shapeForBlock, shapeVerdict, checkShapeInSite, resetShapesInSite };
