#!/usr/bin/env node
/**
 * shape-survey.js — 生成器里那十张画法候选表，跟 `blocks/*.json` 的形态清单对一次账（#1340）。
 *
 *   node scripts/theme-pipeline/shape-survey.js                  普查：候选对 N = 已在库 X + 待迁 Y
 *
 * 退出码：0 正常 · 2 跑不起来（**不许当成 0**）。
 *
 * 🔴 **`--cut` 与 `--check` 两个模式已于 #1339 删掉，别照旧记忆去敲。** 它们是「拿配方里的几何
 *    重剪一遍，再跟盘上比」，而唯一的输入是 `sheet-recipes.js` 的 `geometryFor` —— #1339 把配方里
 *    的几何整族删掉之后那个函数不存在了，刀没有了料。**从那天起 `public/shapes.css` 是几何的唯一
 *    出处，而且它是手维护的**：要加一副新画法就在那份表里写规则、在 `blocks/<块>.json` 的 `shapes`
 *    里登记名字，没有「从配方剪一份」这条路了。
 *    它们最后一次跑的读数（2026-09-16，#1339 动手当天）：普查 **候选对 53 = 已在库 53 + 待迁 0**；
 *    `--check` 重剪对账 **一致 51 · 不一致 2**，那 2 对是盘上人手调过的 `hero/text-center` 与
 *    `hero/text-left`（`[data-has-imageUrl]` 拆分，理由在 `public/shapes.css` 的文件头）。
 *
 * 📌 留下来的这一半**不依赖几何**：它问的是「生成器挑得出来的每一个形态名，在 manifest 里登记了吗」
 *    —— 那条不变量在 #1339 之后照样活着（生成器仍然挑画法，只是不再自己画它）。
 *
 * ══ 尺子是「(块, 形态) 对」，不是形态名 ══════════════════════════════════════════════════════
 * 形态名不唯一：`three-up` 在九个块上都有，`two-up` 在十三个块上都有。问的是「`process-steps` 有没有
 * `three-up`」，不是「有没有哪个块有 `three-up`」—— 按名字量，#1340 立票时有 7 项待迁会被读成
 * 「已经有了」（PM 2026-09-15 裁定 ②）。
 *
 * ══ 哪张表对哪几个块也不手抄 ══════════════════════════════════════════════════════════════════
 * `sheet-recipes.js` 的 `LOOK_FAMILIES` 就是那份注册表。卡片那一族服务 `features-grid` 和
 * `card-group` 两个块，所以它 4 个名字是 8 对；表单那一族只服务 `contact-form`（`quote-form` 的
 * `main-aside` 和 `newsletter-signup` 的 `form-side` 不在那张表里，是另一回事）。
 *
 * ══ `content-split` 的名字带节律后缀 —— 名字要写全，不许按前缀匹配 ══════════════════════════════
 * 它的几何由「图在哪」加「隔一段翻不翻面」两维决定，而形态名只有一个 ⟹ 盘上写成
 * `media-right-alternate` / `narrow-stack-uniform`（理由在 `public/shapes.css` 的文件头）。
 *
 * 🔴 这一族的候选项因此要**展开成全名再精确比**：4 副画法 × 2 档节律 = 8 对，不是 4 对。
 *    按前缀匹配对「节奏」这一维是瞎的 —— 库里有 `media-right-alternate`，前缀尺就说 `media-right`
 *    已在库，而 `media-right-uniform` 缺不缺它一个字都不说。两把尺同一棵树上的读数：
 *      按前缀匹配   候选对 49 = 已在库 21 + 待迁 28   ← 旧尺
 *      写全名精确比 候选对 53 = 已在库 21 + 待迁 32   ← 现在用这把
 *    差的 4 对全在 `content-split`（#1340 · PM 2026-09-15 裁定）。
 *
 * 🔴 展开集自己要有自检：拿 `voiceFor(i)` 把 97 套候选真发得出来的 `content-split` 全名枚举一遍，
 *    展开集必须全部罩住，否则当场退 2。（**用 `voiceFor` 不用 `layoutNamesFor`** —— 后者只是前者的
 *    一层壳，而 #1341 要删掉它；两个键 97/97 相同，PM 与 DEV 各量过一次。）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');
const BLOCKS = path.join(NEXT, 'blocks');

let recipes;
try {
  recipes = require(path.join(DIR, 'sheet-recipes.js'));
  // #1339 —— `postcss` 是 `--cut` / `--check` 那两个模式用的（它们要解析剪出来的 CSS 再跟盘上比），
  // 那两个模式删掉之后这里不再需要它。留着一个没人用的 require 会让下一个人以为这个脚本还在读 CSS。
} catch (e) {
  console.error(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}

/** 每个块今天在 manifest 里的形态名 */
function shapesByBlock() {
  const out = {};
  for (const fn of fs.readdirSync(BLOCKS)) {
    if (!fn.endsWith('.json')) continue;
    const m = JSON.parse(fs.readFileSync(path.join(BLOCKS, fn), 'utf-8'));
    out[fn.replace(/\.json$/, '')] = (m.shapes || []).map((s) => s.name);
  }
  return out;
}

