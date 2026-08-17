#!/usr/bin/env node
/**
 * pool.test.js — 主题池的六条承重性质（#1016）。
 *
 * 跑法:  node scripts/theme-pipeline/pool.test.js
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * #1016 的验收标准里有四条是**关于这一池数据的**（行业覆盖度、旧池退役、layout→supports、词表不缩）。
 * 交付那天跑一遍是容易的，难的是**下一次有人动这池数据时它们还成立** —— 而这四条的失败方向全部是
 * 静默的：
 *   · 少几个行业词      → 覆盖度那张表照样全绿（它统计的是池子自己有的词，缩词表反而让分布更好看）
 *   · 退役的 id 漏在池里 → 新站抽到一套本该退役的皮，没有任何东西会说话
 *   · supports 没翻     → `layoutFor()` 返回 {}，这套主题静默地对每个块都没有意见
 *   · 每套多塞十几个词  → 覆盖度当场变绿，产品面零变化
 * 所以它们落在这里：`npm run test:scripts` 会发现它（按文件名，不是清单），CI 的 template-scripts
 * 那个 job 每次动 templates/nextjs 都跑。同 #1034 r2 给 homepage-recipe.test.js 接调用方那次。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let themesMod; let surveyCoverage; let verifyPool; let sectors;
try {
  themesMod = require(path.join(NEXT, 'scripts', 'themes.js'));
  ({ surveyCoverage } = require(path.join(DIR, 'coverage.js')));
  ({ verifyPool } = require(path.join(DIR, 'promote.js')));
  sectors = require(path.join(DIR, 'industry-sectors.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const { poolThemes, retiredThemes, themes } = themesMod;
const poolIds = Object.keys(poolThemes);
const retiredIds = Object.keys(retiredThemes);

if (!poolIds.length || !retiredIds.length) die('池子或退役表是空的 —— 没东西可查，这不是通过');

// ── ① 行业覆盖度（AC2）──────────────────────────────────────────────────────────────────────────
// 判据与 `coverage.js --max-thin-pools 0 --max-thin-hits 0` 逐字同源：调的就是它那个函数。
console.log('\n── ① 行业覆盖度：每个行业词至少 4 套真命中');
{
  const s = surveyCoverage();
  const line = `${s.themeCount} 套 · ${s.keywordCount} 个词 · 候选池 ${JSON.stringify(s.poolDistribution)}`
    + ` · 真命中 ${JSON.stringify(s.hitDistribution)}`;
  if (s.thinPools === 0 && s.thinHits === 0) ok(`${line}（薄格子 0 个）`);
  else bad(`${line} —— 候选池 == ${s.minRotationPool} 的 ${s.thinPools} 个 · 真命中 == 1 的 ${s.thinHits} 个`);
}

// ── ② 词表不许缩（AC2 的另一半）─────────────────────────────────────────────────────────────────
// 🔴 覆盖度那张表**看不见**这件事：关键词全集是从池子自己的 `industries` 并起来的，删掉一个词，
//    那个词就从分母里消失，分布只会更好看。而线上的后果是「今天匹配得上的生意明天落进兜底」。
console.log('\n── ② 词表是退役那 30 套的超集，一个词都没少');
{
  const oldWords = [...new Set(retiredIds.flatMap((id) => retiredThemes[id].industries || []))];
  const newWords = new Set(poolIds.flatMap((id) => poolThemes[id].industries || []));
  const missing = oldWords.filter((w) => !newWords.has(w));
  if (!missing.length) ok(`旧词 ${oldWords.length} 个，新池全都有（新池 ${newWords.size} 个）`);
  else bad(`新池少了 ${missing.length} 个旧行业词：${missing.slice(0, 12).join(' · ')}${missing.length > 12 ? ' …' : ''}`);
}

// ── ③ 覆盖度不许靠「每套多塞几个词」凑（AC2 写死的两个分布）────────────────────────────────────
console.log('\n── ③ 每套声明的行业数 / 每套的真命中对数，都不比退役那 30 套宽');
{
  const stat = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return {
      min: s[0], max: s[s.length - 1], med: s[Math.floor(s.length / 2)],
      avg: s.reduce((a, b) => a + b, 0) / s.length,
    };
  };
  const declOld = stat(retiredIds.map((id) => (retiredThemes[id].industries || []).length));
  const declNew = stat(poolIds.map((id) => (poolThemes[id].industries || []).length));
  // 真命中对数 = 这套主题能命中几个行业词（含「声明词是查询词的子串」那部分）。
  const hitsOf = (pool, ids, vocab) => ids.map((id) => vocab
    .filter((w) => (pool[id].industries || []).some((kw) => w.toLowerCase().includes(kw))).length);
  const oldVocab = [...new Set(retiredIds.flatMap((id) => retiredThemes[id].industries || []))];
  const newVocab = [...new Set(poolIds.flatMap((id) => poolThemes[id].industries || []))];
  const hitOld = stat(hitsOf(retiredThemes, retiredIds, oldVocab));
  const hitNew = stat(hitsOf(poolThemes, poolIds, newVocab));
  const fmt = (s) => `min ${s.min} / 中位 ${s.med} / max ${s.max} / 平均 ${s.avg.toFixed(2)}`;
  if (declNew.avg <= declOld.avg && declNew.max <= declOld.max) {
    ok(`声明数 新池 ${fmt(declNew)} ≤ 旧池 ${fmt(declOld)}`);
  } else {
    bad(`声明数 新池 ${fmt(declNew)} 比旧池 ${fmt(declOld)} 宽 —— 缺口要靠套数补，不是靠每套多声明`);
  }
  if (hitNew.avg <= hitOld.avg) ok(`真命中对数 新池 ${fmt(hitNew)} ≤ 旧池 ${fmt(hitOld)}`);
  else bad(`真命中对数 新池 ${fmt(hitNew)} 比旧池 ${fmt(hitOld)} 宽（声明词越短越通用，这个数越容易被撑大）`);
}

// ── ④ 旧 30 套退役（AC4）────────────────────────────────────────────────────────────────────────
console.log('\n── ④ 退役的 30 套：新建网站一套都抽不到，而定义一个字都没删');
{
  const vocab = [...new Set(poolIds.flatMap((id) => poolThemes[id].industries || [])
    .concat(retiredIds.flatMap((id) => retiredThemes[id].industries || [])))];
  // 探的是**两边词表的并集**：只探新池自己的词，就问不到「旧池的某个词今天会兜出什么」。
  const leaked = new Set();
  for (const w of vocab.concat(['', 'quantum widgets', '汽车维修'])) {
    for (const id of themesMod.candidateThemesForIndustry(w)) if (retiredThemes[id]) leaked.add(id);
  }
  if (!leaked.size) ok(`${vocab.length} 个行业词逐个跑 candidateThemesForIndustry()，退役 id 出现 0 次`);
  else bad(`退役的 id 仍然会被新站抽到：${[...leaked].join(' · ')}`);

  if (retiredIds.length === 30) ok('退役表仍是 30 套（文件在 scripts/themes-retired.js，没删）');
  else bad(`退役表现在是 ${retiredIds.length} 套，不是 30 —— 有人删了已经上线的站在穿的皮`);

  const notLookupable = retiredIds.filter((id) => !themes[id]);
  if (!notLookupable.length) ok('30 套仍然按 id 查得到（sync-config 的 applied 分支要用）');
  else bad(`这几套按 id 查不到了，穿着它们的站会建不出来：${notLookupable.join(' · ')}`);

  const topupOutside = themesMod.NEUTRAL_TOPUP
    ? themesMod.NEUTRAL_TOPUP.filter((id) => !poolThemes[id]) : ['(没导出 NEUTRAL_TOPUP)'];
  if (!topupOutside.length) ok('NEUTRAL_TOPUP 四套都在新池里');
  else bad(`NEUTRAL_TOPUP 指向池外的 id：${topupOutside.join(' · ')}`);
}

// ── ⑤ layout → supports（AC6）───────────────────────────────────────────────────────────────────
console.log('\n── ⑤ 池里每一套都有 supports、没有一套还留着 layout');
{
  const problems = verifyPool(poolThemes);
  if (!problems.length) ok(`${poolIds.length} 套逐套查过`);
  else { bad(`${problems.length} 处不达标：`); for (const p of problems.slice(0, 6)) console.log(`     ${p}`); }

  // 反向对照：故意留一套没翻，这把尺必须点名它。没有这一格，上面那个 ✅ 分不出
  // 「全都翻好了」和「这个检查什么都没看」。
  const [firstId] = poolIds;
  const rigged = { ...poolThemes, [firstId]: { ...poolThemes[firstId], layout: { hero: 'text-only' } } };
  const caught = verifyPool(rigged).filter((p) => p.startsWith(`${firstId}:`));
  if (caught.length) ok(`反向对照：给 ${firstId} 留一个 layout 键，它当场被点名`);
  else bad('反向对照失败：留着 layout 的那一套没被点名 —— 这把尺量不出东西');

  const noSupports = { ...poolThemes, [firstId]: { ...poolThemes[firstId], supports: {} } };
  if (verifyPool(noSupports).some((p) => p.startsWith(`${firstId}:`))) {
    ok(`反向对照：把 ${firstId} 的 supports 清空，它当场被点名`);
  } else {
    bad('反向对照失败：supports 为空的那一套没被点名');
  }

  // `layoutFor()` 是 #1010 那条「行为不变」保证的消费方 —— 池里每一套都要取得到值。
  const noLayout = poolIds.filter((id) => !Object.keys(themesMod.layoutFor(id)).length);
  if (!noLayout.length) ok('layoutFor() 对池里每一套都取得到值');
  else bad(`layoutFor() 对这几套返回 {}：${noLayout.slice(0, 6).join(' · ')}`);
}

// ── ⑥ 每一套的表都在磁盘上 ─────────────────────────────────────────────────────────────────────
// 阶段 2 之后一套主题的样子主要在它自己那份表里；`sheet` 指着一个不存在的文件时，
// `sync-config.js` 的 readThemeSheet 会 `process.exit(1)` —— 站建不出来，而这里问一次只要几毫秒。
console.log('\n── ⑥ 每套的表 public/themes/<sheet>.css 都在');
{
  const missing = poolIds.filter((id) => {
    const sheet = poolThemes[id].sheet;
    return !sheet || !fs.existsSync(path.join(NEXT, 'public', 'themes', `${sheet}.css`));
  });
  if (!missing.length) ok(`${poolIds.length} 份表都在`);
  else bad(`${missing.length} 套的表不在磁盘上：${missing.slice(0, 6).join(' · ')}`);
}

// ── ⑦ 行业组表自己的两条机械性质 ───────────────────────────────────────────────────────────────
console.log('\n── ⑦ 行业组表：不重不漏，位子数 == 池子大小');
{
  const words = sectors.SECTORS.flatMap((s) => s.words);
  const dupes = [...new Set(words.filter((w, i) => words.indexOf(w) !== i))];
  if (!dupes.length) ok(`${sectors.SECTORS.length} 组 · ${words.length} 个词，无重复`);
  else bad(`行业组之间有重复的词：${dupes.join(' · ')}`);

  const slots = sectors.poolSlots();
  if (slots.length === poolIds.length) ok(`位子 ${slots.length} 个 == 池子 ${poolIds.length} 套`);
  else bad(`位子 ${slots.length} 个，池子 ${poolIds.length} 套 —— 对不上就有主题拿不到行业词`);
}

// ── ⑧ 透明浮层只给深底首屏（#1016 r5）────────────────────────────────────────────────────────────
//
// 浮层配一层压在页面最上面 160px 的黑色渐变（`src/components/Header.tsx`），浓度是按「首屏是纯白」
// 定的，因为浮层的字是白的。同一层遮罩压在「浅底 + 深字」的 hero 上，把标题最上面那一截压到
// rgb(110) 左右：真机量到 azure-50 `.hero__title` 3.89:1、crimson-30 3.81:1，而 CI 那道运行时检查
// 就是为这种事红的。规则和为什么换字色治不了，写在 `region-layout.js` 那个函数上面。
//
// 🔴 这一格有两半，缺哪半都不行：
//   · 后一半问「今天这池数据成立吗」——它是会被下一次改动破坏的那个性质；
//   · 前一半问「那个遮罩还是我以为的那个吗」——判据里的 55% 在两处出现（组件里的 class 串 +
//     region-layout.js 的常量），而两处必然分叉。分叉的方向是**静默变绿**：有人把遮罩调浓，
//     生成器仍按 55% 挑，池子照样"全过"，而真机上标题已经读不出来了。所以这里读组件的原文。
console.log('\n── ⑧ 透明浮层只给深底首屏；判据里那个遮罩浓度跟组件里的一致');
{
  const region = require(path.join(NEXT, 'scripts', 'region-layout.js'));
  const headerTsx = path.join(NEXT, 'src', 'components', 'Header.tsx');
  let src = '';
  try { src = fs.readFileSync(headerTsx, 'utf-8'); } catch { /* 下面按读不到处理 */ }
  const scrim = /from-black\/(\d+)\s+via-black\/(\d+)\s+to-transparent/.exec(src);
  if (!src) {
    bad(`读不到 src/components/Header.tsx —— 遮罩浓度那半没法核，这不是通过`);
  } else if (!scrim) {
    bad('Header.tsx 里找不到 `from-black/NN via-black/NN to-transparent` 那条遮罩 —— '
      + '要么遮罩改写法了、要么没了，两种情况下 region-layout.js 那条规则都要重新量一次');
  } else {
    const mid = Number(scrim[2]) / 100;
    if (Math.abs(mid - region.HEADER_SCRIM_MID_ALPHA) < 1e-9) {
      ok(`Header.tsx 的遮罩是 from-black/${scrim[1]} via-black/${scrim[2]}，`
        + `跟 region-layout.js 的 HEADER_SCRIM_MID_ALPHA=${region.HEADER_SCRIM_MID_ALPHA} 一致`);
    } else {
      bad(`遮罩浓度对不上：Header.tsx 是 via-black/${scrim[2]}（${mid}），`
        + `region-layout.js 按 ${region.HEADER_SCRIM_MID_ALPHA} 挑顶栏 —— 挑的时候量的不是真遮罩`);
    }
  }

  const overlay = poolIds.filter((id) => ((poolThemes[id].supports || {}).header || [])[0] === 'transparent-overlay');
  const breaks = [];
  for (const id of overlay) {
    const sheetPath = path.join(NEXT, 'public', 'themes', `${poolThemes[id].sheet}.css`);
    let css = '';
    try { css = fs.readFileSync(sheetPath, 'utf-8'); } catch { /* 下面 verdict 会因为读不到而 ok=false */ }
    const verdict = region.heroTitleSurvivesHeaderScrim(css, poolThemes[id].colors);
    if (!verdict.ok) breaks.push(`${id}（${verdict.why}）`);
  }
  if (!overlay.length) {
    // 一套都没有不是通过：说明这一维的花样全没了，或者 supports.header 根本没写进去。
    bad('池里一套 transparent-overlay 都没有 —— 这一格就什么都没验，而顶栏那一维也没了花样');
  } else if (!breaks.length) {
    ok(`${overlay.length}/${poolIds.length} 套用透明浮层，每一套的 .hero__title 压在遮罩下都 ≥ `
      + `${region.HEADER_SCRIM_INK_FLOOR}:1`);
  } else {
    bad(`${breaks.length} 套的浮层配的是浅底首屏：${breaks.slice(0, 6).join(' · ')}`);
  }

  // 反向对照：拿一套**真的**浅底表喂给挑顶栏那个函数，它必须让开。不做这一格的话，
  // 上面那句"每一套都过"在函数恒返回 ok 时长得完全一样。
  const paleId = poolIds.find((id) => {
    const css = fs.readFileSync(path.join(NEXT, 'public', 'themes', `${poolThemes[id].sheet}.css`), 'utf-8');
    return !region.heroTitleSurvivesHeaderScrim(css, poolThemes[id].colors).ok;
  });
  if (!paleId) {
    bad('池里找不到一套浅底首屏的表 —— 反向对照没法做，那么上面那句"每一套都过"证明不了函数在判事');
  } else {
    const paleCss = fs.readFileSync(path.join(NEXT, 'public', 'themes', `${poolThemes[paleId].sheet}.css`), 'utf-8');
    // index 取 HEADER_VARIANTS 里浮层那一格，也就是"本来该轮到浮层"的那些位子。
    const overlayIndex = region.HEADER_VARIANTS.indexOf('transparent-overlay');
    const picked = region.headerVariantForPool(overlayIndex, paleCss, poolThemes[paleId].colors);
    if (picked.variant !== 'transparent-overlay' && picked.why) {
      ok(`反向对照：拿 ${paleId} 那份浅底表 + 本来轮到浮层的位子 ⟹ 让开成 ${picked.variant}（${picked.why}）`);
    } else {
      bad(`反向对照失败：${paleId} 是浅底首屏，却仍然拿到 ${picked.variant}`);
    }
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
