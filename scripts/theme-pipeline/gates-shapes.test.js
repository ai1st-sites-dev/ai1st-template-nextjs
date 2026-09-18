#!/usr/bin/env node
/**
 * gates-shapes.test.js — 第六道闸（⑥ 选择单）的四条性质（#1338）。
 *
 *   跑法:  node scripts/theme-pipeline/gates-shapes.test.js
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这道闸要自带测试 ═════════════════════════════════════════════════════════════════════
 * `gates.js` 今天导出 11 个函数，而 `generate.test.js:19` 只 require 了 `gateSimilarity`、
 * `skeleton-distance.test.js` 只驱动 `gateSkeleton` —— 新加的判据**不会自动有覆盖**。这道闸唯一
 * 能出的错是一个方向：它对每一套候选都说「过」，而报告上看不出跟「真的没问题」有什么区别。
 * 所以下面三条是**两向**的：两条证明它会拒（并且点名拒的是谁），一条证明它不是恒红
 * （池里今天那两套真主题都过）。第四条守尺子本身：分母读不到时它必须是「没量成」，不是「通过」。
 *
 * 🔴 喂进去的是**池成员**（`theme-pool.json` 的两套）而不是手打的字典：这道闸将来要判的就是
 *    「候选长得像不像一个能进池的成员」，拿真成员当正向对照，才证明得了它不是恒红。
 *    造缺块 / 多键那两条时改的是**内存里的副本**，盘上的 `theme-pool.json` 一个字节不动。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let gates; let pool; let allBlocks;
try {
  gates = require(path.join(DIR, 'gates.js'));
  pool = require(path.join(NEXT, 'scripts', 'theme-pool.json'));
  // #1387 —— 一个块一个文件夹：块名 = 文件夹名。
  allBlocks = fs.readdirSync(path.join(NEXT, 'blocks'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
} catch (e) {
  die(`读不到 gates.js / theme-pool.json / blocks/：${e.message} —— 什么都没量成`);
}
if (typeof gates.gateShapes !== 'function') die('gates.js 没有导出 gateShapes —— 这道闸不在了');
if (!allBlocks.length) die('blocks/ 底下一份 manifest 都没有 —— 分母塌了，不许当成过');
const ids = Object.keys(pool).sort();
if (ids.length < 1) die('theme-pool.json 是空的 —— 正向对照没有对象');

// 候选长什么样：这道闸只读 `shapes` 那一个键（其余键是别的闸的事）。
const candidateOf = (id, shapes) => ({ id, shapes });

console.log(`\n── ⑥ 选择单（#1338）：${ids.length} 套池成员 · ${allBlocks.length} 个块`);

// ── 正向：池里今天那两套都过（证明这条判据不是恒红）────────────────────────────────────────────
{
  const bads = ids.filter((id) => !gates.gateShapes(candidateOf(id, pool[id].shapes)).pass);
  if (bads.length) {
    bads.forEach((id) => console.log(`     ${id}: ${gates.gateShapes(candidateOf(id, pool[id].shapes)).problems.join(' / ')}`));
    bad(`池里 ${bads.length}/${ids.length} 套被这道闸拒掉（${bads.join(' · ')}）—— 它们是今天在用的`
      + '主题，全被拒说明这条判据恒红，而不是候选有问题');
  } else {
    ok(`正向：池里 ${ids.length} 套（${ids.join(' · ')}）逐套过这道闸 —— ${allBlocks.length} 个块`
      + '逐块有画法名，没有多余的键');
  }
}

// ── 反向 A：缺一个块 ⟹ 拒，并且点名缺的是谁 ───────────────────────────────────────────────────
{
  const id = ids[0];
  const missing = allBlocks[0];
  const shapes = { ...pool[id].shapes };
  delete shapes[missing];
  const r = gates.gateShapes(candidateOf(id, shapes));
  const text = r.problems.join(' / ');
  if (!r.pass && !r.instrument && text.includes(missing) && text.includes(`缺 1/${allBlocks.length}`)) {
    ok(`反向 A（缺块）：把 ${id} 的 ${missing} 整个删掉 ⟹ 拒，报文点名它（${text}）`);
  } else {
    bad(`反向 A 对不上：pass=${r.pass} instrument=${!!r.instrument} 报文「${text}」`
      + ` —— 应当拒，且点名 ${missing}`);
  }
}

// ── 反向 B：多一个 blocks/ 里没有的键 ⟹ 拒，并且点名多的是谁 ──────────────────────────────────
{
  const id = ids[ids.length - 1];
  const shapes = { ...pool[id].shapes, 'not-a-block': 'whatever' };
  const r = gates.gateShapes(candidateOf(id, shapes));
  const text = r.problems.join(' / ');
  if (!r.pass && !r.instrument && text.includes('not-a-block') && text.includes('多 1 个')) {
    ok(`反向 B（多键）：往 ${id} 的选择单塞一个 blocks/ 里没有的键 not-a-block ⟹ 拒，报文点名它（${text}）`);
  } else {
    bad(`反向 B 对不上：pass=${r.pass} instrument=${!!r.instrument} 报文「${text}」`
      + ' —— 应当拒，且点名 not-a-block');
  }
}

// ── 尺子本身：分母读不到 ⟹「没量成」，不是「通过」──────────────────────────────────────────────
//
// 🔴 这一条跟上面三条不是同一件事：上面三条问「它判得对不对」，这一条问「它没东西可量的时候
//    往哪边倒」。`jammed` 的 `pass` 也是 false，但另挂一面 `instrument` 旗子 —— 报告据它说真因
//    （这道闸没量成 ≠ 这套候选不合格）。倒错方向的后果是：分母塌了的那天，每一套候选都「过」。
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 't1338-empty-blocks-'));
  try {
    const gone = path.join(empty, 'not-here');
    const r1 = gates.gateShapes(candidateOf(ids[0], pool[ids[0]].shapes), { blocksDir: gone });
    const r2 = gates.gateShapes(candidateOf(ids[0], pool[ids[0]].shapes), { blocksDir: empty });
    if (r1.pass === false && r1.instrument && r2.pass === false && r2.instrument) {
      ok('尺子：blocks/ 读不到（目录不在）和分母是 0（目录空的）两种，都判成「没量成」'
        + '（pass=false + instrument），不是「通过」');
    } else {
      bad(`尺子对不上：目录不在 → pass=${r1.pass}/instrument=${!!r1.instrument}、`
        + `目录空的 → pass=${r2.pass}/instrument=${!!r2.instrument} —— 两种都应当是 false + instrument`);
    }
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
}

console.log(`\n${fail ? '🔴' : '✅'} ⑥ 选择单：${pass} 过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