/** 一个候选表条目展开成它在盘上的**全名**：`split` 那一族带节律后缀，其余就是名字本身 */
function expand(fam, look) {
  return fam.key === 'split' ? recipes.SPLIT_RHYTHMS.map((r) => `${look}-${r}`) : [look];
}

/**
 * 展开集自检：97 套候选里生成器**真发得出来**的每一个 `content-split` 全名，都要落在展开集里。
 * 分母从 `poolSlots()` 现取，不手抄一个 97。
 */
function selfCheck() {
  const { poolSlots } = require(path.join(DIR, 'industry-sectors.js'));
  const n = poolSlots().length;
  const produced = new Set();
  for (let i = 0; i < n; i += 1) {
    const v = recipes.voiceFor(i);
    produced.add(`${v.split}-${v.splitRhythm}`);
  }
  const fam = recipes.LOOK_FAMILIES.find((f) => f.key === 'split');
  const all = new Set(Object.keys(fam.table).flatMap((look) => expand(fam, look)));
  const uncovered = [...produced].filter((x) => !all.has(x));
  if (uncovered.length) throw new Error(`展开漏了生成器真发的全名：${uncovered.join(' ')}`);
  return `自检：${n} 套候选里生成器发得出 ${produced.size} 个 content-split 全名，`
    + `展开集 ${all.size} 个，全部罩住`;
}

/** 候选表展开成 (块, 全名) 对，分成「已在库」和「待迁」两堆。🔴 精确比，不按前缀 */
function survey() {
  const man = shapesByBlock();
  const todo = []; const done = [];
  for (const f of recipes.LOOK_FAMILIES) {
    for (const b of f.blocks) {
      for (const look of Object.keys(f.table)) {
        for (const name of expand(f, look)) {
          ((man[b] || []).includes(name) ? done : todo).push(`${b}/${name}`);
        }
      }
    }
  }
  return { todo, done };
}

// ── 入口 ──────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length) {
  console.error(`🔴 这个脚本今天只有一个模式（普查），不认参数：${args.join(' ')}`);
  console.error('   `--cut` / `--check` 已于 #1339 删掉 —— 理由与它们最后一次的读数写在文件头。');
  process.exit(2);
}
try {
  {
    console.log(selfCheck());
    const { todo, done } = survey();
    console.log(`候选对 ${done.length + todo.length} = 已在库 ${done.length} + 待迁 ${todo.length}`);
    console.log(`待迁：${todo.join(' ') || '（空）'}`);
    console.log(`已在库：${done.join(' ')}`);
  }
} catch (e) {
  console.error(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}
