// ══════════════════════════════════════════════════════════════════════════════════════════════════
// shape-sheet.js — 第 i 套候选的**选择单**：每个块一个形态名（#1342）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 一个站在每个块上戴哪个形态，由它穿的那套主题的选择单（`theme-pool.json` 的 `shapes`）决定
// （`themes.js` 的 `shapesFor` → `sync-config.js` 的 `shapeForBlock`）。#1338 给流水线装了第六道闸
// 「选择单不齐的候选不许进池」，而**在这个文件之前生成器一套选择单都不产** ⟹ 从那天起每一轮流水线
// 收 0 套（实测 `run.js --count 1 --seed 7`：`停在【⑥ 选择单】· 选择单缺 32/32 个块`）。
// 这个文件是补上的那一步：候选自己带上选择单。闸的判据一个字节没动。
//
// 🔴 **名单从 `blocks/*.json` 现读，这里不存第二份清单。** 分母（有哪些块）和取值范围（这个块有哪几
//    种形态）都来自 manifest，因为它们是会动的：#1333 加了 `hero-with-form`（31 → 32 个块），#1340
//    正要往清单里加 27 种形态。抄一份下来的失败方向是静默的 —— 新块没进选择单，第六道闸点名的是
//    「缺 1/33」，而看的人会以为是闸错了。
//
// 🔴 **挑法：FNV-1a + 雪崩混合，模这个块的形态数。** 三条路量过（跑在 97 套上 —— 那是池子最后一次
//    满员时的成员数，`git show 8e35fecc:templates/nextjs/scripts/theme-pool.json`，2026-08-24 的 #1174；
//    今天盘上那份是 #1317 重建中的 2 套脚手架，拿它当分母量不出多样性）：
//
//      挑法          97 套里不同的选择单   相邻两套最少差几个块
//      (i + k) % n            2                  19
//      FNV-1a 低位            2                   0        ← 看着"散"，其实全联动
//      FNV-1a + 雪崩         97                   5
//
//    前两条都塌成 **2 份**选择单，而塌的理由不同，两条都值得写下来：
//      · `(i + k) % n`：19 个块有 2 种形态、13 个只有 1 种 ⟹ 每个块的周期是 2，整份选择单的周期
//        也是 2。97 套主题穿的是同两份单子。
//      · **FNV-1a 的低位不是散的**：乘数 `0x01000193` 是奇数 ⟹ 乘法不改变最低位，而 XOR 一个字节
//        只按那个字节的最低位翻转它。于是 `hash % 2` 等于「输入全部字节最低位的异或」—— `i` 变一下
//        就把**每个块**的 parity 一起翻过去。这一格是我自己第一版写的，读数（`不同的选择单 2`）
//        跟写死一张常量表分不开，是量出来才发现的，所以把机理留在这儿。
//    雪崩那两轮（lowbias32）只为把低位搅匀；它不是加密强度，也不需要是。
//
// 🔴 **入参是 `(i, seed)`，同一对必出同一份选择单**（AC2 的第一半）。写成纯函数、不碰时间/随机数/
//    进程状态，是因为这条流水线的每一道闸都要能被同一个输入反复驱动（`generate.js` 文件头第一句）。
//    `seed` 真的参与哈希：同一个 `i` 换个 seed 就是另一份单子。这一点跟当年那个 `layoutNamesFor(i)`
//    （只吃 `i`）不同，理由是版式那一维进了相似度闸③、要的是可预期的周期，而选择单**不进任何一道闸
//    的比较** ⟹ 这里只要多样性，没有周期要维护。
//    📌 #1341（2026-09-16）把内容结构那一维整条退役了，`layoutNamesFor` 连同它写的 `<id>.layout.json`
//    和相似度闸里那一项一起没了 —— 上面那句对照说的是**当年**的情形，留着是因为它解释了为什么这里
//    要吃 `seed`。今天没有第二个「按候选号算出一份表」的函数跟它比。
//
// 🔴 **这个文件不问「这个形态好不好看」，也不问它跟这套主题的版式搭不搭。** 它只保证名字**合法**
//    （在该块 manifest 的清单里）、**齐全**（每个块一个）、**可复算**。好不好看是第四道闸，那道闸是人。
'use strict';

