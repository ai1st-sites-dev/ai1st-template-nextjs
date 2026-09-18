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
//    翻漏了不会有任何东西报错：当时的 `layoutFor()` 读的是 `supports`，读不到就返回 `{}`，
//    于是那套主题静默地"对每个块都没有意见"，而 `region-layout.js` 拿到 `{}` 就把顶栏页脚落回现状。
//    📌 #1353 起这一族的键叫 `shapes`、函数叫 `regionShapesFor()`；静默失败的形状一模一样，
//       所以 `verifyPool()` 那两条（不许有 `supports` / 选择单里三个区要在）就是这一段的今天版。
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
// #1342 —— `<id>.shapes.json` 这个文件名只算一处：写它的是 generate.js，读它的是这里。
const { shapeSheetPath } = require('./shape-sheet.js');

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
 * 🔴 #1353 —— 这段原来写的是「`layout`（一个值）在这里变成 `supports`（一个清单）」。今天不是了：
 *    顶栏 / 页脚的结构跟别的 31 个块一样写进**选择单** `shapes`（一个名字），`supports` 整个退役，
 *    `layoutFor()` 也改名 `regionShapesFor()` 并且读选择单。那条规矩本身没变、只是换了键名：
 *    **一件事只许有一个答案处**，两个键同时在一套主题上就变成"谁说了算取决于读的人是谁"。
 *    `verifyPool()` 现在两向都查：不许再有 `supports`，且 `shapes.header` / `shapes.footer` 要在。
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

  // 📌 #1341 —— 这里原来先把候选的 `layout`（`generate.js` 产的四个版式名）逐键翻成 `supports`
  //    清单，再补 header / footer 两个键。内容结构那一维整条退役了，候选不再产 `layout`，所以
  //    `supports` 里今天只有下面这两个【区】的键。
  // 🔴 #1353 —— 顶栏 / 页脚的结构以前写进 `supports`（一个清单），因为它们那时不是 block。
  // 它们现在是 block（`blocks/header/manifest.json` / `blocks/footer/manifest.json`，D14 的已知例外清掉了），所以
  // 它们的结构跟别的 32 个块一样写进**选择单** `shapes`（一个名字），`supports` 整个退役了。
  const regionShapes = {};
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
  regionShapes.header = regions.header;
  regionShapes.footer = regions.footer;

  return {
    id,
    // 🔴 #1016 r5 —— 顶栏那一维被规则挪走时，把原因带出来给调用方打印。它不是池成员的一部分
    //    （不写进 `entry`），只是这一次翻译的一句说明；不带出来的话，「本来该轮到浮层、这套没拿到」
    //    的唯一痕迹就是选择单里 header 那一行的字符串，没人看得出它是规则挪的还是轮换本来如此。
    headerMovedBy: regions.headerMovedBy,
    entry: {
      label: `${word[0].toUpperCase()}${word.slice(1)} ${nn} — ${feel.shape} ${feel.air} ${word}`
        + ` with ${accentWord} accent, for ${sector}`,
      colors: tokens.colors,
      fonts: tokens.fonts,
      settings: tokens.settings,
      style: `${feel.shape} ${feel.weight} ${word} and ${accentWord}`,
      industries: slot.industries.slice(),
      // 这套皮自己那张表，`public/themes/<sheet>.css`。#1016 之前池成员没有这个键（旧 30 套一张表
      // 都没有，它们的样子全在 colors/fonts/settings 里）；阶段 2 之后一套主题的样子**主要在表里**，
      // 所以池成员必须说得出自己的表是哪一份。
      sheet: id,
      // #1342 —— 选择单落到池成员上。在这之前这个键**根本不写**：候选那边算出来的东西到不了池子，
      // 于是 `themes.js` 的 `shapesFor` 对每套新主题都回 `{}`，`sync-config.js` 的 `shapeForBlock`
      // 每个块都走「主题选择单里没有它」那条落回默认的路 —— 而那条路是静默的（#1338 才给它加了
      // 一行日志）。翻译在这里只是**原样搬**，不做任何加工：名字合不合法由 manifest 那一端管
      // （`checkManifestShape`），齐不齐由第六道闸和 `pool.test.js` ⑪ 管。
      // 🔴 #1353 起顶栏 / 页脚那两行也在这里（上面 `regionShapes`）—— 它们不再有自己的键。
      //    顺序有意让区在后：候选那边不会产这两个键，但万一产了，权威是这里算的那个
      //    （`regionsForPool`，跟图册那条路同一个函数）。
      shapes: { ...(candidate.shapes || {}), ...regionShapes },
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
      // 📌 #1341 —— 这里原来还读回 `<id>.layout.json`（候选的四个版式名）。`generate.js` 不再写
      //    那个文件，内容结构那一维整条退役了。
      // #1342 —— 选择单走的就是版式当年那条路：生成器落一个文件，这里读回来。文件不在就回 `{}`
      // —— 手工摆的候选目录没有这个文件是常态，而「选择单是空的」这件事有人说话：候选那一端是
      // 第六道闸（`gates.js` 的 `gateShapes`，逐块点名缺了谁），池那一端是 `pool.test.js` 第 ⑪ 段。
      // 这里不造兜底名字（理由同 sync-config §shapeForBlock）。
      const shapesFile = shapeSheetPath(dir, id);
      return {
        id,
        sheetPath: path.join(dir, f),
        tokens: JSON.parse(fs.readFileSync(path.join(dir, `${id}.tokens.json`), 'utf-8')),
        shapes: fs.existsSync(shapesFile) ? JSON.parse(fs.readFileSync(shapesFile, 'utf-8')) : {},
      };
    });
}

