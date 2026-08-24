#!/usr/bin/env node
/**
 * skeleton-distance.test.js — 第五道闸（⑤ 骨架距离）的六条承重性质（#1173）。
 *
 * 跑法:  node scripts/theme-pipeline/skeleton-distance.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * 这道闸唯一能出的错是**一个方向**：尺子少了一维之后，距离整体压低、而每个读数看起来都很正常。
 * #1173 立票时正文里那把尺就是这么错的 —— 9 块里的 `benefits-list` 被 #1162 整层退役（0/83），那一维
 * 80 套读到同一个指纹，13 对 ≤3 变成 28 对、还冒出 2 对 ≤2，于是正文差点为「不存在的双胞胎」写一份
 * 免死名单。**所以这里量的不是「闸能不能拦」，主要是「尺子还在量东西吗」。**
 *
 * 它落在这里而不是一个一次性脚本：`npm run test:scripts` 按**文件名**发现它（`scripts/run-script-tests.js`），
 * CI 的 template-scripts 那个 job 每次动 templates/nextjs 都会跑。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');
const SHEETS = path.join(NEXT, 'public', 'themes');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let skel; let gates; let pool;
try {
  skel = require(path.join(DIR, 'skeleton-distance.js'));
  gates = require(path.join(DIR, 'gates.js'));
  pool = require(path.join(NEXT, 'scripts', 'theme-pool.json'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const IDS = Object.keys(pool);
const sheetPathOf = (id) => path.join(SHEETS, `${pool[id].sheet}.css`);
let FP;
try {
  FP = Object.fromEntries(IDS.map((id) => [id, skel.fingerprintSheet(fs.readFileSync(sheetPathOf(id), 'utf-8'))]));
} catch (e) {
  die(`读不到池成员的表: ${e.message}`);
}
/** 一套候选喂给闸时的形状（闸只用 sheetPath）。 */
const candidateFrom = (cssPath) => ({ id: path.basename(cssPath, '.css'), sheetPath: cssPath });
/** 池里除了 `except` 之外的每一套，按闸吃的形状。 */
const poolExcept = (except) => Object.fromEntries(IDS.filter((id) => id !== except)
  .map((id) => [id, { sheet: pool[id].sheet }]));
/** 把一份表某块的**裸 class 规则**加一条几何声明（不是颜色）—— AC4/AC5 的变异手法。 */
function bendGeometry(css, block, n) {
  const re = new RegExp(`(^\\.${block.replace(/-/g, '\\-')} \\{)`, 'm');
  if (!re.test(css)) throw new Error(`这份表里找不到 .${block} 的裸规则`);
  return css.replace(re, `$1\n  padding-inline-start: ${n}.${n}${n}rem;`);
}
/** 只动颜色/字体：每个 `var(--color-…)` 换成另一个色阶，`font-family` 换一族。 */
function recolour(css) {
  return css
    .replace(/var\(--color-primary-(\d00|50)\)/g, 'var(--color-accent-500)')
    .replace(/font-family:[^;]+;/g, 'font-family: "T1173 Fake", serif;');
}
const tmp = fs.mkdtempSync('/tmp/skeleton-distance-test-');
const write = (name, css) => {
  const p = path.join(tmp, `${name}.css`);
  fs.writeFileSync(p, css);
  return p;
};

console.log(`\n════ ⑤ 骨架距离（#1173）—— 池 ${IDS.length} 套 · ${skel.SKELETON_BLOCKS.length} 块 ════`);

// ── 承重那条：这个池子自己满足这道闸 ─────────────────────────────────────────────────────────────
// 🔴 它跟下面 AC2 那条**不是同一件事**，而这一条才是永远跑的：池子每加一套（#1174 正在加），
//    它都必须仍然成立。AC2 那条是标定，钉在今天这 80 套上。
{
  const pairs = [];
  for (let i = 0; i < IDS.length; i += 1) {
    for (let j = i + 1; j < IDS.length; j += 1) {
      pairs.push({ a: IDS[i], b: IDS[j], d: skel.distance(FP[IDS[i]], FP[IDS[j]]) });
    }
  }
  const under = pairs.filter((p) => p.d < skel.MIN_DISTANCE);
  const min = Math.min(...pairs.map((p) => p.d));
  if (under.length) {
    bad(`池子自己就有 ${under.length} 对骨架距离 < ${skel.MIN_DISTANCE}：`
      + `${under.slice(0, 8).map((p) => `${p.a}↔${p.b}=${p.d}`).join(' · ')}`
      + ' —— 这道闸在拦新货之前，先得对存量成立');
  } else {
    ok(`池内 ${pairs.length} 对，最小距离 ${min} ≥ ${skel.MIN_DISTANCE}（这道闸对存量不误伤）`);
  }
}

