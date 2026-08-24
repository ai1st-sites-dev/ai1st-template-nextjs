#!/usr/bin/env node
'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hero-twins.js — 一个行业组的候选池里，有几对主题的第一屏长得一样（#1174 AC4）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-pipeline/hero-twins.js --calibrate                # 🔴 先跑这个：尺子标定
//   node scripts/theme-pipeline/hero-twins.js                            # 全部 16 组
//   node scripts/theme-pipeline/hero-twins.js real-estate finance-insurance
//   node scripts/theme-pipeline/hero-twins.js --pool /tmp/p.json --themes-dir /tmp/themes
//
// 退出码：0 = 量完了（读数要人看，它不判好坏）· 1 = `--calibrate` 没过 · 2 = 跑不起来。
//
// ══ 它回答的那个问题 ═══════════════════════════════════════════════════════════════════════════
// 扩池的风险不是「表的字节撞了」，是**同一个行业的老板翻卡时看到两张一样的第一屏**。所以量的
// 单位是**候选池**（本组自有 + 伙伴组自有），不是全池 —— 全池里两套 hero 相同、而它们从不出现在
// 同一个池子里，那对老板不产生任何观感。
//
// ══ 🔴 尺子是哪一把，以及为什么不是 sheet-recipes.test.js ⑫ 那把 ═══════════════════════════════
// 这个文件第一版 require 了 `skeleton.js`（⑫ 那把「骨架指纹」，#1139 立的），理由写成「同一个
// 问题必须同一把尺」。**那是错的，而错的方向是把二十几对撞车报成不撞。** 两把尺读的不是同一件事：
//
//   · ⑫ 那把只留**决定几何**的声明（`GEOM_PROPS`：display / grid-template-columns / order …）。
//     hero 只有 8 副画法，几何就那 8 种 ⟹ 它对全池（无论 80 还是 97 套）只读出 **8 种**，凡是同一副画法的
//     两套都被判成「一样」。用它答 AC4，保险组会报出 51 对撞车 —— 那 51 对里绝大多数只是同画法，
//     字号、留白、间距全都不同，老板一眼能分开。
//   · 本票（正文 + PM 裁定）的基线读数用的是另一把：**抠出所有 `.hero*` 规则，把颜色和字体的【值】
//     换成占位符**，其余（留白、min-height、gap、aspect-ratio…）原样留着。它对全池读出 **32 种**。
//
// 🔴 判据是**标定**，不是这段说明：`--calibrate` 拿正文和 PM 各自独立量出来的那批数当靶子跑一遍。
//    靶子（都取自 `origin/main` d2a54bb7 的 80 套池子）：
//      · 地产旧候选池 10 套 → 指纹 6 种，相同的恰好是被点名的那 4 对
//      · 保险旧候选池 10 套 → 指纹 10 种，0 对
//      · 位子序号相隔 64 的 16 对 → 指纹 16 对全相同（「周期 64」那条）
//    三条全过才算这把尺读的是正文那批数所在的那一维。不过就 rc=1，别拿它的读数下结论。
//
// 📌 **正文里有一句要更正**（#1174 DEV 实测，正文冻结不改，读到这里的人按这条）：正文写
//    `lime-15` / `indigo-79`「连剥都不用就逐字相同」。实际是 **10 条 hero 规则里 9 条逐字相同，
//    第 10 条 `.hero__title` 差两个声明**（`font-weight: 900` vs `700` · `letter-spacing: -0.02em`
//    vs `0`）。两个都是字体类 ⟹ 在上面那把尺下它们指纹相同（所以那 4 对的结论不动），但**没有
//    哪一对是逐字相同**。下面「逐字相同」那一列因此恒为 0，不是它坏了。
//
// ══ 「相同」的两个口径，两个都打出来 ═══════════════════════════════════════════════════════════
//    · **指纹相同** —— 剥掉颜色字体的值之后一样。这是产品面那个问题的答案（同一副排版同一套留白，
//      只有颜色不同）。AC4 判的是这一档。
//    · **逐字相同** —— 连颜色令牌都一样。它是前者的子集，单独打出来是因为这一档更刺眼。
const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');
const postcss = require('postcss');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

// 颜色类 / 字体类的属性：它们的**值**换成占位符。加减这两张表会改动读数 ⟹ 改完必须重跑
// `--calibrate`，三条靶子还得全过。
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-\w+|border-\w+-color|box-shadow|fill|stroke|outline|outline-color|text-shadow|opacity|backdrop-filter|filter)$/;
const FONT_PROPS = /^(font|font-family|font-weight|font-size|letter-spacing|line-height|text-transform)$/;

