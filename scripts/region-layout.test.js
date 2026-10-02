#!/usr/bin/env node
/**
 * region-layout.test.js — 三个 Region 的形态解析，两条承重性质的常设守卫。
 *
 *   node scripts/region-layout.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * #1086 的 QA3 真改坏跑过：把「先合并版式、再据合并结果算遮罩」的顺序写反，
 * `1086-structure-follows-theme-id.spec.ts` 的 5 格全绿。后果是显式声明透明浮层的站**没有那层遮罩**
 * —— 白字压浅底，就是 #1024 那类事故（`region-layout.js` 文件头 ② 记着实测：公司名 + 4 条导航链接
 * 全是 1.00:1，一个字都看不见）；同族的另一半是清单外的版式名**原样落进 DOM 属性**。
 *
 * 🔴 #1353 —— 上半条那个性质**换家了，没有消失**。顶栏搬进形态层之后 `headerScrim` 这个构建期的值
 *    没了：遮罩元素恒在 DOM 里，露不露面由 `public/shapes.css` 按两个条件一起判
 *    （`[data-shape="transparent-overlay"]` **且** `[data-over-hero="true"]`）。所以 ① ② 两格改成
 *    去问那份 CSS：**开遮罩的那条规则必须两个条件都带**，而且**不许有任何一条只带其中一个就开它**。
 *    少一个条件的后果跟 #1086 那次一模一样 —— 要么每一页顶上都压一条黑渐变（about 页也压），
 *    要么该有遮罩的首屏没有。
 *    📌 这一格**不读组件**：组件那一半（`overlaid` 怎么算）由 e2e 看，这里守的是纯文本可判的那一半。
 *
 * 📌 #1425（T3）—— 公告条那个区（topbar）随旧库退役，`REGION_BLOCK` 只剩 header / footer；新 header 没有透明浮层
 *    形态，遮罩（`.header__scrim` / `data-over-hero`）一起删了 ⟹ 上面说的 ① ② 两格没有对象，原位删了。
 *
 * 🔴 ④ 那格的清单**从 manifest 现取**（`shapesOf()`）——`HEADER_VARIANTS` 那三张写死的表随本票退役。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const RL = require('./region-layout.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

for (const k of ['resolveRegionShapes', 'shapesOf', 'REGION_BLOCK']) {
  if (RL[k] === undefined) die(`region-layout.js 没导出 ${k} —— 这一格量不到它要量的东西`);
}
const { resolveRegionShapes: resolve, shapesOf, REGION_BLOCK } = RL;

const HEADER_SHAPES = shapesOf('header');
const FOOTER_SHAPES = shapesOf('footer');
const DEFAULT_HEADER = HEADER_SHAPES[0];
const DEFAULT_FOOTER = FOOTER_SHAPES[0];

// 📌 #1425（T3）—— topbar 区退役：REGION_BLOCK 必须正好是 header / footer（多出一个区而这份测试不量它 = 静默）。
if (JSON.stringify(Object.keys(REGION_BLOCK).sort()) !== JSON.stringify(['footer', 'header'])) {
  die(`REGION_BLOCK 的区是 ${JSON.stringify(Object.keys(REGION_BLOCK))}，这份测试只量 header / footer —— 先把新区补进来`);
}
if (!HEADER_SHAPES.length || !FOOTER_SHAPES.length) {
  die(`某个区的形态清单是空的（header ${HEADER_SHAPES.length} · footer ${FOOTER_SHAPES.length}）—— manifest 读不到就什么都没量成`);
}

// 📌 #1425（T3）—— 这里原来是 ① ②：`public/shapes.css` 里开 `.header__scrim` 遮罩的规则必须同时带
//    `[data-shape="transparent-overlay"]` 与 `[data-over-hero="true"]`（含阳性对照）。透明浮层顶栏与它的遮罩
//    随旧 header 删了（新 header 7 个预设里没有它，`SiteShell` 的 overHero 也删了）。

// ── ③ 清单外的值必须落回默认，而且**返回值恒在清单里**（它会原样落进 DOM 的 data-shape）───────
{
  const junk = ['transparent-overlay ', 'TRANSPARENT-OVERLAY', 'pill-floating; drop table', '../../etc/passwd', '{}'];
  const problems = [];
  for (const v of junk) {
    const r = resolve({ header: v, footer: v });
    if (r.header.shape !== DEFAULT_HEADER) problems.push(`header=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.header.shape)}(该退回 ${DEFAULT_HEADER})`);
    if (r.footer.shape !== DEFAULT_FOOTER) problems.push(`footer=${JSON.stringify(v)} ⟹ ${JSON.stringify(r.footer.shape)}(该退回 ${DEFAULT_FOOTER})`);
    if (!r.notes.some((n) => n.includes(String(v)))) problems.push(`退回了但 notes 里没说是因为 ${JSON.stringify(v)} —— 静默降级`);
  }
  if (problems.length === 0) {
    ok(`${junk.length} 个清单外的形态名全部落回默认，并且每一个都在 notes 里说了理由`);
  } else problems.forEach(bad);
}

// ── ④ 清单里的每一项都必须原样通过（否则 ③ 用「永远退回默认」也能满足）─────────────────────────
{
  const problems = [];
  for (const v of HEADER_SHAPES) if (resolve({ header: v }).header.shape !== v) problems.push(`header ${v}`);
  for (const v of FOOTER_SHAPES) if (resolve({ footer: v }).footer.shape !== v) problems.push(`footer ${v}`);
  if (problems.length === 0) {
    ok(`清单里 ${HEADER_SHAPES.length}+${FOOTER_SHAPES.length} 个形态全部原样通过(反向对照)`);
  } else bad(`这些清单内的形态没被原样通过:${problems.join(' · ')}`);
}

// 📌 #1425（T3）—— 这里原来是 ⑤：「选择单用块类型键（announcement-bar）、theme.json 用区名键（topbar）两种都认」。
//    区名与块名不同的只有公告条那一个区，它退役了 —— 今天 header / footer 两种键名逐字相同，这一格没有对象。

// ── ⑥ 没换装（传 {}）⟹ 两个区都是各自 manifest 的第 0 项（#1425（T3）：topbar 区退役）─────────────
{
  const shape = (x) => JSON.stringify({ header: x.header.shape, footer: x.footer.shape, topbar: x.topbar });
  // 🔴 #1425（T3）—— topbar 那一键必须**不在**返回值里（undefined）：退役的区又被解析出来 = 有人把它接回来了。
  const want = JSON.stringify({ header: DEFAULT_HEADER, footer: DEFAULT_FOOTER, topbar: undefined });
  const r = resolve({});
  const r2 = resolve(undefined);
  if (shape(r) === want && shape(r2) === want && r.notes.length === 0) {
    ok(`没换装(传 {} 或 undefined)⟹ ${DEFAULT_HEADER} / ${DEFAULT_FOOTER}，没有 topbar 键，notes 为空`);
  } else {
    bad(`没换装时的结论变了:{} ⟹ ${shape(r)} · undefined ⟹ ${shape(r2)},期望 ${want}`);
  }
}

// ── ⑦ 清单的唯一出处是 manifest：`shapesOf()` 逐项等于 `blocks/<块>.json` 的 shapes ────────────
//    #1353 —— 这一格盯的是本票那条改动本身（三张写死的表退役）。再写一张表出来，这里当场红。
{
  const { loadManifests } = require('./lib/block-manifest.js');
  const ms = loadManifests();
  const problems = [];
  for (const [region, block] of Object.entries(REGION_BLOCK)) {
    const fromManifest = (ms.get(block) || { shapes: [] }).shapes.map((s) => s.name);
    if (JSON.stringify(shapesOf(block)) !== JSON.stringify(fromManifest)) {
      problems.push(`${region}/${block}: shapesOf ${JSON.stringify(shapesOf(block))} ≠ manifest ${JSON.stringify(fromManifest)}`);
    }
  }
  if (problems.length === 0) {
    ok(`两个区的形态清单逐项等于它们各自 manifest 的 shapes（${Object.values(REGION_BLOCK).join(' / ')}）`);
  } else problems.forEach(bad);
}

// ── ⑧ 候选形态不许被这三个区挑中，点名也退回默认（#1384）──────────────────────────────────────
//
// 🔴 **为什么这一格在这个文件里**：Region 的形态既不走 `theme-pipeline/shape-sheet.js` 的
//    `shapeSheetFor`（那是 30 个内容块的选择单），也不走 `sync-config.js` 的 `shapeForBlock`
//    （那只管页面 JSON 里的块）—— 它们由本文件的 `regionsForPool`（生成池成员时挑）和
//    `resolveRegionShapes`（构建时用）各自挑。#1384 那两处堵法对这三个区按构造一个字都不说。
//
// 🔴 **臂跑在一棵【复制出来的树】上**，盘上的 `blocks/` 一个字节不动：这一格要的是「某个形态是候选」
//    这个状态，而今天真树上一个候选都没有（那正是 #1384 交付时的状态）。`region-layout.js` 只
//    require fs / path，且按 `__dirname/../blocks` 找 manifest ⟹ 把它和 blocks/ 一起复制到临时目录，
//    改临时目录里那一份，再 require 那一份，量到的就是这段代码本身。
// 🔴 **先拿未改动的副本证明这棵树立得起来**，否则下面三个读数可能全是「副本自己坏了」。
{
  const os = require('os');
  const mkTree = (mutate) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'region-cand-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.join(__dirname, 'region-layout.js'), path.join(root, 'scripts', 'region-layout.js'));
    // #1387 —— 一个块一个文件夹，所以整棵拷（形态住在子文件夹里，逐文件拷会把它们全丢掉）。
    fs.cpSync(path.join(__dirname, '..', 'blocks'), path.join(root, 'blocks'), { recursive: true });
    if (mutate) mutate(root);
    // 🔴 只 disable `global-require` 这一条 —— `import/no-dynamic-require` 需要 eslint-plugin-import，
    //    而 `scripts/.eslintrc.json` 没装它 ⟹ 写在 disable 注释里会让 `npm run lint:scripts` 当场红
    //    （「Definition for rule … was not found」）。实测：origin/main 上那条命令 rc=0，带上它 rc=1。
    // eslint-disable-next-line global-require
    return require(path.join(root, 'scripts', 'region-layout.js'));
  };
  // #1387 —— 「这个形态是候选」写在 `blocks/<块>/<形态>/shape.md` 的 frontmatter 里。
  const markCandidate = (root, block, names) => {
    for (const name of names) {
      const md = path.join(root, 'blocks', block, name, 'shape.md');
      const src = fs.readFileSync(md, 'utf-8');
      fs.writeFileSync(md, src.replace(/^---\n/, '---\ncandidate: true\n'));
    }
  };

  // 正向臂：未改动的副本，`pickableShapesOf` 逐项等于 `shapesOf`（今天真树上 0 个候选）
  const clean = mkTree(null);
  const cleanOK = JSON.stringify(clean.pickableShapesOf('header')) === JSON.stringify(HEADER_SHAPES);
  if (cleanOK) ok(`⑧ 正向臂：未改动的副本立得起来，pickableShapesOf('header') 逐项等于 shapesOf（${HEADER_SHAPES.join(' / ')}）`);
  else bad(`⑧ 正向臂对不上：副本读到 ${JSON.stringify(clean.pickableShapesOf('header'))}，真树是 ${JSON.stringify(HEADER_SHAPES)} —— 下面三个读数不说明任何事`);

  // 🔴 挑不中：把 HEADER_SHAPES[1] 标成候选 ⟹ 它从可挑清单里消失，而且 regionsForPool 在【每一个位子】
  //    上都挑不到它。只问一个 index 的话，轮换恰好没轮到它时这一格会假绿。
  const victim = HEADER_SHAPES[1];
  if (!victim) die('⑧ header 只有一个形态 —— 这一格没有可标成候选的对象');
  const one = mkTree((root) => markCandidate(root, 'header', [victim]));
  const pickable = one.pickableShapesOf('header');
  const everPicked = [];
  for (let i = 0; i < HEADER_SHAPES.length * 4; i += 1) {
    everPicked.push(one.regionsForPool(i, '', {}).header);
  }
  if (!pickable.includes(victim) && !everPicked.includes(victim)) {
    ok(`⑧ 把 header 的 "${victim}" 标成候选 ⟹ 可挑清单变成 ${pickable.join(' / ')}，`
      + `而且 ${HEADER_SHAPES.length * 4} 个位子逐个挑过去一次都没挑到它`);
  } else {
    bad(`⑧ 候选仍被挑中：可挑清单 ${JSON.stringify(pickable)}，${HEADER_SHAPES.length * 4} 个位子挑到的是 `
      + `${JSON.stringify([...new Set(everPicked)])} —— 候选不许上真站`);
  }

  // 🔴 点名也不行：选择单里手写一个候选（池子里那份单子是可以被手改的）⟹ 退回默认 + notes 说是候选
  const named = one.resolveRegionShapes({ header: victim });
  const saidCandidate = (named.notes || []).some((n) => n.includes(victim) && n.includes('候选'));
  if (named.header.shape === DEFAULT_HEADER && saidCandidate) {
    ok(`⑧ 选择单点名候选 "${victim}" ⟹ 退回默认 ${DEFAULT_HEADER}，notes 说明它是候选：${(named.notes || []).join(' | ')}`);
  } else {
    bad(`⑧ 点名候选之后读到 shape=${named.header.shape}（应当是 ${DEFAULT_HEADER}）· notes=${JSON.stringify(named.notes)}`);
  }

  // 🔴 全是候选 ⟹ 抛，不悄悄回一个候选或者空串。按构造走不到（checkManifestShape 不许 shapes[0] 是候选），
  //    所以这一格量的是「那条校验被放宽的那天，这里会喊而不是静默」。
  const all = mkTree((root) => markCandidate(root, 'header', HEADER_SHAPES));
  let threw = null;
  try { all.pickableShapesOf('header'); } catch (e) { threw = e.message; }
  if (threw && threw.includes('candidate')) ok(`⑧ header 的形态全标成候选 ⟹ 当场抛：${threw.slice(0, 80)}…`);
  else bad(`⑧ 全是候选时没抛（读到 ${threw === null ? '没抛' : threw}）—— 失败方向必须是喊，不是悄悄挑一个`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