// ── AC1 存量不误伤：池里每一套逐套当候选，跟其余那些跑一遍真的闸 ───────────────────────────────────
{
  const rejected = [];
  const jammedOn = [];
  for (const id of IDS) {
    const r = gates.gateSkeleton(candidateFrom(sheetPathOf(id)), poolExcept(id));
    if (r.instrument) jammedOn.push(`${id}: ${r.problems.join(' ')}`);
    else if (r.pass !== true) rejected.push(`${id}: ${r.problems.join(' ')}`);
  }
  if (jammedOn.length) bad(`AC1 有 ${jammedOn.length} 套量不到：${jammedOn[0]}`);
  else if (rejected.length) bad(`AC1 被拒 ${rejected.length} 套（应为 0）：${rejected.slice(0, 3).join(' | ')}`);
  else ok(`AC1 ${IDS.length} 套逐套跟其余 ${IDS.length - 1} 套跑真闸 ⟹ 被拒集合为空、没有一套量不到`);

  // 🔴 「输出里没有任何例外/免死名单命中」—— 判的是**根本没有这个机制**，比「这次没命中」强。
  //    一个存在的名单会在某个池子形态下开火，而那时它是静默的：报文只说「过了」。
  // 📌 注释里会出现「免死名单」这个词（gates.js 那一节和票都在说「本票不需要它」），所以先把注释行
  //    去掉再问 —— 问的是有没有一份**在跑的**名单，不是这几个字出现过没有。
  const src = fs.readFileSync(path.join(DIR, 'skeleton-distance.js'), 'utf-8')
    + fs.readFileSync(path.join(DIR, 'gates.js'), 'utf-8').split('// ── ⑤ 骨架距离')[1];
  const codeHits = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => /EXEMPT|ALLOWLIST|WHITELIST|免死|白名单|GRANDFATHER/i.test(l));
  if (codeHits.length) bad(`AC1 这道闸里有一份例外名单：${codeHits[0].trim()}`);
  else ok('AC1 这道闸没有例外/免死名单这个机制（注释之外零命中）');
}

