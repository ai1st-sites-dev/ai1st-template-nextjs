#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// promote.js — 一套过了闸的候选，怎么变成池里的一员（#1016 AC6）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-pipeline/promote.js --candidates <目录> --out scripts/theme-pool.json
//   node scripts/theme-pipeline/promote.js --verify [--pool scripts/theme-pool.json]
//
// 🔴 这一步此前**没有 owner**（#1016 AC6 的原话）。候选那边写的是 `layout: { hero: 'with-media-left' }`
//    —— 一个值；池子那边要的是 `supports: { hero: ['with-media-left'] }` —— 一个清单（#1010 改名时
//    连着换了方向：`layout` 是主题替站做选择，`supports` 是主题声明能力）。两种形状同时存在是
//    #1010 有意留的，但**从候选变成池成员的那一刻谁做这个翻译**，在这张票之前没人管。
//    翻漏了不会有任何东西报错：`layoutFor()` 读的是 `supports`，读不到就返回 `{}`，
//    于是那套主题静默地"对每个块都没有意见"，而 `region-layout.js` 拿到 `{}` 就把顶栏页脚落回现状。
//
// 候选自己带不来的三样东西在这里补上，它们是「一套主题」的其余部分（`scripts/themes.js` 文件头
// 列的四件套 + `industries`）：
//   · industries  这身皮是为哪些生意做的 —— 表在 `industry-sectors.js`，判据是 #1016 AC2
//   · label       人看的名字（换主题对话框里显示的就是它）
//   · style       画 logo 时喂给模型的那句形容词（`themeStyle()` → `create-site.js` 的 logo prompt）
//   后两样从候选**自己的产物**里读（primary-500 的色相、settings 的三个数），不重算生成器的公式：
//   两处各算一遍同一件事就会分叉，而分叉是静默的（`palette.js` 文件头记的就是这条）。
'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');
const { poolSlots } = require('./industry-sectors.js');
const { regionsForPool } = require('../region-layout.js');

const POOL_PATH = path.join(NEXT, 'scripts', 'theme-pool.json');
const SHEETS_DIR = path.join(NEXT, 'public', 'themes');

// ── 名字：从这套候选**自己的调色板**读色相，不重算生成器的公式 ────────────────────────────────────
const COLOUR_WORDS = [
  [345, 15, 'crimson'], [15, 45, 'ember'], [45, 70, 'amber'], [70, 100, 'lime'],
  [100, 150, 'fern'], [150, 180, 'jade'], [180, 210, 'teal'], [210, 240, 'azure'],
  [240, 270, 'indigo'], [270, 300, 'violet'], [300, 330, 'magenta'], [330, 345, 'rose'],
];