/** 一份表的 hero 指纹（颜色字体的值已换成占位符）。 */
function heroFingerprint(css) {
  const out = [];
  postcss.parse(css).walkRules((rule) => {
    if (!/\.hero/.test(rule.selector)) return;
    const decls = rule.nodes.filter((n) => n.type === 'decl').map((d) => {
      let v = d.value.trim();
      if (COLOR_PROPS.test(d.prop)) v = '<C>';
      else if (FONT_PROPS.test(d.prop)) v = '<F>';
      // 属性本身不是颜色/字体类，值里却嵌着颜色令牌（如 `linear-gradient(... var(--color-…))`）
      else {
        v = v.replace(/var\(--color-[^)]*\)/g, '<C>')
          .replace(/#[0-9a-fA-F]{3,8}\b/g, '<C>')
          .replace(/rgba?\([^)]*\)/g, '<C>');
      }
      return `${d.prop}:${v}`;
    }).sort();
    const at = rule.parent && rule.parent.type === 'atrule'
      ? `@${rule.parent.name} ${rule.parent.params} ` : '';
    out.push(`${at}${rule.selector.trim()}{${decls.join(';')}}`);
  });
  return out.sort().join('\n');
}

/**
 * 一份表的 hero 规则原文（注释先剥掉）。
 * 🔴 注释必须剥：表头那行 `gen-07-15` / `gen-07-79` 带着**位子序号**，不剥的话任何两套都「不同」，
 *    而那个不同跟第一屏长相无关 —— 这条尺子就永远读 0，看起来像是「没有逐字相同的」。
 */
function heroRaw(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    const sel = m[1].trim();
    if (/\.hero/.test(sel)) out.push(`${sel}{${m[2]}}`);
  }
  return out.join('\n');
}

let SECTORS; let themesForSector; let poolSlots;
try {
  ({ SECTORS, themesForSector, poolSlots } = require('./industry-sectors.js'));
} catch (e) {
  console.error(`🔴 跑不起来: require 失败 ${e.message}`);
  process.exit(2);
}

/** 把一份池子读成 { ids, 每套的指纹/原文, 每组自有的 id }。 */
function load(poolPath, themesDir) {
  let pool;
  try {
    pool = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
  } catch (e) {
    console.error(`🔴 跑不起来: 读不到池子 ${poolPath}：${e.message}`);
    process.exit(2);
  }
  const ids = Object.keys(pool);
  const fp = {}; const raw = {};
  for (const id of ids) {
    const sheet = path.join(themesDir, `${pool[id].sheet}.css`);
    let css;
    try {
      css = fs.readFileSync(sheet, 'utf-8');
    } catch (e) {
      console.error(`🔴 跑不起来: ${id} 的表读不到（${sheet}）：${e.message}`);
      process.exit(2);
    }
    fp[id] = heroFingerprint(css);
    raw[id] = heroRaw(css);
  }
  return { pool, ids, fp, raw };
}

/** 一个组的候选池 = 本组自有 + 伙伴组自有，按**位子归属**取（不按 `industries` 反查 —— 那是另一条推导）。 */
function candidatesOf(ids, slots, key) {
  const ownOf = {};
  slots.forEach((s, i) => { (ownOf[s.sectorKey] = ownOf[s.sectorKey] || []).push(ids[i]); });
  const sec = SECTORS.find((s) => s.key === key);
  return {
    own: ownOf[key] || [],
    partner: (sec.partner && ownOf[sec.partner.key]) || [],
    partnerKey: sec.partner ? sec.partner.key : '(没写)',
  };
}

function twinsIn(list, fp, raw) {
  const skel = []; const exact = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (fp[list[i]] !== fp[list[j]]) continue;
      skel.push(`${list[i]}/${list[j]}`);
      if (raw[list[i]] === raw[list[j]]) exact.push(`${list[i]}/${list[j]}`);
    }
  }
  return { skel, exact };
}

