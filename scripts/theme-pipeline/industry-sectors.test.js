#!/usr/bin/env node
/**
 * industry-sectors.test.js — 组邻接那张表的承重性质（#1119）。
 *
 * 跑法:  node scripts/theme-pipeline/industry-sectors.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * #1119 把「一个行业词能挑到多少套主题」从**词级匹配**换成了**组邻接**：候选 = 本组 5 套 + `partner`
 * 那组 5 套。于是那张 `partner` 表变成承重件，而它坏掉的四种方式**全部是静默的** —— 站照样建得出来，
 * 只是候选池悄悄变窄或者两个行业穿同一批皮：
 *   · 两组借同一组      → 被借那 5 套进 3 个组的池子（票 AC4 红），而没有任何东西会说话
 *   · 某组指向自己      → 那一组的池子长回 5 套（票 AC1 红）
 *   · 两组互相对借      → 那两组的候选集合逐字相同 ⟹ 对它们来说行业匹配等于取消了（票 AC5 红）
 *   · 上门那两组借到「没有带表单主题」的组 → `themes.js` #1114 那道兜底补进第 11 套 `azure-50`，
 *     它是 home-trades 的成员 ⟹ 又是 AC4
 * 再加两条同样静默的：某套主题归不进任何一组（它就**挑不到**了），某个行业词被归到别的组去。
 *
 * 所以它们落在这里：`npm run test:scripts` 按文件名发现它（不是清单），CI 的 template-scripts 那个
 * job 每次动 templates/nextjs 都跑，而 sync-template 等它 —— 红了新站就拿不到新模板。
 *
 * 🔴 每一格都配反向对照：判据本身写成「吃一张表、吐违例清单」的纯函数，然后拿**故意造坏的表**喂它，
 *    要求它当场点名。没有这一步的话，一个恒空的清单跟一张健康的表长得一模一样。
 */

'use strict';