function hueOf(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

function colourWord(hex) {
  const h = hueOf(hex);
  for (const [lo, hi, word] of COLOUR_WORDS) {
    if (lo < hi ? (h >= lo && h < hi) : (h >= lo || h < hi)) return word;
  }
  return 'slate';
}

/** 手感形容词，从 settings 那三个数读出来 —— 进 label 和 style。 */
function feelOf(settings = {}) {
  const r = Number(settings.radius);
  const shape = r < 8 ? 'angular' : r < 14 ? 'softly rounded' : 'rounded';
  const air = Number(settings.density) < 1 ? 'compact' : 'airy';
  const weight = Number(settings.shadowStrength) < 0.12 ? 'flat' : 'shadowed';
  return { shape, air, weight };
}

/**
 * 一套候选 + 一个池位子 → 一个池成员。
 *
 * 🔴 `layout`（一个值）在这里变成 `supports`（一个清单），而且**不带进 layout 这个键** ——
 *    两个键同时在一套主题上，`layoutSetsOf()`（gates.js）会拿后写的那个盖掉前一个，
 *    `layoutFor()` 只认 `supports`，于是"到底哪个说了算"取决于读的人是谁。AC6 的判据就是这条：
 *    有 supports 的是全部、还留 layout 的一套都没有。
 */
function toPoolEntry(candidate, slot) {
  const tokens = candidate.tokens || {};
  const primary500 = ((tokens.colors || {}).primary || {})['500'];
  const accent500 = ((tokens.colors || {}).accent || {})['500'];
  const word = colourWord(primary500);
  const accentWord = colourWord(accent500);
  const nn = String(slot.index + 1).padStart(2, '0');
  const id = `${word}-${nn}`;
  const feel = feelOf(tokens.settings);
  const sector = slot.sectorEn || slot.sectorKey;

  const supports = {};
  for (const [type, value] of Object.entries(candidate.layout || {})) {
    supports[type] = Array.isArray(value) ? value.slice() : [String(value)];
  }
  // 顶栏 / 页脚的结构（#960）。它们不是 block，由 `region-layout.js` 单独消费；注册表那 30 套每套
  // 都有这两个键，新池不给就等于**结构上比旧池少一维**（换装换掉的是结构，不只是颜色）。
  // 🔴 #1016 r5 —— 顶栏那一维不是纯轮换了:浅底首屏不许配透明浮层。判据和实测读数写在
  //    `region-layout.js` 的 `heroTitleSurvivesHeaderScrim` 上面那段。一句话版:浮层配一层压在
  //    页面最上面 160px 的黑色渐变(浮层的字是白的,不这么浓读不出来),而同一层遮罩压在「浅底 +
  //    深字」的 hero 上会把标题压到 3.8–3.9:1 —— 真机量过 azure-50 与 crimson-30 两套。
  //    没有哪一种字色能同时活过遮罩里和遮罩外两段,所以修法是不产生这个搭配。
  // 🔴 读的是候选【自己那份表的字节】+ 它自己的调色板,不是版式的名字(那条路 `region-layout.js`
  //    文件头 ② 已经写明不成立)。表读不到就当它不是深底 ⟹ 不给浮层,失败方向朝安全那边。
  // 🔴 #1079 —— 这两行的算术搬进 `region-layout.js` 的 `regionsForPool` 了,因为图册那条路
  //    (`run.js` 装候选的时候)要提前拿到**同一个**答案:人审读的标注就是"这套上线后的顶栏"。
  //    两处各算一遍就会漂,而漂出来的差正好是本票要治的那个毛病。
  const sheetCss = candidate.sheetPath && fs.existsSync(candidate.sheetPath)
    ? fs.readFileSync(candidate.sheetPath, 'utf-8') : '';
  const regions = regionsForPool(slot.index, sheetCss, tokens.colors);
  supports.header = [regions.header];
  supports.footer = [regions.footer];

  return {
    id,
    // 🔴 #1016 r5 —— 顶栏那一维被规则挪走时，把原因带出来给调用方打印。它不是池成员的一部分
    //    （不写进 `entry`），只是这一次翻译的一句说明；不带出来的话，「本来该轮到浮层、这套没拿到」
    //    的唯一痕迹就是 supports.header 里的一个字符串，没人看得出它是规则挪的还是轮换本来如此。
    headerMovedBy: regions.headerMovedBy,
    entry: {
      label: `${word[0].toUpperCase()}${word.slice(1)} ${nn} — ${feel.shape} ${feel.air} ${word}`
        + ` with ${accentWord} accent, for ${sector}`,
      colors: tokens.colors,
      fonts: tokens.fonts,
      supports,
      settings: tokens.settings,
      style: `${feel.shape} ${feel.weight} ${word} and ${accentWord}`,
      industries: slot.industries.slice(),
      // 这套皮自己那张表，`public/themes/<sheet>.css`。#1016 之前池成员没有这个键（旧 30 套一张表
      // 都没有，它们的样子全在 colors/fonts/settings 里）；阶段 2 之后一套主题的样子**主要在表里**，
      // 所以池成员必须说得出自己的表是哪一份。
      sheet: id,
    },
  };
}

/** 从磁盘读回一批候选（跟 run.js --candidates 同一个读法）。按编号排序，读数可复算。 */
function readCandidates(dir) {
  const num = (f) => Number((/(\d+)\.css$/.exec(f) || [0, 0])[1]);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
    .sort((a, b) => num(a) - num(b) || a.localeCompare(b))
    .map((f) => {
      const id = path.basename(f, '.css');
      const layoutFile = path.join(dir, `${id}.layout.json`);
      return {
        id,
        sheetPath: path.join(dir, f),
        tokens: JSON.parse(fs.readFileSync(path.join(dir, `${id}.tokens.json`), 'utf-8')),
        layout: fs.existsSync(layoutFile) ? JSON.parse(fs.readFileSync(layoutFile, 'utf-8')) : {},
      };
    });
}

/**
 * 一批候选 → 整个池（对象，键是新 id）。`accepted` 是候选 id 的白名单，不传就全收。
 * `slotOf`（#1182）是「候选 id → 它该占的位子下标」；不传就退回「按过滤之后的位置发位子」。
 */
function buildPool(candidates, { accepted, slotOf } = {}) {
  const slots = poolSlots();
  const take = accepted ? candidates.filter((c) => accepted.includes(c.id)) : candidates;
  if (take.length > slots.length) {
    throw new Error(`池位子只有 ${slots.length} 个，收到 ${take.length} 套候选 —— `
      + '位子表在 industry-sectors.js（16 组 × 5），要放更多套先改那张表，别在这里截断。');
  }
  const pool = {};
  const map = [];
  take.forEach((c, i) => {
    // 🔴 #1182 —— 位子先用「闸量这套候选时用的那一个」。为什么这一维承重，整段写在下面
    //    §闸的裁定怎么交到写池这一步 的第二条 🔴 上。`slotOf` 不给时退回 `i`，那是 #1182 之前
    //    唯一的行为，手工跑 promote.js 挑候选那条路仍然走它。
    const si = slotOf && slotOf[c.id] !== undefined ? slotOf[c.id] : i;
    const slot = slots[si];
    if (!slot) {
      throw new Error(`候选 ${c.id} 要的位子下标是 ${si}，而位子表只有 ${slots.length} 个 —— `
        + '位子表在 industry-sectors.js，别在这里兜。');
    }
    const { id, entry, headerMovedBy } = toPoolEntry(c, slot);
    if (pool[id]) throw new Error(`两套候选算出同一个 id：${id}（${c.id}）`);
    pool[id] = entry;
    map.push({ candidate: c.id, id, sector: slot.sectorKey, headerMovedBy });
  });
  return { pool, map };
}

// ── 闸的裁定怎么交到写池这一步（#1182）─────────────────────────────────────────────────────────────
//
// 🔴 为什么要有这份文件，而不是让跑的人手工传 `--accepted`。五道闸算出「哪些候选过了」之后，这份
//    信息此前就留在 run.js 的进程里没了 —— 而下面 `main` 里写池那一步不给 `--accepted` 就把候选
//    目录里的**全部**收进池。漏传一次，五道闸对写池这一步全部不承重，而**报告里照样写着某一套被
//    拒了**。#1173 AC6 那次「被拒的没进池」是成立的，靠的是跑的人手工挑出 id 写进一个文件。
//
// 🔴 名单里为什么带着位子，不只是候选 id。一套主题的 pool id 和它落在哪个行业组，都由位子下标决定
//    （`toPoolEntry` 里的 `slot.index + 1` 和 `slot.sectorKey`），而两边的下标口径本来就不同：
//    run.js 按「在全部候选里的下标」发位子（`slots[ci]`），`buildPool` 按「在过滤之后的子集里的
//    下标」发。只要有一套被拒，两边就起出两套不同的 id —— README §图上的顶栏/页脚 那一节早就写下
//    了这件事，并把「把位子与接受顺序解耦」记成另一张票的取舍。#1182 就是那张票：在它之前池子是
//    全收的、位子永远不挪，所以这件事碰不到；从它开始，被拒几套直接决定后面每一套的位子。带着位子
//    走 = 闸量过的那一套和写进池的那一套是同一套。
//
// 🔴 失败方向：名单落不了地就不写池，不是退回全收。run.js 开跑前先落一份 `complete:false` 的哨兵，
//    整轮跑完才翻成 `true`。所以盘上这两种情况分得开，而这一点是承重的：
//      · **没有这份文件** = 没跑过流水线（手工挑候选那条路）⟹ 照旧全收
//      · **文件在、但没 complete** = 流水线跑过而名单没落地 ⟹ 拒绝写池
//    要是拿「文件不在」当失败信号，它跟手工那条路在盘上长得一模一样，于是「不写池」这条纪律会把
//    手工那条路一起掐死（AC4 要留的正是它）。
const VERDICT_FILE = 'pipeline-verdict.json';

const verdictPath = (dir) => path.join(dir, VERDICT_FILE);

/** 写裁定。`complete:false` 的那一份是哨兵，run.js 开跑前落。 */
function writeVerdict(dir, verdict) {
  fs.writeFileSync(verdictPath(dir), `${JSON.stringify(verdict, null, 2)}\n`);
}

/**
 * 读裁定。三种返回，调用方必须分开处置：
 *   `null`              这个目录没跑过流水线
 *   `{ broken: '…' }`   跑过，但名单不可用（这一种不许当成「没跑过」）
 *   `{ accepted: [...] }` 可用
 */
function readVerdict(dir) {
  const p = verdictPath(dir);
  if (!fs.existsSync(p)) return null;
  let v;
  try {
    v = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return { broken: `${VERDICT_FILE} 解析不了：${e.message}` };
  }
  if (!v || v.complete !== true) {
    return { broken: `${VERDICT_FILE} 里 complete 不是 true —— 流水线跑过，但它的名单没落地` };
  }
  if (!Array.isArray(v.accepted)) {
    return { broken: `${VERDICT_FILE} 里没有 accepted 这个数组` };
  }
  for (const a of v.accepted) {
    if (!a || typeof a.candidate !== 'string' || !Number.isInteger(a.slot)) {
      return { broken: `${VERDICT_FILE} 的 accepted 里有一条不是 {candidate, slot}：${JSON.stringify(a)}` };
    }
  }
  return v;
}

// ── AC6 的检查：池里每一套都翻过了吗 ───────────────────────────────────────────────────────────────
//
// 🔴 两个方向都要问，因为它们的错法不同：
//   · 少了 supports  ⟹ `layoutFor()` 返回 {}，这套主题静默地对每个块都没有意见
//   · 还留着 layout  ⟹ 两个键同时在，谁说了算取决于读的人（gates.js 读 layout+supports，
//                       sync-config 只读 supports）
function verifyPool(pool) {
  const problems = [];
  const ids = Object.keys(pool || {});
  if (!ids.length) return ['池子是空的 —— 没东西可查，这不是通过'];
  for (const id of ids) {
    const t = pool[id] || {};
    if (t.layout !== undefined) {
      problems.push(`${id}: 还留着 \`layout\` 这个键（${JSON.stringify(t.layout)}）—— `
        + '候选那边的形状没翻成池子这边的 `supports`');
    }
    if (!t.supports || typeof t.supports !== 'object' || !Object.keys(t.supports).length) {
      problems.push(`${id}: 没有 \`supports\` —— layoutFor() 会返回 {}，这套主题对每个块都没有意见`);
      continue;
    }
    for (const [type, forms] of Object.entries(t.supports)) {
      if (!Array.isArray(forms) || !forms.length || forms.some((f) => typeof f !== 'string')) {
        problems.push(`${id}: supports.${type} 不是一个非空的字符串清单（${JSON.stringify(forms)}）`);
      }
    }
  }
  return problems;
}

function main(argv) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };

  if (argv.includes('--verify')) {
    const poolPath = arg('--pool', POOL_PATH);
    const pool = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
    const problems = verifyPool(pool);
    console.log(`池子 ${Object.keys(pool).length} 套 · ${path.relative(NEXT, poolPath)}`);
    if (problems.length) {
      console.error('🔴 AC6 不达标：');
      for (const p of problems) console.error(`   ${p}`);
      process.exit(1);
    }
    const withSupports = Object.values(pool).filter((t) => t.supports && Object.keys(t.supports).length).length;
    const withLayout = Object.values(pool).filter((t) => t.layout !== undefined).length;
    console.log(`✅ 有 supports 的 ${withSupports}/${Object.keys(pool).length} 套 · 还留着 layout 的 ${withLayout} 套`);
    process.exit(0);
  }

  const dir = arg('--candidates', '');
  if (!dir) { console.error('要 --candidates <目录>'); process.exit(2); }
  const acceptedArg = arg('--accepted', '');
  let accepted = acceptedArg ? fs.readFileSync(acceptedArg, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean) : null;
  // #1182 —— 没手工给名单时，先问流水线自己留下的裁定。三种情况分开处置，理由整段写在
  // §闸的裁定怎么交到写池这一步 上面（尤其第三条 🔴：为什么「文件不在」不能当失败信号）。
  let slotOf = null;
  if (!acceptedArg) {
    const verdict = readVerdict(dir);
    if (verdict && verdict.broken) {
      console.error(`🔴 不写池：${verdict.broken}`);
      console.error('   这份名单就是五道闸的裁定。没有它只能全收，而全收等于那五道闸对写池这一步'
        + '一点都不承重 —— 报告里写着被拒的那一套照样进池。');
      console.error(`   ⟹ 要么重跑 run.js --candidates ${dir}，要么手工挑：--accepted <文件>。`);
      process.exit(2);
    }
    if (verdict) {
      accepted = verdict.accepted.map((a) => a.candidate);
      slotOf = {};
      for (const a of verdict.accepted) slotOf[a.candidate] = a.slot;
      console.log(`按流水线的裁定收 ${accepted.length} 套（${VERDICT_FILE}，`
        + `${verdict.total === undefined ? '?' : verdict.total} 套候选跑过闸）`);
    } else {
      console.log(`没有 ${VERDICT_FILE} —— 这是手工挑候选那条路，全收。`
        + '（流水线跑过的候选目录里会有这份文件，那时按它的裁定收。）');
    }
  }
  const candidates = readCandidates(dir);
  const { pool, map } = buildPool(candidates, { accepted, slotOf });

  const outPath = arg('--out', POOL_PATH);
  fs.writeFileSync(outPath, `${JSON.stringify(pool, null, 2)}\n`);

  // 表跟着一起进 public/themes/ —— 阶段 2 之后一套主题的样子主要在它的表里，池成员光有 tokens
  // 是一身没有衣服的骨架。
  if (!argv.includes('--no-sheets')) {
    fs.mkdirSync(SHEETS_DIR, { recursive: true });
    for (const m of map) {
      const src = candidates.find((c) => c.id === m.candidate).sheetPath;
      fs.copyFileSync(src, path.join(SHEETS_DIR, `${m.id}.css`));
    }
  }
  console.log(`池子 ${map.length} 套 → ${path.relative(NEXT, outPath)}`
    + `${argv.includes('--no-sheets') ? '（没拷表）' : ` + ${map.length} 份表 → public/themes/`}`);
  for (const m of map) {
    console.log(`  ${m.candidate} → ${m.id}  (${m.sector})`
      + `${m.headerMovedBy ? `  · 顶栏让开了 → ${(pool[m.id].supports.header || [])[0]}：${m.headerMovedBy}` : ''}`);
  }
  // 🔴 #1016 r5 —— 让开的套数单独报一次。逐行那句话在 80 行里翻页就看不见了，而这个数是
  //    「顶栏那一维还剩多少花样」的读数：全 80 套都让开就等于池子里根本没有透明浮层了。
  const moved = map.filter((m) => m.headerMovedBy);
  const headerCounts = {};
  for (const id of Object.keys(pool)) {
    const h = ((pool[id].supports || {}).header || ['(没有)'])[0];
    headerCounts[h] = (headerCounts[h] || 0) + 1;
  }
  console.log(`顶栏：${Object.entries(headerCounts).map(([h, n]) => `${h} ${n}`).join(' · ')}`
    + ` —— 其中 ${moved.length} 套本来轮到透明浮层、按「浅底首屏不配浮层」那条让开了`
    + `${moved.length ? `（${moved.map((m) => m.id).join(' ')}）` : ''}`);
  const problems = verifyPool(pool);
  if (problems.length) {
    console.error('🔴 翻完之后自己查了一遍，不达标：');
    for (const p of problems) console.error(`   ${p}`);
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  toPoolEntry, buildPool, readCandidates, verifyPool, colourWord, hueOf, feelOf, POOL_PATH,
  // #1182 —— run.js 落裁定、写池那一步读裁定，两边用的是这三个，别各写一份。
  VERDICT_FILE, verdictPath, writeVerdict, readVerdict,
};
