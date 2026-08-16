#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hook-coverage.js — 一份主题表画到了几个钩子、几个块，每块画了多少（#1051 AC1/AC2 的那把尺）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-pipeline/hook-coverage.js public/themes/*.css
//   node scripts/theme-pipeline/hook-coverage.js --json /tmp/c/gen-07-1.css
//   node scripts/theme-pipeline/hook-coverage.js --min-decls 11 --min-median 28 <表…>
//
// 退出 0 = 每一份表都画全了、密度也够。
// 退出 1 = 至少一份没有 —— 缺的钩子和缺的块**逐个点名**，密度不够的也点名。
// 退出 2 = 读不到（没有文件 / 解析不了）。🔴 跟 1 分开：「量不到」不是「不合格」，也不是通过。
//
// ══ 为什么要有这把尺 ═══════════════════════════════════════════════════════════════════════════
// #1016 要跑 60-80 套主题池，准入闸②（`gates.js`）会把「页面上出现、而这套主题自己表里没有规则」
// 的钩子逐个点名。但闸②只在**建出一个真站之后**才能问这个问题，而且它只看产物的 `index.html`。
// 生成器改一行就想知道「还差哪几个块」，需要一把不用建站就能用的尺 —— 就是这个文件。
//
// 🔴 **钩子名单必须问 `theme-css-lint.js` 要，不许 grep 那个文件。** 它自己写着这件事
//    （`theme-css-lint.js:869` 一带）：注释里带引号的词会被正则当成条目，两边都读错。这里
//    `require` 它导出的 `HOOK_CLASSES`，所以契约加一个钩子，这把尺当天就跟着变。
//
// ══ 密度那两个数是什么，为什么要有 ═════════════════════════════════════════════════════════════
// 只数「213/213 钩子 · 34/34 块」是不够的，而不够的方式很具体：让生成器覆盖 213 个钩子**最省事的
// 实现**就是一个模板循环、每个钩子吐一条无意义声明 —— 那样钩子和块全绿，每块却只有 213/34 ≈ 6 条
// 声明，做出来的 60-80 套主题在 33 个块上仍然长得一模一样，正是 #1016 要治的那件事。
// 所以同时量**每块的声明数**，下限照三套实证表定（PM 2026-08-16 在 #1051 定的：min ≥ 11、中位 ≥ 28）。
//
// 🔴 **密度只是代理，不是「好看」的证明。** 真正那一关是 #1016 的 AC5（Chris 人审）。这把尺只保证
//    这份表不是一层壳。
//
// 🔴 **一条规则的声明算给它选择器里出现的【每一个】块**（`.hero__title, .cta-banner__headline {…}`
//    这种一条规则管两个块的写法，两个块都记上）。理由：问的是「这个块被画了多少」，而那条规则确实
//    在画它们两个。代价说在明处 —— 各块之和会大于文件里的声明总数，所以总数是单独数的，不是加出来的。
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const { HOOK_CLASSES } = require(path.join(__dirname, '..', 'theme-css-lint.js'));

const blockOf = (hook) => (hook.includes('__') ? hook.split('__')[0] : hook);
const ALL_HOOKS = new Set(HOOK_CLASSES);
const ALL_BLOCKS = [...new Set(HOOK_CLASSES.map(blockOf))];

/** 一份表的读数。`css` 是表的文本。 */
function measureSheet(css) {
  const root = postcss.parse(css);
  const hooks = new Set();
  const perBlock = new Map(ALL_BLOCKS.map((b) => [b, 0]));
  let rules = 0;
  let decls = 0;
  root.walkRules((rule) => {
    rules += 1;
    const n = rule.nodes.filter((x) => x.type === 'decl').length;
    decls += n;
    const blocks = new Set();
    for (const m of rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      if (!ALL_HOOKS.has(m[1])) continue;
      hooks.add(m[1]);
      blocks.add(blockOf(m[1]));
    }
    for (const b of blocks) perBlock.set(b, perBlock.get(b) + n);
  });
  const covered = ALL_BLOCKS.filter((b) => perBlock.get(b) > 0);
  const counts = covered.map((b) => perBlock.get(b)).sort((a, b) => a - b);
  return {
    rules,
    decls,
    hooks: hooks.size,
    hooksTotal: HOOK_CLASSES.length,
    blocks: covered.length,
    blocksTotal: ALL_BLOCKS.length,
    missingHooks: HOOK_CLASSES.filter((h) => !hooks.has(h)),
    missingBlocks: ALL_BLOCKS.filter((b) => perBlock.get(b) === 0),
    // 中位数取排序后的中间那个（偶数个时取靠后的那个）。写下来是因为 34 个块是偶数，
    // 「中间两个的平均」会给出另一个数，而判据是拿这一个定的。
    minDecls: counts.length ? counts[0] : 0,
    medianDecls: counts.length ? counts[Math.floor(counts.length / 2)] : 0,
    maxDecls: counts.length ? counts[counts.length - 1] : 0,
    perBlock: Object.fromEntries(ALL_BLOCKS.map((b) => [b, perBlock.get(b)])),
  };
}