// ── AC2 尺子标定：钉在今天这 97 套上的读数 ────────────────────────────────────────────────────────
//
// 🔴 这一条**会随池子变化而失效，而失效的正确形态是「说出来」而不是「悄悄不比」**。它钉的是
//    #1173 正文证据③ 那组读数 —— 那组数是票的口径定义（正文给的 Python 参考实现算出来的），
//    我的实现必须在同一份语料上逐档、逐对、逐块重现它。池子一变（#1174 就在加），这组数当然不再
//    适用；那时这一条会**打印出差在哪并要求重新标定**，不会假装自己还在守。
//
// 🔴 **2026-08-24 #1174 重新标定过一次（池 80 → 97）。** 上一组（80 套，池 id 指纹
//    `573e6144cb2ce2da`）留在这里作出处：
//      distinct 28/16/20/8/16/12/16/16/8（与今天**逐块相同**）
//      距离分布 {3:5, 4:45, 5:143, 6:203, 7:227, 8:103, 9:2434}   共 3160 对
//      ≤3 的对子 5 对（与今天**逐对相同**：azure-50/fern-02 · crimson-51/ember-59 ·
//        ember-46/fern-10 · fern-10/teal-42 · fern-31/indigo-79）
//    新的分布为什么可以接受（这是本条要求「别只改常量」的那半句）：换池子只把**对子总数**从 3160
//    抬到 4656（97×96/2），而三个承重读数一个都没动 —— ① 每块 distinct 逐块相同 ⟹ 新增那 17 套
//    没有引入任何一副新骨架，也没有让哪一块塌成单值；② ≤3 的对子**仍是同一批 5 对，全部是存量之间
//    的**，新增 17 套参与其中 0 对；③ 全池最小距离仍是 3。也就是说这一批新表在这一维上既没有稀释
//    池子、也没有把自己挤到别人身上。分布里 4-9 各档的绝对值变大是「对子变多了」的算术，不是分布
//    形状变了。
//
// 🔴🔴 **「该不该跳过」只许问池子的身份，不许问读数** —— 这一条我自己踩过：第一版的判据是
//    「distinct 那张表跟冻结的那份对不上就算池子变了」，而尺子被改坏时 distinct 也会变 ⟹ 一次真的
//    尺子回归被报成「池子动了，跳过标定」。实测：把块判据里的 `\b` 拿掉（那是最直觉的写法，会把
//    `.hero__title` 也算给 hero），distinct 从 28/16/20/8/16/12/16/16/8 变成 56/54/36/24/48/48/48/48/12、
//    ≤3 的对子从 5 对变成 0 对，而这一格打的是 `⏭ 跳过`、整份测试 **11 过 0 失败**。
//    ⟹ 判据换成**池成员 id 的集合**（下面那个 sha256）：池子没动而读数动了 = 尺子坏了 = 红。
{
  const FROZEN_POOL = 97;
  // sha256(排序后的池 id 逗号连接).slice(0,16) —— 只认「是不是同一批成员」，跟任何读数无关。
  const FROZEN_POOL_ID = '1343301b57bfae23';
  const FROZEN_DISTINCT = {
    hero: 28, 'cta-banner': 16, 'contact-form': 20, 'page-header': 8, 'faq-accordion': 16,
    testimonials: 12, 'process-steps': 16, 'card-group': 16, 'contact-info': 8,
  };
  const FROZEN_HIST = {
    3: 5, 4: 71, 5: 211, 6: 308, 7: 325, 8: 156, 9: 3580,
  };
  const FROZEN_CLOSE = [
    ['azure-50', 'fern-02', ['cta-banner', 'contact-form', 'testimonials']],
    ['crimson-51', 'ember-59', ['hero', 'contact-form', 'card-group']],
    ['ember-46', 'fern-10', ['page-header', 'process-steps', 'card-group']],
    ['fern-10', 'teal-42', ['hero', 'contact-form', 'process-steps']],
    ['fern-31', 'indigo-79', ['cta-banner', 'contact-form', 'testimonials']],
  ];
  const check = skel.selfCheck(FP);
  const distinctNow = Object.fromEntries(check.perBlock.map((r) => [r.block, r.distinct]));
  const hist = {};
  const close = [];
  for (let i = 0; i < IDS.length; i += 1) {
    for (let j = i + 1; j < IDS.length; j += 1) {
      const d = skel.distance(FP[IDS[i]], FP[IDS[j]]);
      hist[d] = (hist[d] || 0) + 1;
      if (d <= 3) {
        close.push([...[IDS[i], IDS[j]].sort(), skel.differingBlocks(FP[IDS[i]], FP[IDS[j]])]);
      }
    }
  }
  const key = (x) => JSON.stringify(x);
  const poolId = require('crypto').createHash('sha256')
    .update([...IDS].sort().join(',')).digest('hex').slice(0, 16);
  const stale = IDS.length !== FROZEN_POOL || poolId !== FROZEN_POOL_ID;
  console.log(`  📐 距离分布: ${key(hist)}`);
  console.log(`  📐 每块 distinct: ${key(distinctNow)}`);
  if (stale) {
    // 不算失败、也不静默：把差在哪打出来，指到该重新标定的地方。
    console.log(`  ⏭  AC2 标定跳过 —— 池子已经不是标定那 80 套了`
      + `（现在 ${IDS.length} 套，id 指纹 ${poolId} ≠ ${FROZEN_POOL_ID}）。`);
    console.log('     重新标定：用 #1173 正文证据② 那段参考实现在新池上取一次读数，替掉本文件里的'
      + ' FROZEN_* 三个常量，并在票上写清新旧两组数。**别只改常量**：换池子的那张票要自己解释'
      + '为什么新的分布是可以接受的。');
    console.log(`     旧: pool=${FROZEN_POOL}(${FROZEN_POOL_ID}) distinct=${key(FROZEN_DISTINCT)}`);
  } else {
    const distinctSame = key(distinctNow) === key(FROZEN_DISTINCT);
    const histSame = key(Object.keys(hist).sort((a, b) => a - b).reduce((o, k) => {
      o[k] = hist[k]; return o;
    }, {})) === key(FROZEN_HIST);
    const closeSame = key(close.sort((a, b) => a[0].localeCompare(b[0]))) === key(FROZEN_CLOSE);
    if (distinctSame && histSame && closeSame) {
      ok(`AC2 每块 distinct、${Object.values(hist).reduce((a, b) => a + b, 0)} 对的距离分布、`
        + `≤3 那 ${close.length} 对、每对不同的是哪几块 —— 与冻结的那组读数逐个相同`);
    } else {
      // 池子是同一批成员而读数变了 ⟹ 变的是尺子。这条红是本格存在的全部理由。
      if (!distinctSame) bad(`AC2 每块 distinct 跟正文那把尺不同：现在 ${key(distinctNow)}，正文 ${key(FROZEN_DISTINCT)}`);
      if (!histSame) bad(`AC2 距离分布跟正文那把尺不同：现在 ${key(hist)}，正文 ${key(FROZEN_HIST)}`);
      if (!closeSame) bad(`AC2 ≤3 的对子跟正文那把尺不同：现在 ${key(close)}`);
    }
  }
}

