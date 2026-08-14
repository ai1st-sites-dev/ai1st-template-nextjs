#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// coverage.js — 行业覆盖度：每个行业关键词能匹配到几套主题？（#1004 AC3 / AC4，spec §4.9③）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-pipeline/coverage.js                 # 跑今天的注册表
//   node scripts/theme-pipeline/coverage.js --json          # 只要机器读的那份
//   node scripts/theme-pipeline/coverage.js --max-thin-pools 0 --max-thin-hits 0
//
// 🔴 **两个数量的是两件事，必须分开报**（本票 AC3 写死的一条）：
//
//   ① 候选池大小 = `candidateThemesForIndustry()` 最后给出几套。它带兜底：不足
//      `MIN_ROTATION_POOL`（3）时用 NEUTRAL_TOPUP 顶上来 ⟹ **它永远 ≥ 3**。
//   ② 真命中 = 有几套主题的 `industries` 数组里写了这个词。**没有兜底。**
//
//   只报 ① 的话，175 个薄格子会全部显示成健康的「3 套」；而 ② 才说得出「这个行业几乎没有为它
//   做的皮」。今天的读数：池分布 {3:175, 4:18, 5:9, 6:9, 7:1} · 真命中分布 {1:113, 2:35, 3:27, …}。
//
// 🔴 真命中不可能是 0：关键词就是从各主题自己的 `industries` 数组里抽出来的，写了这个词的那套
//    主题必然命中它 ⟹ 分布从 1 起步。任何「有 0 这一格」的读数都是探针自己造出来的
//    （本票正文记了一次：把 `real estate` 拼成 `realestate` 去探，探出个 0）。
const path = require('path');

const themesMod = require(path.join(__dirname, '..', 'themes.js'));

/** 一次覆盖度普查 → 逐词读数 + 两份分布。`themes` 可换成人造池子（AC4 的富池子那一格）。 */
function surveyCoverage(themes = themesMod.themes, opts = {}) {
  const ids = Object.keys(themes);
  const keywords = [...new Set(ids.flatMap((id) => themes[id].industries || []))];
  // 候选池那一半要用注册表**自己**那条实现（同一个匹配口径、同一份兜底名单），不另写一份。
  //
  // 🔴 但那条实现读的是注册表这个模块自己的全局池子，跟传进来的 `themes` 无关。所以换了池子却
  //    不换它 ⟹ 命中那半算的是新池子、候选池那半算的是真注册表，两个数**不是同一个世界的**。
  //    QA1 r1 量到的形状：8 套的人造富池子不传 candidatesFor ⟹ 命中 8 / 薄池 27，而那个 27 是
  //    真注册表的读数。当场拒跑，不给默认值 —— 也不在这里照着 `themes` 重写一份匹配逻辑，那样
  //    就有了第二份实现，而它跟注册表分叉时没有任何东西会说话。
  if (themes !== themesMod.themes && !opts.candidatesFor) {
    throw new Error('surveyCoverage: 换了 themes 就必须一起传 opts.candidatesFor —— '
      + 'candidateThemesForIndustry() 读的是注册表自己的池子，不读你传进来的这份，'
      + '于是两份分布会来自两个不同的池子。');
  }
  const candidatesFor = opts.candidatesFor
    || ((word) => themesMod.candidateThemesForIndustry(word));

  const rows = keywords.map((word) => {
    const lower = String(word).toLowerCase();
    const hits = ids.filter((id) => (themes[id].industries || []).some((kw) => lower.includes(kw)));
    return { word, hits: hits.length, pool: candidatesFor(word).length };
  }).sort((a, b) => a.pool - b.pool || a.hits - b.hits || a.word.localeCompare(b.word));

  const dist = (key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
  const minPool = themesMod.MIN_ROTATION_POOL;
  return {
    themeCount: ids.length,
    keywordCount: keywords.length,
    keywordOccurrences: ids.reduce((n, id) => n + (themes[id].industries || []).length, 0),
    minRotationPool: minPool,
    poolDistribution: dist('pool'),
    hitDistribution: dist('hits'),
    // 🔴 两个「薄」的判据各自带自己的数，不许混用（AC4）：
    //   · 池 == MIN_ROTATION_POOL —— 这个行业只靠兜底凑够了轮换池
    //   · 真命中 == 1            —— 这个行业只有一套主题真的写了它
    thinPools: rows.filter((r) => r.pool === minPool).length,
    thinHits: rows.filter((r) => r.hits === 1).length,
    rows,
  };
}

function main(argv) {
  const arg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt;
  };
  const maxThinPools = arg('--max-thin-pools', 0);
  const maxThinHits = arg('--max-thin-hits', 0);
  const survey = surveyCoverage();

  if (argv.includes('--json')) {
    console.log(JSON.stringify(survey, null, 1));
  } else {
    console.log(`主题 ${survey.themeCount} 套 · 行业关键词 ${survey.keywordCount} 个去重`
      + `（含重复 ${survey.keywordOccurrences}）· MIN_ROTATION_POOL = ${survey.minRotationPool}`);
    console.log(`候选池分布（带兜底）: ${JSON.stringify(survey.poolDistribution)}`);
    console.log(`真命中分布（无兜底）: ${JSON.stringify(survey.hitDistribution)}`);
    console.log(`薄：池 == ${survey.minRotationPool} 的 ${survey.thinPools} 个 · 真命中 == 1 的 ${survey.thinHits} 个`);
    console.log('\n最薄的 15 个（真命中 / 候选池）：');
    for (const r of survey.rows.slice(0, 15)) console.log(`  ${r.word.padEnd(26)} ${r.hits} / ${r.pool}`);
  }

  const problems = [];
  if (survey.thinPools > maxThinPools) {
    problems.push(`候选池只有 ${survey.minRotationPool} 套（= 兜底下限）的行业有 ${survey.thinPools} 个，`
      + `上限 ${maxThinPools} —— 这些行业的两个站抽到同一套皮的概率是 1/${survey.minRotationPool}`);
  }
  if (survey.thinHits > maxThinHits) {
    problems.push(`真正为它做过皮的主题只有 1 套的行业有 ${survey.thinHits} 个，上限 ${maxThinHits}`
      + ' —— 不是「少」，是「这个行业几乎没有为它做的皮」');
  }
  if (problems.length) {
    console.error('\n🔴 覆盖度不够：');
    for (const p of problems) console.error(`   ${p}`);
    process.exit(1);
  }
  console.log('\n✅ 覆盖度达标');
  process.exit(0);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { surveyCoverage };