/**
 * 一批候选 → 整个池（对象，键是新 id）。`accepted` 是候选 id 的白名单，不传就全收。
 * `slotOf`（#1182）是「候选 id → 它该占的位子下标」；不传就退回「按过滤之后的位置发位子」。
 *
 * 🔴 #1342 —— **「没有名单」和「名单是空的」是相反的两件事，而这两种入参长得很像。**
 *    · `accepted` 是 `null` / `undefined`（手工挑候选那条路，目录里没有裁定文件）⟹ **全收**
 *    · `accepted` 是 `[]`（流水线跑过、五道闸一套都没放过）⟹ **取空集**，收 0 套
 *    这一行原来写的是 `accepted ? … : candidates`，靠的是「空数组是真值」这条 JS 规则把第二种送进
 *    filter 那一支 —— 结论是对的，但它是**默认值撞对了**，读的人看不出哪一支是有意的。改成问
 *    `Array.isArray`：同样的两种入参走同样的两支，而「这里问的是有没有这份名单」写在脸上。
 *    （收 0 套之后**不写盘**是 §main 那一段的事，不是这里 —— 这个函数只负责算出那个空池子。）
 */
function buildPool(candidates, { accepted, slotOf } = {}) {
  const slots = poolSlots();
  const take = Array.isArray(accepted) ? candidates.filter((c) => accepted.includes(c.id)) : candidates;
  if (take.length > slots.length) {
    throw new Error(`池位子只有 ${slots.length} 个，收到 ${take.length} 套候选 —— `
      + '位子表在 industry-sectors.js（16 组各 THEMES_PER_SECTOR 套，再加 EXTRA_THEMES 里那几组的增量），'
      + '要放更多套先改那张表，别在这里截断。');
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
        + '候选那边的形状没翻成池子这边的选择单（`shapes`）');
    }
    // 🔴 #1353 —— 这一段以前查的是 `supports`。顶栏 / 页脚成了块之后，它们的结构住在选择单里，
    // 而 `supports` **一个都不许再有**（`themes.js` 的 `themesWithSupports`，`sync-config.js` 拿它
    // 拦构建）。所以这里两件事都要查：不许有旧键，且新键要在。
    if (t.supports !== undefined) {
      problems.push(`${id}: 还留着 \`supports\` 这个键（${JSON.stringify(Object.keys(t.supports || {}))}）`
        + ' —— #1353 起顶栏 / 页脚的结构写进 `shapes.header` / `shapes.footer`，`supports` 退役了');
    }
    if (!t.shapes || typeof t.shapes !== 'object' || !Object.keys(t.shapes).length) {
      problems.push(`${id}: 没有 \`shapes\` —— shapesFor() 会返回 {}，这套主题对每个块都没有意见`);
      continue;
    }
    for (const region of ['header', 'footer']) {
      if (typeof t.shapes[region] !== 'string' || !t.shapes[region]) {
        problems.push(`${id}: shapes.${region} 不是一个非空字符串（${JSON.stringify(t.shapes[region])}）`
          + ` —— 这个区的形态没翻过来，站会落回 blocks/${region}/ 里排第一的那个形态`);
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
    // 🔴 #1353 r2 —— 这里原来印「有 supports 的 X/N 套 · 还留着 layout 的 Y 套」。本票退役 `supports`
    //    之后 X 恒 0；而 Y 其实**一直**恒 0 —— 这两样正是上面 `verifyPool` 刚刚拒过的东西，走到这一行
    //    时它们按构造只能是 0。一句永远为真的话不是读数。换成池子里真的会变的那一维：三个区各自的
    //    形态分布（跟本文件 `promote.js` §main 末尾那行同一个读数）。公告条那一行单独印，因为 `verifyPool` 只强制
    //    header / footer ⟹ 它是这三行里唯一可能读到 `(没有)` 的。
    const ids = Object.keys(pool);
    const dist = (region) => {
      const counts = {};
      for (const id of ids) {
        const v = (pool[id].shapes || {})[region] || '(没有)';
        counts[v] = (counts[v] || 0) + 1;
      }
      return Object.entries(counts).map(([v, n]) => `${v} ${n}`).join(' · ');
    };
    console.log(`✅ ${ids.length} 套的选择单：顶栏 ${dist('header')} · 页脚 ${dist('footer')}`
      + ` · 公告条 ${dist('announcement-bar')}（公告条这一行 verifyPool 不强制）`);
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

  // 🔴 #1342 —— **自查在写盘之前。** 这一段原来在最底下（写完池、拷完表、打完日志之后），于是
  //    「收 0 套」这条最常走的路是这样的：`buildPool` 回一个空对象 → `theme-pool.json` 被整份覆盖
  //    成 `{}` → 然后才轮到自查说「池子是空的」再 `exit 1`。盘上那一步已经发生了：池子里那几套
  //    主题当场没了，要 `git checkout` 才回得来。#1338 装的第六道闸让「收 0 套」从异常变成了
  //    **每一轮的常态**（生成器还不产选择单时每套候选都被它拒掉），这条顺序于是从「理论上不好」
  //    变成「每跑一次流水线就清一次池子」。
  //    清空进不了 main（池子空时 `npm run test:scripts` 当场红，CI 的 template-scripts job 跑的
  //    正是它），所以它不是能溜进生产的洞 —— 它是**盘上破坏 + 让重建池子的人白折腾**。
  //    两条路里选的是「先自查后写盘」而不是「0 套直接拒绝」：`verifyPool` 判的不止「空不空」
  //    （#1353 之后是：还留着 `supports` / `layout` 这两个退役键、`shapes.header` / `shapes.footer`
  //    不是非空字符串），而那几种不达标今天
  //    同样是**写完盘才说**。收窄成只拦 0 套的话，剩下那几种照旧会把一份不达标的池子留在盘上。
  const problems = verifyPool(pool);
  if (problems.length) {
    console.error(`🔴 一个字节都没写 ${path.relative(NEXT, outPath)} —— 翻出来的池子先自查了一遍，不达标：`);
    for (const p of problems) console.error(`   ${p}`);
    console.error(`   （${map.length} 套收进池；自查在写盘之前，所以 ${path.relative(NEXT, outPath)} 还是原来那份。`
      + '要看闸为什么收 0 套，读候选目录里的 pipeline-verdict.json。）');
    process.exit(1);
  }

  fs.writeFileSync(outPath, `${JSON.stringify(pool, null, 2)}\n`);

  // 表跟着一起进 public/themes/ —— 阶段 2 之后一套主题的样子主要在它的表里，池成员光有 tokens
  // 是一身没有衣服的骨架。
  // 🔴 #1342 —— 拷表也在自查之后：一份被自查拒掉的池子不该在 public/themes/ 里留下它的表。
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
      + `${m.headerMovedBy ? `  · 顶栏让开了 → ${(pool[m.id].shapes || {}).header}：${m.headerMovedBy}` : ''}`);
  }
  // 🔴 #1016 r5 —— 让开的套数单独报一次。逐行那句话在 80 行里翻页就看不见了，而这个数是
  //    「顶栏那一维还剩多少花样」的读数：全 80 套都让开就等于池子里根本没有透明浮层了。
  // 🔴 #1353 r2 —— 上面那行和这里读的都是**选择单**（`shapes.header`，一个名字）。它们原来读
  //    `supports.header`（一个清单，取首项）；本票把 `supports` 退役之后那两处一个抛 TypeError、
  //    一个恒读 `(没有)`，而恒读那一个是**不出声**的那种坏法：这行日志照印，只是每套都算进
  //    `(没有)` 那一格 —— 「顶栏那一维还剩多少花样」这个读数当场失明。QA1 在 #1353 r1 抓到。
  const moved = map.filter((m) => m.headerMovedBy);
  const headerCounts = {};
  for (const id of Object.keys(pool)) {
    const h = (pool[id].shapes || {}).header || '(没有)';
    headerCounts[h] = (headerCounts[h] || 0) + 1;
  }
  console.log(`顶栏：${Object.entries(headerCounts).map(([h, n]) => `${h} ${n}`).join(' · ')}`
    + ` —— 其中 ${moved.length} 套本来轮到透明浮层、按「浅底首屏不配浮层」那条让开了`
    + `${moved.length ? `（${moved.map((m) => m.id).join(' ')}）` : ''}`);
  process.exit(0);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  toPoolEntry, buildPool, readCandidates, verifyPool, colourWord, hueOf, feelOf, POOL_PATH,
  // #1182 —— run.js 落裁定、写池那一步读裁定，两边用的是这三个，别各写一份。
  VERDICT_FILE, verdictPath, writeVerdict, readVerdict,
};