const path = require('path');

// 形态清单的唯一权威是 manifest（#1331），而读 manifest 只有一份实现。`loadManifests` 会顺手把
// 每份 manifest 核一遍（`checkManifestShape`：`shapes` 必须是非空数组、每项的 `name` 必须是非空
// 字符串、在 `public/shapes.css` 里必须有规则）⟹ 这里拿到的清单一定非空，不用再兜一层。
const { loadManifests, BLOCKS_DIR } = require(path.join(__dirname, '..', 'lib', 'block-manifest.js'));

/** FNV-1a 32 位。低位不可直接取模，见文件头那张表 —— 出口一律走 `mix32`。 */
function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (let n = 0; n < s.length; n += 1) {
    h ^= s.charCodeAt(n);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** lowbias32 雪崩：把 FNV 的高位搅进低位，`% n` 才有意义。 */
function mix32(h0) {
  let h = h0 >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** 候选的选择单落盘成 `<id>.shapes.json` —— 路径只算一处（写它的和读它的是两个进程）。 */
const shapeSheetPath = (dir, id) => path.join(dir, `${id}.shapes.json`);

/**
 * 第 `i` 套候选的选择单：`{ <块类型>: <形态名> }`，`blocks/` 里每个块一个键，不多不少。
 *
 * 🔴 键按块类型排序后插入，所以 `JSON.stringify` 出来的字节只由 `(i, seed)` 决定 —— 目录遍历顺序
 *    换了（不同文件系统）也不会让同一对 `(i, seed)` 产出不同的字节。
 */
function shapeSheetFor(i, seed = 7, { blocksDir = BLOCKS_DIR } = {}) {
  const byType = loadManifests(blocksDir);
  const sheet = {};
  for (const type of [...byType.keys()].sort()) {
    // #1384 —— **候选形态不进选择单。** 选择单是「一个真站在这个块上戴哪个形态」的来源
    //（`themes.js` 的 `shapesFor` → `sync-config.js` 的 `shapeForBlock`），而候选的定义就是
    // 「过了全部机器检查、Chris 还没点头」⟹ 它可以进库、进图册、被每一道守卫量，就是不许被挑上站。
    // 🔴 这里是**挑**形态的唯一一处（`generate.js:119` 调的就是这个函数），所以这一条只写在这儿。
    //    池那一端另有一道常设的闸去问「池里有没有哪套主题指向了候选」（`pool.test.js` ⑪ 第四条子句）
    //    —— 那道闸管的是**已经在池里**的选择单，包括不是这个函数产出的那些（手改过的、老版本留下的）。
    const names = byType.get(type).shapes.filter((sh) => sh.candidate !== true).map((sh) => sh.name);
    // 🔴 失败方向是**喊**，不是悄悄回一个候选或者少一个键：少一个键会在第六道闸上被读成
    //    「生成器坏了」，回一个候选则整条堵法作废。按构造走不到这儿（`checkManifestShape` 不许
    //    `shapes[0]` 是候选 ⟹ 每个块至少剩一个非候选），所以它真响的那天说明那条校验被人放宽了。
    if (names.length === 0) {
      throw new Error(`blocks/${type}.json 的形态全是 candidate —— 选择单没得挑。`
        + '默认形态（shapes[0]）按 checkManifestShape 就不许是候选，走到这里说明那条校验被放宽了');
    }
    sheet[type] = names[mix32(fnv1a32(`${seed}:${i}:${type}`)) % names.length];
  }
  return sheet;
}

module.exports = { shapeSheetFor, shapeSheetPath };
