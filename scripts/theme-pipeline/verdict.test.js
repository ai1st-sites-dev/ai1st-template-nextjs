#!/usr/bin/env node
/**
 * verdict.test.js — 闸的裁定怎么交到写池那一步（#1182）。
 *
 * 跑法:  node scripts/theme-pipeline/verdict.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═══════════════════════════════════════════════════════════
 * #1182 之前，「哪些候选过了闸」算完就留在 run.js 的进程里没了，而写池那一步不给 `--accepted`
 * 就把候选目录里的全部收进池。那个洞的失败方向是静默的，而且是最坏的那一侧：
 *   · 漏传一次名单     → 五道闸对写池那一步全部不承重，而**报告里照样写着某一套被拒了**
 *   · 名单里只给 id    → 位子按「过滤之后的位置」发，被拒几套就让后面每一套的 pool id 和行业组
 *                        一起挪，于是闸量过的那一套和写进池的那一套不是同一套（README 里把这件事
 *                        记成「另一张票的取舍」，#1182 就是那张票）
 *   · 名单落不了地     → 退回「全收」的话，那正是本票要治的那个状态
 * 三条的失败方向都是绿的，所以它们落在这里：`npm run test:scripts` 按文件名发现它，CI 的
 * template-scripts 那个 job 每次动 templates/nextjs 都跑。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = __dirname;

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let promote; let poolSlots;
try {
  promote = require(path.join(DIR, 'promote.js'));
  ({ poolSlots } = require(path.join(DIR, 'industry-sectors.js')));
} catch (e) {
  die(`加载不了被测的东西: ${e.message}`);
}
const {
  buildPool, readVerdict, writeVerdict, verdictPath, VERDICT_FILE,
} = promote;
for (const [name, v] of Object.entries({
  buildPool, readVerdict, writeVerdict, verdictPath, VERDICT_FILE,
})) {
  if (!v) die(`promote.js 没导出 ${name} —— 这不是「测试失败」，是被测的东西不在`);
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-test-'));

// 一套最小的候选：`buildPool` 只读 tokens.colors / tokens.settings / layout。
const cand = (id, primary) => ({
  id,
  sheetPath: '/dev/null',
  tokens: { colors: { primary: { 500: primary }, accent: { 500: '#888888' } }, settings: {} },
  layout: { hero: ['left'] },
});

// ── ① 三种返回必须分得开 ──────────────────────────────────────────────────────────────────────
//
// 🔴 这一条是整份交付的立足点。「文件不在」跟「文件在但名单没落地」如果读成同一件事，那么
//    「名单落不了地就不写池」这条纪律会把手工挑候选那条路一起掐死（那条路的样子就是「文件不在」）。
console.log('\n── ① readVerdict 的三种返回');
{
  const d = tmp();
  const none = readVerdict(d);
  if (none === null) ok('目录里没有那份文件 ⟹ null（= 没跑过流水线，手工那条路）');
  else bad(`没有文件时应当是 null，实得 ${JSON.stringify(none)}`);

  fs.writeFileSync(verdictPath(d), '{ 这不是 json');
  const broken = readVerdict(d);
  if (broken && broken.broken) ok(`解析不了 ⟹ { broken } —— ${broken.broken.slice(0, 40)}…`);
  else bad(`解析不了时应当返回 broken，实得 ${JSON.stringify(broken)}`);

  writeVerdict(d, { complete: false, why: '开跑了还没跑完' });
  const sentinel = readVerdict(d);
  if (sentinel && sentinel.broken) ok('complete:false 的哨兵 ⟹ { broken }（不是 null，两者不许混）');
  else bad(`哨兵应当返回 broken，实得 ${JSON.stringify(sentinel)}`);

  writeVerdict(d, { complete: true, accepted: [{ candidate: 'a', slot: 0 }] });
  const good = readVerdict(d);
  if (good && !good.broken && good.accepted.length === 1) ok('complete:true + accepted ⟹ 可用');
  else bad(`可用的那份读错了：${JSON.stringify(good)}`);

  // 形状要真查，不许只看 complete
  writeVerdict(d, { complete: true, accepted: [{ candidate: 'a' }] });
  const noSlot = readVerdict(d);
  if (noSlot && noSlot.broken) ok('accepted 里少了 slot ⟹ { broken }（形状是真查的，不是只看 complete）');
  else bad(`少 slot 时应当 broken，实得 ${JSON.stringify(noSlot)}`);

  writeVerdict(d, { complete: true, accepted: 'not-an-array' });
  const notArr = readVerdict(d);
  if (notArr && notArr.broken) ok('accepted 不是数组 ⟹ { broken }');
  else bad(`accepted 不是数组时应当 broken，实得 ${JSON.stringify(notArr)}`);
  fs.rmSync(d, { recursive: true, force: true });
}

// ── ② 位子必须跟着名单走，否则闸量过的那一套和写进池的那一套不是同一套 ────────────────────────
//
// 🔴 判据是**两种口径给出的 id 不同**，而这一格的判别力靠「被拒的那一套排在中间」。排在最后时
//    两种口径给出同一套 id（后面没有候选要往前挪）—— 所以下面第三格是这一格的分母自检：它证明
//    这个测试不是靠夹具碰巧才红的。
console.log('\n── ② 位子跟着名单走（被拒的排在中间）');
{
  const cands = [cand('c1', '#2244cc'), cand('c2', '#cc2244'), cand('c3', '#22cc44')];
  const accepted = ['c1', 'c3'];          // c2 被闸拒了
  const slotOf = { c1: 0, c3: 2 };        // 闸量它们时用的位子
  const withSlot = buildPool(cands, { accepted, slotOf });
  const noSlot = buildPool(cands, { accepted });
  const idsW = Object.keys(withSlot.pool).join(' ');
  const idsN = Object.keys(noSlot.pool).join(' ');
  if (idsW !== idsN) {
    ok(`两种口径确实给出两套 id：带位子 [${idsW}] · 只给名单 [${idsN}]`);
  } else {
    bad(`两种口径给出同一套 id（${idsW}）—— 这一格失去判别力了，先查夹具里被拒的那一套排在哪`);
  }
  const slots = poolSlots();
  const want = promote.toPoolEntry(cands[2], slots[2]).id;
  if (withSlot.pool[want]) ok(`c3 拿到的是闸量它时那个位子的 id（${want}，位子 2）`);
  else bad(`c3 应当拿到 ${want}，实得 ${idsW}`);
  const sectorW = withSlot.map.find((m) => m.candidate === 'c3').sector;
  const sectorN = noSlot.map.find((m) => m.candidate === 'c3').sector;
  if (sectorW !== sectorN) ok(`挪的不只是 id，行业组也跟着挪（${sectorW} vs ${sectorN}）`);
  else ok(`行业组这一维本次相同（${sectorW}）—— 位子 1 与 2 落在同一组里，id 那一维仍然不同`);
}

// ── ③ ②那一格的分母自检：被拒的排在最后时，两种口径本该相同 ───────────────────────────────────
//
// 🔴 没有这一格，②只能说「它们不同」，说不出「它是因为位子挪了才不同」。
console.log('\n── ③ 分母自检：被拒的排在最后 ⟹ 两种口径相同');
{
  const cands = [cand('c1', '#2244cc'), cand('c2', '#cc2244'), cand('c3', '#22cc44')];
  const accepted = ['c1', 'c2'];          // c3 被拒，排在最后
  const withSlot = buildPool(cands, { accepted, slotOf: { c1: 0, c2: 1 } });
  const noSlot = buildPool(cands, { accepted });
  if (Object.keys(withSlot.pool).join(' ') === Object.keys(noSlot.pool).join(' ')) {
    ok(`被拒的排在最后 ⟹ 两种口径同一套 id（${Object.keys(withSlot.pool).join(' ')}）`);
  } else {
    bad('被拒的排在最后时两种口径居然不同 —— 那 ②那一格读到的「不同」可能不是位子挪造成的');
  }
}

// ── ④ 不给 slotOf 时 buildPool 一个字节都没变（AC4 的那一半） ────────────────────────────────
console.log('\n── ④ 不给 slotOf ⟹ 按过滤之后的位置发位子，跟 #1182 之前一样');
{
  const cands = [cand('c1', '#2244cc'), cand('c2', '#cc2244'), cand('c3', '#22cc44')];
  const slots = poolSlots();
  const all = buildPool(cands, {});
  const wantAll = cands.map((c, i) => promote.toPoolEntry(c, slots[i]).id).join(' ');
  if (Object.keys(all.pool).join(' ') === wantAll) ok(`全收（不传 accepted）⟹ ${wantAll}`);
  else bad(`全收那条路的 id 变了：想要 ${wantAll}，实得 ${Object.keys(all.pool).join(' ')}`);

  const sub = buildPool(cands, { accepted: ['c2', 'c3'] });
  const wantSub = [promote.toPoolEntry(cands[1], slots[0]).id, promote.toPoolEntry(cands[2], slots[1]).id].join(' ');
  if (Object.keys(sub.pool).join(' ') === wantSub) ok(`只给 id 名单 ⟹ 位子从 0 开始发（${wantSub}）`);
  else bad(`只给名单那条路变了：想要 ${wantSub}，实得 ${Object.keys(sub.pool).join(' ')}`);
}

// ── ⑤ 位子下标越界要当场炸，不许兜 ────────────────────────────────────────────────────────────
console.log('\n── ⑤ 位子下标越界');
{
  const slots = poolSlots();
  let threw = null;
  try {
    buildPool([cand('c1', '#2244cc')], { accepted: ['c1'], slotOf: { c1: slots.length } });
  } catch (e) { threw = e.message; }
  if (threw && /位子/.test(threw)) ok(`越界当场抛：${threw.slice(0, 50)}…`);
  else bad(`越界应当抛，实得 ${threw === null ? '没抛' : threw}`);
}

// ── ⑥ 那个文件名只有一份定义 ──────────────────────────────────────────────────────────────────
//
// 🔴 run.js 和 promote.js 是两个进程，靠这个文件名对上。两边各写一份字面量的话，改一边就静默断链
//    —— 而断链之后 promote.js 读到「文件不在」= 手工那条路 = 全收，正是本票要治的那个状态。
console.log('\n── ⑥ 文件名只有一份定义');
{
  const runSrc = fs.readFileSync(path.join(DIR, 'run.js'), 'utf-8');
  const lit = runSrc.match(/['"]pipeline-verdict\.json['"]/g) || [];
  if (!lit.length) ok(`run.js 里没有写死这个文件名（它从 promote.js 拿 VERDICT_FILE = ${VERDICT_FILE}）`);
  else bad(`run.js 里写死了这个文件名 ${lit.length} 处 —— 两份定义会静默分叉`);
  if (/writeVerdict/.test(runSrc)) ok('run.js 用的是 promote.js 导出的 writeVerdict');
  else bad('run.js 没在用 writeVerdict —— 裁定不落盘的话写池那一步只能全收');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
