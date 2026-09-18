#!/usr/bin/env node
/**
 * shape-sheet.test.js — 候选的选择单：齐全、合法、可复算（#1342）。
 *
 * 跑法:  node scripts/theme-pipeline/shape-sheet.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═══════════════════════════════════════════════════════════
 * 这四条的失败方向**全部是绿的**，这是它们落在这里、而不是只在交付那天跑一遍的理由：
 *   · 名字挑到清单外   → 第六道闸**不问名字**（它只对键；那半句如实写在 `gates.js` 的 gateShapes
 *                        上面），候选照样过闸进池；进池之后 `sync-config.js` 的 `shapeForBlock`
 *                        落回默认形态，页面照样打开
 *   · 选择单塌成常量   → 池子里每套主题的选择单一模一样，**没有任何一格会红**（每一份都合法、
 *                        齐全、可复算）。第一版就撞了这一格，见下面第 ③ 格
 *   · 同一对 (i, seed) 出两份 → 流水线跑两次拿到两套不同的主题，而两次都「全绿」
 *   · 键多了 / 少了    → 这一条第六道闸会说话，但它说话的时机是**跑流水线时**；这里提前到
 *                        `npm run test:scripts`（它按文件名发现这个文件，不是清单）
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let shapeSheetFor; let shapeSheetPath; let generateCandidates; let loadManifests;
try {
  ({ shapeSheetFor, shapeSheetPath } = require(path.join(DIR, 'shape-sheet.js')));
  ({ generateCandidates } = require(path.join(DIR, 'generate.js')));
  ({ loadManifests } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js')));
} catch (e) {
  die(`加载不了被测的东西: ${e.message}`);
}
for (const [name, v] of Object.entries({ shapeSheetFor, shapeSheetPath, generateCandidates, loadManifests })) {
  if (!v) die(`没导出 ${name} —— 这不是「测试失败」，是被测的东西不在`);
}

// 分母现读，不写死：#1333 把块从 31 加到 32，#1340 正要往清单里加 27 种形态。
const byType = loadManifests();
const allBlocks = [...byType.keys()].sort();
const namesOf = (t) => byType.get(t).shapes.map((sh) => sh.name);
if (!allBlocks.length) die('blocks/ 下一份 manifest 都没有 —— 分母塌了，不许当成过');

// ── ① 键集合 == `blocks/<块>/manifest.json` 的集合，不多不少 ───────────────────────────────────────────────
//
// 这跟第六道闸（`gates.js` 的 gateShapes）问的是同一件事，判据也是同一个分母 —— 两边都从
// `blocks/` 现数 —— 但**读法不同**，而这是有意的：闸数的是目录里的文件名（`gates.js` 的 gateShapes
// 里那句 `fs.readdirSync(blocksDir)`），这一格数的是 `loadManifests()` 的键（每份 manifest 自己的
// `type`，而 loadManifests 断言过 `type` 必须等于文件名）。抄同一行才是同盲：两条路各自出错时读到
// 的是不同的数。
// 这一格在这里的另一个意义是**时机**：闸在跑流水线时说话，这一格在 `npm run test:scripts` 时说话，
// 而后者是 CI 每次动 `templates/nextjs/**` 都跑的那条命令（`.github/workflows/ci-cd.yml` 的
// `template-scripts` job；路径过滤在同一份文件的 `filters:` 里那条 `templates:`）。
{
  const sheet = shapeSheetFor(0, 7);
  const keys = Object.keys(sheet).sort();
  const missing = allBlocks.filter((b) => !keys.includes(b));
  const extra = keys.filter((k) => !allBlocks.includes(k));
  if (!missing.length && !extra.length) {
    ok(`① 选择单的键 == blocks/ 的 ${allBlocks.length} 个块，一个不多一个不少`);
  } else {
    bad(`① 键对不上：缺 ${missing.length}（${missing.join(' · ')}）· 多 ${extra.length}（${extra.join(' · ')}）`);
  }
}

// ── ② 每个名字都在**该块** manifest 的 `shapes` 清单里 ────────────────────────────────────────
//
// 🔴 按集合逐块判，不按数目：数目对得上而名字错位（A 块拿到 B 块的形态名）是这一维真正的失败形状，
//    而它在「32 个名字都合法」这种数目式判据下是绿的。
// 🔴 判断只写一处（`illegal()`），下面那个反向臂喂给它的是**编造的选择单**，不是在旁边把同一个
//    表达式再写一遍 —— 那种对照把真判断整个换掉照样打绿（`pool.test.js` ⑪ 为这条付过账）。
const illegal = (sheet) => allBlocks
  .filter((b) => !namesOf(b).includes(sheet[b]))
  .map((b) => `${b}=${JSON.stringify(sheet[b])}（清单：${namesOf(b).join(' / ')}）`);
{
  const bogus = [];
  for (let i = 0; i < 100; i += 1) {
    for (const seed of [7, 11]) bogus.push(...illegal(shapeSheetFor(i, seed)).map((x) => `i=${i} seed=${seed} ${x}`));
  }
  if (!bogus.length) {
    ok(`② i=0..99 × seed=7/11 共 ${200 * allBlocks.length} 对 (套, 块)：每个形态名都在该块 manifest 的清单里`);
  } else {
    bad(`② 有 ${bogus.length} 个名字不在对应块的清单里：${bogus.slice(0, 5).join(' · ')}`);
  }
  const b0 = allBlocks[0];
  const caught = illegal({ ...shapeSheetFor(0, 7), [b0]: 'qa-not-a-real-shape' });
  if (caught.length === 1 && caught[0].includes(`${b0}=`) && caught[0].includes('qa-not-a-real-shape')) {
    ok(`② 反向臂：把 ${b0} 换成一个清单外的名字，同一段判断当场只点名它`);
  } else {
    bad(`② 反向臂对不上：点名 ${caught.length} 条（${caught.join(' · ')}）—— 应当正好一条、且点名 ${b0}`);
  }
}

// ── ③ 选择单不许塌成一张常量表 ────────────────────────────────────────────────────────────────
//
// 🔴 **这一格是量出来的，不是想出来的。** 第一版的挑法是 `(i + k) % n`（k = 块在名单里的下标），
//    第二版是裸 FNV-1a 取模 —— 两版在 97 套（池子最后一次满员时的成员数，`8e35fecc`）上跑出来的读数**都是
//    「不同的选择单 2 份」**，而两版塌的理由不同：
//      · `(i + k) % n`：19 个块有 2 种形态、13 个只有 1 种 ⟹ 每块周期 2，整份单子周期也是 2
//      · 裸 FNV-1a：乘数 `0x01000193` 是奇数 ⟹ 乘法不改最低位，XOR 一个字节只按那字节最低位翻它
//        ⟹ `hash % 2` = 「全部输入字节最低位的异或」，`i` 动一下就把**每个块**一起翻过去
//    两版都合法、都齐全、都可复算 —— 也就是说除了这一格，**没有任何一格会红**。
// 🔴 门槛写死成 90，不从当前实现现算：从被测对象自己算出来的下限测的是自洽，不是回归。
//    今天的读数是 100/100（雪崩版），两个坏版本是 2 —— 90 这条线把它们分得开，而且给
//    #1340 那类「往清单里加形态」的改动留足余量（加形态只会让这个数更大，不会更小）。
{
  const N = 100;
  const seen = new Set();
  for (let i = 0; i < N; i += 1) seen.add(allBlocks.map((b) => shapeSheetFor(i, 7)[b]).join('|'));
  const FLOOR = 90;
  if (seen.size >= FLOOR) {
    ok(`③ i=0..${N - 1} 共 ${N} 套，互不相同的选择单 ${seen.size} 份（门槛 ${FLOOR}；`
      + '`(i+k)%n` 和裸 FNV-1a 两版在这一格上的读数都是 2）');
  } else {
    bad(`③ ${N} 套里只有 ${seen.size} 份互不相同的选择单（门槛 ${FLOOR}）—— 挑法塌了，`
      + '池子里每套主题穿的是同几份单子；见本格上面那两种塌法');
  }
  // 换一个 i 至少一个块不同（AC2 的后一半）。逐对报最小值，不只报「存在一对不同」。
  let minDiff = allBlocks.length;
  let where = '';
  for (let i = 0; i + 1 < N; i += 1) {
    const a = shapeSheetFor(i, 7); const b = shapeSheetFor(i + 1, 7);
    const d = allBlocks.filter((t) => a[t] !== b[t]).length;
    if (d < minDiff) { minDiff = d; where = `i=${i}↔${i + 1}`; }
  }
  if (minDiff >= 1) ok(`③ 相邻两套至少差 1 个块：最少的一对是 ${where}，差 ${minDiff} 个块`);
  else bad(`③ 有相邻两套的选择单逐块相同（${where}）—— 换一个 i 拿到的是同一份单子`);
}

// ── ④ 同一对 (i, seed) 必出同一份选择单，逐字节 ───────────────────────────────────────────────
//
// 🔴 比的是**落到盘上的字节**，不是两个对象深比：候选目录里那份 `<id>.shapes.json` 才是
//    `promote.js`（另一个进程）读到的东西，而「键序不定 ⟹ 同一份内容两种字节」这种分叉在对象
//    深比下是绿的。所以这一格驱动的是 `generateCandidates(..., { outDir })` 真写文件那条路。
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-sheet-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-sheet-b-'));
  try {
    generateCandidates(3, { seed: 7, outDir: tmpA });
    generateCandidates(3, { seed: 7, outDir: tmpB });
    const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
    const diffs = [];
    for (let i = 1; i <= 3; i += 1) {
      const id = `gen-07-${i}`;
      const a = shapeSheetPath(tmpA, id); const b = shapeSheetPath(tmpB, id);
      if (!fs.existsSync(a) || !fs.existsSync(b)) { diffs.push(`${id}: 没落盘`); continue; }
      if (md5(a) !== md5(b)) diffs.push(`${id}: ${md5(a)} ≠ ${md5(b)}`);
    }
    if (!diffs.length) {
      ok('④ 同一对 (i, seed) 两次生成，三套候选的 `<id>.shapes.json` 逐字节相同（md5 逐份相等）');
    } else {
      bad(`④ 同一对 (i, seed) 两次生成出了不同的字节：${diffs.join(' · ')}`);
    }
    // 换 seed 是另一份单子 —— 这一半证明 seed 真的参与，不是一个被忽略的入参。
    const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-sheet-c-'));
    try {
      generateCandidates(1, { seed: 11, outDir: tmpC });
      const a = JSON.parse(fs.readFileSync(shapeSheetPath(tmpA, 'gen-07-1'), 'utf-8'));
      const c = JSON.parse(fs.readFileSync(shapeSheetPath(tmpC, 'gen-11-1'), 'utf-8'));
      const d = allBlocks.filter((t) => a[t] !== c[t]);
      if (d.length) ok(`④ 换 seed（7 → 11，同一个 i）：${d.length} 个块拿到不同的形态名 ⟹ seed 真的参与`);
      else bad('④ 换 seed 之后选择单逐块相同 —— seed 这个入参没被用上，而函数签名说它会被用上');
    } finally { fs.rmSync(tmpC, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