// ── AC3 尺子自检：一维死了要当场红，不是给出一组少一维的数 ────────────────────────────────────────
{
  const clean = skel.selfCheck(FP);
  if (clean.emptyBlocks.length || clean.uniformBlocks.length) {
    bad(`AC3 今天这 9 块里有量不到东西的：空白=${JSON.stringify(clean.emptyBlocks)}`
      + ` 全组同值=${JSON.stringify(clean.uniformBlocks)}`);
  } else {
    ok(`AC3 9 块逐块 empty=0、distinct>1（语料 ${clean.corpus} 份表）`);
  }

  // 阳性对照 ①：读数那一层 —— 把清单里任一块换成今天表里不存在的名字（`benefits-list` 就是 #1162
  // 退役掉的那个），逐块读数必须把它点成「空白 + 全组同值」。
  const DEAD = 'benefits-list';
  const bent = skel.SKELETON_BLOCKS.map((b) => (b === 'card-group' ? DEAD : b));
  const deadFp = Object.fromEntries(IDS.map((id) => [id,
    skel.fingerprintSheet(fs.readFileSync(sheetPathOf(id), 'utf-8'), bent)]));
  const deadCheck = skel.selfCheck(deadFp, bent);
  const row = deadCheck.perBlock.find((x) => x.block === DEAD);
  if (deadCheck.emptyBlocks.includes(DEAD) && deadCheck.uniformBlocks.includes(DEAD)) {
    ok(`AC3 阳性对照（读数）：清单里塞进已退役的 ${DEAD} ⟹ empty=${row.empty} / distinct=${row.distinct}`);
  } else {
    bad(`AC3 阳性对照（读数）没开火：${DEAD} 的读数是 empty=${row && row.empty} distinct=${row && row.distinct}`);
  }
  // 阳性对照 ②：闸那一层 —— 它必须**拒跑**，而且真因要是「块名不是契约钩子」，不是「语料里数不出来」。
  // 🔴 判据必须点到那个真因：拿语料去判的实现在别的形态下会误报（一批两套双胞胎 ⟹ 全组同值），
  //    所以这里连报文一起断言，不只看 pass/instrument 两面旗子。
  const r = gates.gateSkeleton(candidateFrom(sheetPathOf(IDS[0])), poolExcept(IDS[0]), { blocks: bent });
  const msg = r.problems.join(' ');
  if (r.instrument === true && r.pass === false && msg.includes(DEAD) && msg.includes('不是契约钩子')) {
    ok('AC3 闸对死维报「量不到」并拒跑，真因是「块名不是契约钩子」');
  } else {
    bad(`AC3 闸对死维没拒成该有的样子：pass=${r.pass} instrument=${r.instrument} —— ${msg}`);
  }
  // 反向：真的 9 块在同一条路上必须**不**触发那条拒跑（否则上一格是恒红，什么都没证明）。
  const good = gates.gateSkeleton(candidateFrom(sheetPathOf(IDS[0])), poolExcept(IDS[0]));
  if (good.instrument) bad(`AC3 反向对照：真的 9 块也被判「量不到」—— ${good.problems.join(' ')}`);
  else ok('AC3 反向对照：真的 9 块走同一条路不触发拒跑');
}