/** 读数 → 该点名的问题。空数组 = 这份表过了。 */
function problemsIn(m, { minDecls, minMedian }) {
  const out = [];
  if (m.missingHooks.length) {
    out.push(`钩子 ${m.hooks}/${m.hooksTotal} —— 这份表里没有规则的钩子：${m.missingHooks.join(', ')}`);
  }
  if (m.missingBlocks.length) {
    out.push(`块 ${m.blocks}/${m.blocksTotal} —— 一条规则都没有的块：${m.missingBlocks.join(', ')}`);
  }
  if (m.blocks && m.minDecls < minDecls) {
    const thin = Object.entries(m.perBlock).filter(([, n]) => n > 0 && n < minDecls)
      .map(([b, n]) => `${b} ${n}`).join(', ');
    out.push(`最少的那个块只有 ${m.minDecls} 条声明，下限 ${minDecls}：${thin}`);
  }
  if (m.blocks && m.medianDecls < minMedian) {
    out.push(`每块声明数的中位是 ${m.medianDecls}，下限 ${minMedian} —— 覆盖到了但画得太薄，`
      + '60-80 套主题在这些块上会长得一模一样');
  }
  return out;
}

function main(argv) {
  const num = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt;
  };
  const minDecls = num('--min-decls', 11);
  const minMedian = num('--min-median', 28);
  const asJson = argv.includes('--json');
  const files = argv.filter((a, i) => !a.startsWith('--')
    && !['--min-decls', '--min-median'].includes(argv[i - 1]));

  if (!files.length) {
    console.error('🔴 没给表 —— 用法：node scripts/theme-pipeline/hook-coverage.js <表.css …>');
    console.error('   什么都没量不是通过。');
    process.exit(2);
  }

  const report = [];
  for (const f of files) {
    let css;
    try {
      css = fs.readFileSync(f, 'utf-8');
    } catch (e) {
      console.error(`🔴 读不到 ${f}：${e.message} —— 没量，不算通过。`);
      process.exit(2);
    }
    let m;
    try {
      m = measureSheet(css);
    } catch (e) {
      console.error(`🔴 解析不了 ${f}：${String(e.message).split('\n')[0]} —— 没量，不算通过。`);
      process.exit(2);
    }
    report.push({ file: f, ...m, problems: problemsIn(m, { minDecls, minMedian }) });
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    for (const r of report) {
      console.log(`${path.basename(r.file)}`);
      console.log(`  钩子 ${r.hooks}/${r.hooksTotal} · 块 ${r.blocks}/${r.blocksTotal}`
        + ` · 规则 ${r.rules} · 声明 ${r.decls}`);
      console.log(`  每块声明数 min ${r.minDecls} / 中位 ${r.medianDecls} / max ${r.maxDecls}`
        + `（下限 min ${minDecls} / 中位 ${minMedian}）`);
      for (const p of r.problems) console.log(`  🔴 ${p}`);
    }
  }

  const bad = report.filter((r) => r.problems.length);
  if (bad.length) {
    console.error(`\n🔴 ${bad.length}/${report.length} 份表没画全或画得太薄：`
      + bad.map((r) => path.basename(r.file)).join(', '));
    process.exit(1);
  }
  console.log(`\n✅ ${report.length} 份表都画全了 ${HOOK_CLASSES.length} 个钩子 / ${ALL_BLOCKS.length} 个块，密度也够`);
  process.exit(0);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { measureSheet, problemsIn };