const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let sectorsMod; let themesMod; let heroForm;
try {
  sectorsMod = require(path.join(DIR, 'industry-sectors.js'));
  themesMod = require(path.join(NEXT, 'scripts', 'themes.js'));
  heroForm = require(path.join(NEXT, 'scripts', 'lib', 'hero-lead-form.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const {
  SECTORS, THEMES_PER_SECTOR, themesForSector, sectorIndexForIndustry, sectorIndexOfTheme,
  sectorThemeIds,
} = sectorsMod;
const { poolThemes, candidateThemesForIndustry } = themesMod;
const { themeSupportsHeroForm } = heroForm;
const ALL_WORDS = SECTORS.flatMap((s) => s.words);

if (!SECTORS.length || !Object.keys(poolThemes).length) die('组表或池子是空的 —— 没东西可查，这不是通过');

// ── 判据（纯函数，吃一张表吐违例清单）──────────────────────────────────────────────────────────────
// 🔴 它们**只读传进来那张表**，一个模块级变量都不碰 —— 这是下面每一格都能配反向对照的前提。

/** 谁的 `partner.key` 指不到真组。 */
const danglingPartners = (sectors) => sectors
  .filter((s) => !s.partner || !sectors.some((x) => x.key === s.partner.key))
  .map((s) => s.key);

/** partner 表里被借了两次（或以上）的组 —— 违反「一对一」。 */
function borrowedTwice(sectors) {
  const times = new Map();
  sectors.forEach((s) => {
    const k = s.partner && s.partner.key;
    if (k) times.set(k, (times.get(k) || 0) + 1);
  });
  return [...times].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
}

/** 指向自己的组。 */
const selfLoops = (sectors) => sectors.filter((s) => s.partner && s.partner.key === s.key).map((s) => s.key);

/** 互相对借的两组（置换里长度 2 的环）。 */
function mutualPairs(sectors) {
  const partnerOf = new Map(sectors.map((s) => [s.key, s.partner && s.partner.key]));
  const out = [];
  sectors.forEach((s) => {
    const p = partnerOf.get(s.key);
    if (p && p !== s.key && partnerOf.get(p) === s.key && s.key < p) out.push(`${s.key} ⇄ ${p}`);
  });
  return out;
}

/** 缺邻接声明或缺理由的组（票 AC3）。 */
const missingWhy = (sectors) => sectors
  .filter((s) => !s.partner || !s.partner.key || !String(s.partner.why || '').trim())
  .map((s) => s.key);

/**
 * 上门那几组里，「自己 5 套 + partner 5 套」一套带表单的都没有的（票 §方案 约束②）。
 * 判「带不带表单」调的是 `lib/hero-lead-form.js` 那个权威，不在这里重写一遍。
 */
function onSiteWithoutForm(sectors, pool) {
  const { byIndex } = sectorThemeIds(pool, sectors);
  return sectors.filter((s, i) => {
    if (!s.onSite) return false;
    const j = sectors.findIndex((x) => x.key === (s.partner && s.partner.key));
    const ids = byIndex[i].concat(j >= 0 ? byIndex[j] : []);
    return !ids.some((id) => pool[id] && themeSupportsHeroForm(pool[id]));
  }).map((s) => `${s.key}→${s.partner ? s.partner.key : '(没写)'}`);
}

// ── ① 每套主题归得进恰好一个行业组 ────────────────────────────────────────────────────────────────
// 归不进的那些**挑不到**：组邻接这条路只按组成员取，它们不在任何一组里 ⟹ 从此没有任何行业词能抽到
// 它。而池子的分布、覆盖度那张表都看不见这件事（它们统计的是词，不是归属）。
console.log('\n── ① 每套主题各归一组：每组的套数等于它自己声明的那个数，没有一套落在组外');
{
  const { byIndex, orphans } = sectorThemeIds(poolThemes);
  const sizes = byIndex.map((ids) => ids.length);
  // 🔴 #1174 —— 判据从「都等于 THEMES_PER_SECTOR」换成「逐组等于它自己那个数」。
  //    换掉的理由：地产、保险自有套数是 16，其余 14 组仍是 5；拿一个常数去比，那两组当场红两格，
  //    而它们是本票要的形状。判据的来源仍然只有一处（`themesForSector`），没有在这里抄第二份。
  const want = SECTORS.map((sec) => themesForSector(sec.key));
  const wrong = sizes.filter((n, i) => n !== want[i]).length;
  if (!orphans.length && !wrong) {
    ok(`${Object.keys(poolThemes).length} 套逐套归队：${SECTORS.length} 组各自 ${want.join(',')} 套，组外 0 套`);
  } else {
    bad(`组外 ${orphans.length} 套（${orphans.slice(0, 8).join(' ')}）· 套数对不上的组 ${wrong} 个：量到 ${sizes.join(',')} / 该是 ${want.join(',')}`);
  }

  // 反向对照：一套主题的 `industries` 跨两组 ⟹ 归属不唯一，必须判 -1（而不是随手挑一个）。
  const crossed = { industries: [SECTORS[0].words[0], SECTORS[1].words[0]] };
  const empty = { industries: [] };
  if (sectorIndexOfTheme(crossed) === -1 && sectorIndexOfTheme(empty) === -1) {
    ok('反向对照：industries 跨两组的假主题、和一个词都没声明的假主题，都被判成「归不进」');
  } else {
    bad(`反向对照失效：跨组假主题判成 ${sectorIndexOfTheme(crossed)}、空声明判成 ${sectorIndexOfTheme(empty)}`);
  }

  // 反向对照：把一组从组表里摘掉（造一张少一组的表）⟹ 那一组的主题当场变成组外的。
  // 🔴 #1174 —— 期望值从常数换成【被摘掉那一组自己的套数】。摘的仍然是 `tech-media`（5 套），
  //    所以这一格的读数与改之前逐字相同；换成按组取，是为了摘掉一个 16 套的组时它也答得对。
  const DROPPED = 'tech-media';
  const short = SECTORS.filter((s) => s.key !== DROPPED);
  const strayed = sectorThemeIds(poolThemes, short).orphans.length;
  const wantStrayed = themesForSector(DROPPED);
  if (strayed === wantStrayed) ok(`反向对照：组表少一组（${DROPPED}）⟹ 当场数出 ${strayed} 套落在组外`);
  else bad(`反向对照失效：组表少一组时组外只数出 ${strayed} 套，本该是 ${wantStrayed}`);
}

// ── ② partner 表是 16 组的一个置换（一对一 · 不指自己 · 不对借）─────────────────────────────────
console.log('\n── ② partner 表：一对一、不指自己、不互相对借');
{
  const dangling = danglingPartners(SECTORS);
  const twice = borrowedTwice(SECTORS);
  const loops = selfLoops(SECTORS);
  const mutual = mutualPairs(SECTORS);
  if (!dangling.length && !twice.length && !loops.length && !mutual.length) {
    ok(`${SECTORS.length} 组各借一组，每组恰好被借一次；指不到的 0 个 · 指自己的 0 个 · 对借的 0 对`);
  } else {
    bad(`指不到真组的：${dangling.join(' ') || '无'} · 被借两次的：${twice.join(' ') || '无'}`
      + ` · 指自己的：${loops.join(' ') || '无'} · 对借的：${mutual.join(' ') || '无'}`);
  }

  // 反向对照：三张各坏一处的表，要求三条判据**各自**点名（一条一条驱动，不混在一起 —— 混在一起
  // 时「都红了」分不清是哪条判据在说话）。
  const clone = () => SECTORS.map((s) => ({ ...s, partner: { ...s.partner } }));
  const nonInjective = clone(); nonInjective[12].partner.key = nonInjective[11].partner.key;
  const withSelf = clone(); withSelf[5].partner.key = withSelf[5].key;
  const withMutual = clone();
  withMutual[0].partner.key = withMutual[1].key; withMutual[1].partner.key = withMutual[0].key;
  const drivers = [
    ['一对一', borrowedTwice(nonInjective).length, borrowedTwice(SECTORS).length],
    ['不指自己', selfLoops(withSelf).length, selfLoops(SECTORS).length],
    ['不对借', mutualPairs(withMutual).length, mutualPairs(SECTORS).length],
  ];
  const mute = drivers.filter(([, broken, clean]) => !(broken > 0 && clean === 0));
  if (!mute.length) {
    ok(`反向对照：三张各坏一处的表，三条判据分别点名 ${drivers.map(([n, b]) => `${n}:${b}`).join(' · ')}（真表上都是 0）`);
  } else {
    bad(`这几条判据没牙：${mute.map(([n, b, c]) => `${n}(坏表 ${b} / 真表 ${c})`).join(' · ')}`);
  }
}

// ── ③ 上门那两组必须借到「有带表单主题」的组（#1114 那道兜底的耦合）───────────────────────────────
// 借不到 ⟹ 兜底补进第 11 套 azure-50，而它是 home-trades 的成员 ⟹ 它进 3 个组的池子，票 AC4 红。
console.log('\n── ③ 上门的行业组：本组 + partner 里至少有一套带表单的主题');
{
  const starved = onSiteWithoutForm(SECTORS, poolThemes);
  const onSiteKeys = SECTORS.filter((s) => s.onSite).map((s) => s.key);
  if (!starved.length) ok(`上门 ${onSiteKeys.length} 组（${onSiteKeys.join(' · ')}）逐组：10 套里都有带表单的`);
  else bad(`这几组借完还是一套带表单的都没有 ⟹ #1114 那道兜底会补进第 11 套：${starved.join(' · ')}`);

  // 反向对照：把 green-outdoor 的 partner 换成一个不带表单的组（tech-media）⟹ 必须点名它。
  const starve = SECTORS.map((s) => ({ ...s, partner: { ...s.partner } }));
  starve[10].partner.key = 'tech-media';
  const caught = onSiteWithoutForm(starve, poolThemes);
  if (caught.length === 1 && caught[0].startsWith('green-outdoor')) {
    ok(`反向对照：把 green-outdoor 指向不带表单的 tech-media ⟹ 当场点名（${caught[0]}）`);
  } else {
    bad(`反向对照失效：造了一张会饿死 green-outdoor 的表，判据点名的是 ${caught.join(' · ') || '(没人)'}`);
  }
}

// ── ④ 每组一条邻接声明 + 气质相容理由（票 AC3）────────────────────────────────────────────────────
console.log('\n── ④ 16 组逐一：借哪一组 + 为什么这两种气质能穿同一批皮');
{
  const noWhy = missingWhy(SECTORS);
  if (!noWhy.length) {
    const shortest = SECTORS.reduce((a, s) => (s.partner.why.length < a.partner.why.length ? s : a));
    ok(`${SECTORS.length} 组都写了 partner + 理由（最短那条 ${shortest.partner.why.length} 字：${shortest.key}）`);
  } else {
    bad(`这几组缺邻接声明或缺理由：${noWhy.join(' · ')}`);
  }

  // 反向对照：理由写成空白 ⟹ 当场点名（`why: '   '` 跟没写是一回事）。
  const blank = SECTORS.map((s) => ({ ...s, partner: { ...s.partner } }));
  blank[3].partner.why = '   ';
  const caught = missingWhy(blank);
  if (caught.length === 1 && caught[0] === SECTORS[3].key) ok(`反向对照：把 ${SECTORS[3].key} 的理由改成空白 ⟹ 当场点名`);
  else bad(`反向对照失效：理由写成空白时点名的是 ${caught.join(' · ') || '(没人)'}`);
}

// ── ⑤ 212 个行业词，每个都归到【自己那一组】────────────────────────────────────────────────────────
// 归错组的后果不是「少几套」而是 AC4 红：那个词会把别组的 10 套拉进本组的池子。
console.log('\n── ⑤ 212 个行业词逐个：sectorIndexForIndustry 认出的就是它自己那一组');
{
  const strayed = [];
  SECTORS.forEach((s, i) => s.words.forEach((w) => {
    const got = sectorIndexForIndustry(w);
    if (got !== i) strayed.push(`${w}: ${s.key} → ${got < 0 ? '(认不出)' : SECTORS[got].key}`);
  }));
  if (!strayed.length) ok(`${ALL_WORDS.length} 个词逐个归位，跑错组的 0 个`);
  else bad(`${strayed.length} 个词被归到别的组去了：${strayed.slice(0, 8).join(' · ')}`);

  // 多组同时命中时那三级裁法，各驱动一个读数（它是承重的：只答一个组才使 AC4 成立）。
  const bySameCount = sectorIndexForIndustry('interior design');       // ① 长短语赢：房产 vs 科技的 design
  const byCount = sectorIndexForIndustry('wedding photography cafe');  // ② 命中词多的赢：婚庆 2 个 vs 烘焙 1 个
  const byOrder = sectorIndexForIndustry('security software');         // ③ 还平就取注册靠前的：安防(12) < 科技(13)
  const want = ['real-estate', 'events', 'industrial-safety'];
  const got = [bySameCount, byCount, byOrder].map((i) => (i < 0 ? '(认不出)' : SECTORS[i].key));
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok(`裁法三级各一个读数：interior design→${got[0]} · wedding photography cafe→${got[1]} · security software→${got[2]}`);
  } else {
    bad(`裁法读数变了：拿到 ${got.join(' · ')}，本该是 ${want.join(' · ')}`);
  }

  // 认不出组的那条路必须还在（自由文本走它 + NEUTRAL_TOPUP 兜底，那是兜底今天唯一真开火处）。
  const free = ['', 'quantum widgets', '汽车维修'].map((w) => sectorIndexForIndustry(w));
  if (free.every((i) => i === -1)) ok('自由文本（空串 / quantum widgets / 汽车维修）三个都认不出组 ⟹ 落回子串匹配那条路');
  else bad(`自由文本被认成了组：${free.join(',')} —— 那条落回的路（和它上面的兜底）就不再被走到了`);
}

// ── ⑥ 票的三条读数：候选池 ≥10（AC1）· 没有主题进 ≥3 个组（AC4）· 任意两组集合不等（AC5）──────────
console.log('\n── ⑥ AC1 / AC4 / AC5：拿产品自己那个挑选函数跑');
{
  // 三把尺，两条臂共用：真臂 = 产品函数 candidateThemesForIndustry；对照臂 = 只给本组那 5 套。
  const poolsOf = (candidates) => SECTORS.map((s) => new Set(s.words.flatMap((w) => candidates(w))));
  const thin = (candidates) => ALL_WORDS.filter((w) => candidates(w).length < 10);
  const crowded = (groups) => {
    const times = new Map();
    groups.forEach((g) => g.forEach((id) => times.set(id, (times.get(id) || 0) + 1)));
    return [...times].filter(([, n]) => n >= 3).map(([id, n]) => `${id}(${n})`);
  };
  const twins = (groups) => {
    const key = (g) => [...g].sort().join(',');
    const out = [];
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (key(groups[i]) === key(groups[j])) out.push(`${SECTORS[i].key}=${SECTORS[j].key}`);
      }
    }
    return out;
  };

  const real = poolsOf(candidateThemesForIndustry);
  const thinWords = thin(candidateThemesForIndustry);
  if (!thinWords.length) ok(`AC1：${ALL_WORDS.length} 个词的候选池都 ≥10（各组池子 ${real.map((g) => g.size).join(',')}）`);
  else bad(`AC1：${thinWords.length} 个词的候选池不到 10：${thinWords.slice(0, 10).join(' ')}`);

  const over = crowded(real);
  if (!over.length) ok('AC4：没有一套主题出现在 3 个及以上行业组的候选池里');
  else bad(`AC4：这几套进了 3 个及以上的组：${over.join(' ')}`);

  const same = twins(real);
  if (!same.length) ok('AC5：16 组两两比过，候选集合相等的组对 0 对');
  else bad(`AC5：这几对组的候选集合完全相同 ⟹ 行业匹配对它们等于取消了：${same.join(' ')}`);

  // 反向对照：拿掉邻接（只给本组自有那几套）喂**同样这三把尺** ⟹ AC1 必须当场红。尺子读不出不同的
  // 时候，上面三行绿说明不了任何事。
  //
  // 🔴 #1174 —— 期望值从 `ALL_WORDS.length` 换成【自有套数不到 10 的那些组的词数】，而且是从
  //    `themesForSector` 现算的、不写死。理由：地产、保险自有 16 套，拿掉邻接它们仍然 ≥10 ⟹ 那
  //    27 个词不再算不到 10。写死 185 也能绿，但下一次改套数它又是假的，而失败方向是**绿**
  //    （期望值和实测值一起漂，这一格就再也读不出差别了）。
  const { byIndex } = sectorThemeIds(poolThemes);
  const ownOnly = (w) => { const i = sectorIndexForIndustry(w); return i < 0 ? [] : byIndex[i]; };
  const thinNoAdj = thin(ownOnly).length;
  const wantThin = SECTORS
    .filter((sec) => themesForSector(sec.key) < 10)
    .reduce((n, sec) => n + sec.words.length, 0);
  if (thinNoAdj === wantThin && wantThin > 0) {
    ok(`反向对照：把邻接拿掉（只给本组自有那几套）⟹ 同一把尺当场数出 ${thinNoAdj} 个词不到 10`
      + `（自有 ≥10 的组共 ${ALL_WORDS.length - wantThin} 个词本来就够，不算在内）`);
  } else if (wantThin === 0) {
    bad('反向对照失效：每一组自有都 ≥10 套了 ⟹ 拿掉邻接也没有词会红，这一格从此读不出差别');
  } else {
    bad(`反向对照失效：拿掉邻接之后只数出 ${thinNoAdj} 个词不到 10，本该是 ${wantThin} —— 这把尺读不出差别`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