// ── AC4 阳性对照：改 2 块必拒、改第 3 块放行且最近距离正好 3 ───────────────────────────────────────
//
// 🔴 改的那 3 块是 `diff(fern-10, ember-46)`，不是随便挑的：改 k 块（改成池里没有的值）之后，
//    到某套 X 的距离 = k + (d(fern-10,X) − |改的 ∩ diff(fern-10,X)|)。挑这三块让 ember-46 那一项
//    落在 3 + (3−3) = 3，于是「最近正好是 3」是算出来的、不是碰上的。
{
  const BASE = 'fern-10';
  const TRIO = ['page-header', 'process-steps', 'card-group'];
  const baseCss = fs.readFileSync(sheetPathOf(BASE), 'utf-8');
  const arm = (k) => {
    let css = baseCss;
    TRIO.slice(0, k).forEach((b, i) => { css = bendGeometry(css, b, 7 + i); });
    return css;
  };

  // 「池里没有的值」先证一次：动过的那几块，指纹在池里一个都不重复。
  const fp3 = skel.fingerprintSheet(arm(3));
  const collide = TRIO.filter((b) => IDS.some((id) => FP[id][b] === fp3[b]));
  if (collide.length) bad(`AC4 变异撞上池里已有的值（${collide.join(' / ')}）—— 这不是「池里没有的值」`);
  else ok(`AC4 变异的 ${TRIO.length} 块指纹在池里零重复（确实是「池里没有的值」）`);

  const r2 = gates.gateSkeleton(candidateFrom(write('t1173-bend2', arm(2))), pool);
  const msg2 = r2.problems.join(' ');
  const namesBase = msg2.includes(`"${BASE}"`);
  const says7 = /相同的 7 块是/.test(msg2);
  if (r2.pass === false && !r2.instrument && namesBase && says7) {
    ok(`AC4 改 2 块 ⟹ 必拒，报文点名 ${BASE} 和相同的 7 块`);
  } else {
    bad(`AC4 改 2 块没被拒成该有的样子：pass=${r2.pass} instrument=${r2.instrument} 点名${BASE}=${namesBase} 说7块=${says7} —— ${msg2}`);
  }

  const r3 = gates.gateSkeleton(candidateFrom(write('t1173-bend3', arm(3))), pool);
  const near3 = /距离 3 ≥ 3/.test(r3.note || '');
  if (r3.pass === true && near3) {
    ok(`AC4 改第 3 块 ⟹ 放行，报文里到最近那一套的距离正好是 3（${r3.note.split('·')[0].trim()}）`);
  } else {
    bad(`AC4 改 3 块没放行/距离不是 3：pass=${r3.pass} note=${r3.note} problems=${r3.problems.join(' ')}`);
  }
}

// ── 候选在 9 块里留空白 ⟹ 拒跑（那是「距离白涨」的漏洞，不是「离得远」）───────────────────────────
//
// 🔴 为什么这是一条拒跑而不是放行：空集的指纹跟每个有规则的池成员都不同，所以**少画一个块**会让
//    距离白涨一分。一个按判据优化的生成器最省事的做法正好是这个。
{
  const BASE = 'fern-10';
  const css = fs.readFileSync(sheetPathOf(BASE), 'utf-8');
  // 把 .card-group 的**裸规则**整块拿掉（连 @media 里那条），元素钩子留着 —— 于是这一块在这把尺下
  // 是空集，而 ②动态 那道「钩子有规则」照样过（它数的是钩子，不是裸 class）。
  const holed = css
    .replace(/^\.card-group \{[^}]*\}/m, '')
    .replace(/^\s*\.card-group \{[^}]*\}/gm, '');
  const fp = skel.fingerprintSheet(holed);
  if (!(fp.__empty || []).includes('card-group')) {
    bad('AC3 空白那一格的夹具没造出空白 —— 尺子读到的不是「空集」，这一格什么都没测');
  } else {
    const r = gates.gateSkeleton(candidateFrom(write('t1173-holed', holed)), pool);
    const msg = r.problems.join(' ');
    if (r.instrument === true && r.pass === false && msg.includes('card-group')) {
      ok('候选在 card-group 上留空白 ⟹ 报「量不到」拒跑，点名那一块');
    } else {
      bad(`候选留空白没被拒跑：pass=${r.pass} instrument=${r.instrument} note=${r.note} —— ${msg}`);
    }
  }
}