// ── --calibrate：这把尺读的是正文那批数所在的那一维吗 ────────────────────────────────────────────
if (process.argv.includes('--calibrate')) {
  const cp = require('child_process');
  const BASE = arg('--base', 'd2a54bb7');
  const REPO = path.resolve(NEXT, '..', '..');
  let oldPool;
  try {
    oldPool = JSON.parse(cp.execSync(`git show ${BASE}:templates/nextjs/scripts/theme-pool.json`,
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1e9 }));
  } catch (e) {
    console.error(`🔴 标定跑不起来: 取不到 ${BASE} 的池子：${e.message}`);
    process.exit(2);
  }
  const ids = Object.keys(oldPool);
  // 🔴 表的字节从 `${BASE}` 取，不读工作树 —— 靶子是那一天的读数，拿今天的表去打靶就不是标定了。
  const fp = {}; const raw = {};
  for (const id of ids) {
    const css = cp.execSync(`git show ${BASE}:templates/nextjs/public/themes/${oldPool[id].sheet}.css`,
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1e9 });
    fp[id] = heroFingerprint(css); raw[id] = heroRaw(css);
  }
  // 那一天的位子表是「16 组 × 5」，不能用今天的 poolSlots()（#1174 之后它有 97 个位子）。
  const PER = 5;
  const ownAt = (key) => {
    const si = SECTORS.findIndex((s) => s.key === key);
    return ids.slice(si * PER, si * PER + PER);
  };
  const fails = [];
  const check = (name, got, want) => {
    const okv = JSON.stringify(got) === JSON.stringify(want);
    console.log(`  ${okv ? '✅' : '🔴'} ${name}：量到 ${JSON.stringify(got)}${okv ? '' : ` / 靶子 ${JSON.stringify(want)}`}`);
    if (!okv) fails.push(name);
  };
  console.log(`标定（靶子取自 ${BASE} 的 ${ids.length} 套，正文与 PM 各自独立量过）`);
  for (const [key, wantKinds, wantPairs] of [
    ['real-estate', 6, ['ember-12/teal-76', 'jade-13/rose-77', 'magenta-14/fern-78', 'lime-15/indigo-79']],
    ['finance-insurance', 10, []],
  ]) {
    const sec = SECTORS.find((s) => s.key === key);
    const list = ownAt(key).concat(ownAt(sec.partner.key));
    const t = twinsIn(list, fp, raw);
    check(`${key} 旧候选 ${list.length} 套的指纹种数`, new Set(list.map((i) => fp[i])).size, wantKinds);
    check(`${key} 指纹相同的对子`, t.skel, wantPairs);
  }
  let same = 0; let pairs = 0;
  for (let i = 0; i + 64 < ids.length; i += 1) { pairs += 1; if (fp[ids[i]] === fp[ids[i + 64]]) same += 1; }
  check('位子相隔 64 的对子里指纹相同的（周期 64）', [same, pairs], [16, 16]);
  // 阳性对照：把一套的 hero 留白改一个数 ⟹ 它必须从原来那一类里掉出来（尺子得有牙）
  {
    const victim = 'teal-76';
    const css = cp.execSync(`git show ${BASE}:templates/nextjs/public/themes/${oldPool[victim].sheet}.css`,
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1e9 });
    const hacked = css.replace(/(\.hero\s*\{[^}]*?min-height:\s*)([\d.]+)(rem)/, (_, a, n, u) => `${a}${Number(n) + 1}${u}`);
    if (hacked === css) {
      console.log('  🔴 阳性对照做不成：teal-76 的 .hero 里没找到 min-height，改不动 ⟹ 下面那些绿说明不了尺子有牙');
      fails.push('阳性对照');
    } else {
      const moved = heroFingerprint(hacked) !== fp[victim] && heroFingerprint(hacked) !== fp['ember-12'];
      console.log(`  ${moved ? '✅' : '🔴'} 阳性对照：把 teal-76 的 .hero min-height 加 1rem ⟹ `
        + `它的指纹${moved ? '当场变了（不再等于 ember-12）' : '没变 —— 这把尺读不出留白，AC4 的绿是白给的'}`);
      if (!moved) fails.push('阳性对照');
    }
  }
  console.log(fails.length ? `\n🔴 标定没过：${fails.join(' · ')}` : '\n✅ 标定全过 —— 这把尺读的就是正文那批数所在的那一维');
  process.exit(fails.length ? 1 : 0);
}

// ── 正常量一次 ──────────────────────────────────────────────────────────────────────────────────
const poolPath = path.resolve(arg('--pool', path.join(NEXT, 'scripts', 'theme-pool.json')));
const themesDir = path.resolve(arg('--themes-dir', path.join(NEXT, 'public', 'themes')));
const { ids, fp, raw } = load(poolPath, themesDir);
const slots = poolSlots();
if (ids.length !== slots.length) {
  console.error(`🔴 跑不起来: 池子 ${ids.length} 套、位子表 ${slots.length} 个 —— 对不上就分不清谁属于哪一组`);
  process.exit(2);
}

const want = process.argv.slice(2).filter((a) => !a.startsWith('--')
  && SECTORS.some((s) => s.key === a));
const bogus = process.argv.slice(2).filter((a) => !a.startsWith('--')
  && !SECTORS.some((s) => s.key === a) && !/[/.]/.test(a));
if (bogus.length) {
  console.error(`🔴 跑不起来: 这些组名不认识：${bogus.join(' ')}`);
  process.exit(2);
}
const targets = want.length ? SECTORS.filter((s) => want.includes(s.key)) : SECTORS;

console.log(`池子 ${ids.length} 套 · 表在 ${themesDir}`);
console.log(`全池 hero 指纹 ${new Set(ids.map((i) => fp[i])).size} 种 / ${ids.length} 套`
  + '　（这个数是上界：任何一个候选池超过它，按鸽笼必然有对子撞上）');
for (const sec of targets) {
  const { own, partner, partnerKey } = candidatesOf(ids, slots, sec.key);
  const list = own.concat(partner);
  const t = twinsIn(list, fp, raw);
  console.log(`\n${sec.key}  候选 ${list.length} 套`
    + `（自有 ${own.length}／声明 ${themesForSector(sec.key)}　借 ${partnerKey} ${partner.length} 套）`);
  console.log(`  hero 指纹 ${new Set(list.map((i) => fp[i])).size} 种 / ${list.length} 套`
    + `　指纹相同的对子 ${t.skel.length}　其中连颜色都逐字相同的 ${t.exact.length}`);
  if (t.skel.length) console.log(`    指纹相同：${t.skel.join(' · ')}`);
  if (t.exact.length) console.log(`    逐字相同：${t.exact.join(' · ')}`);
}