// ── 小批次里的骨架双胞胎要被【拦下】，不是被报成「量不到」（真机端到端抓到的那个洞）─────────────
//
// 🔴 这一格是一个**回归格**，形状是：`--pool new` 那条路上一批只有两套候选，而它们正是一对骨架
//    双胞胎（同一份表，只有调色板不同）。第一版把体检跑在「候选 + 池子」上，于是 9 块**全部**
//    distinct=1 —— 体检把「这一批有双胞胎」这个**发现本身**报成了「尺子坏了，拒跑」。
//    真机读数（`run.js --pool new`，两套候选）：第二套打的是
//    `🔴 没量成【⑤ 骨架距离】—— 这台机器缺东西，不是这套主题的问题`，而它该打的是「停在⑤」。
//    修法是把体检移到一份固定的参照语料（盘上所有主题表）上，理由整段在 skeleton-distance.js。
{
  const BASE = 'fern-10';
  const css = fs.readFileSync(sheetPathOf(BASE), 'utf-8');
  const twinPath = write('t1173-twin', css);
  // 池子里只有一套，而它跟候选是同一份表 ⟹ 距离 0，必须拦下。
  const onePool = { 'twin-01': { sheetPath: twinPath } };
  const r = gates.gateSkeleton(candidateFrom(twinPath), onePool);
  if (r.instrument) {
    bad(`小批次双胞胎被报成「量不到」（instrument=true）—— 那是把发现本身当成了仪器故障：${r.problems.join(' ')}`);
  } else if (r.pass === false && /距离 0/.test(r.problems.join(' '))) {
    ok('小批次（池里只有一套、且是同一份表）⟹ 停在⑤、报距离 0，而不是报「量不到」');
  } else {
    bad(`小批次双胞胎没被拦下：pass=${r.pass} note=${r.note} problems=${r.problems.join(' ')}`);
  }
}

// ── AC5 剥色可证 + 反向对照 ───────────────────────────────────────────────────────────────────────
//
// 🔴 后半条不许省。少了它，一把**把两边都抹平**的归一化器也能让前半条全绿（它让任何两份表的
//    距离都读成 0，而「只改颜色距离不变」在那把尺下当然成立）。
{
  const BASE = 'fern-10';
  const baseCss = fs.readFileSync(sheetPathOf(BASE), 'utf-8');
  const fpBase = skel.fingerprintSheet(baseCss);
  const dOf = (fp) => IDS.map((id) => `${id}:${skel.distance(fp, FP[id])}`).join(',');

  const painted = recolour(baseCss);
  if (painted === baseCss) {
    bad('AC5 换色那一臂没改动到文件 —— 尺子读到「相同」跟尺子瞎了一模一样');
  } else {
    const fpPainted = skel.fingerprintSheet(painted);
    if (dOf(fpPainted) === dOf(fpBase)) ok(`AC5 只改颜色/字体（改动 ${painted.length - baseCss.length} 字节）⟹ 对全池 80 个距离读数一字不变`);
    else {
      const moved = IDS.filter((id) => skel.distance(fpPainted, FP[id]) !== skel.distance(fpBase, FP[id]));
      bad(`AC5 只改颜色却让 ${moved.length} 个距离变了：${moved.slice(0, 5).join(' ')}`);
    }
  }

  const geom = bendGeometry(baseCss, 'card-group', 9);
  const fpGeom = skel.fingerprintSheet(geom);
  if (dOf(fpGeom) !== dOf(fpBase)) {
    const moved = IDS.filter((id) => skel.distance(fpGeom, FP[id]) !== skel.distance(fpBase, FP[id]));
    ok(`AC5 反向对照：只改一块的几何 ⟹ ${moved.length} 个距离读数跟着变`);
  } else {
    bad('AC5 反向对照失败：改了一块的几何，距离读数一个都没动 —— 这把尺把两边都抹平了');
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? '🔴' : '✅'} ⑤ 骨架距离：${pass} 过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
