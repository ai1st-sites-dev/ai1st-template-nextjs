#!/usr/bin/env node
'use strict';
// upgrade-site-data.js —— 升级一个已有站时改写它数据里的老块类型名（#1166 第 2 步的命令行入口）。
//
// 用法（在站容器的 /app/repo 里跑）：
//   node scripts/upgrade-site-data.js            # 真改
//   node scripts/upgrade-site-data.js --dry-run  # 只算不写（升级前的确认框用它算「会改哪几页」）
//   node scripts/upgrade-site-data.js --site site --root .
//
// 输出是 JSON-lines（跟 create-site.js / edit-site.js 同一种），worker 读它：
//   {"event":"plan","changes":[…],"blockers":[…]}
//   {"event":"migrated","files":[…]}                 真改完了
//   {"event":"blocked","blockers":[…],"message":"…"} 有迁不了的 ⟹ 退出码 3，一个字节都没写
//
// 🔴 为什么这一步能住在模板里，而 #1163 的推送不能：升级的顺序是**先把今天的模板铺上去，再跑这一
// 步** —— 跑的时候脚本已经是今天这份了。推送不一样，它在铺模板之前就得能用。
//
// 🔴 退出码分开：3 = 数据里有迁不了的类型名（**不是**错误，是「按设计拒绝升级」，worker 要把它变成
// 给老板的一句话）；1 = 真出错（读不到目录之类）。两者混用会让「拒绝」被当成「崩了」去重试。

const fs = require('fs');
const path = require('path');
const { planSiteMigration, applyPlan } = require('./lib/site-data-migration.js');

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const dryRun = argv.includes('--dry-run');
const rootDir = path.resolve(opt('root', process.cwd()));
const siteDir = path.resolve(rootDir, opt('site', 'site'));

const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

if (!fs.existsSync(siteDir)) {
  emit({ event: 'error', message: `site directory not found: ${siteDir}` });
  process.exit(1);
}

let plan;
try {
  plan = planSiteMigration(siteDir, { rootDir });
} catch (e) {
  emit({ event: 'error', message: `could not read this website's data: ${e.message}` });
  process.exit(1);
}

// 计划先报出来，不管接下来做什么 —— 「哪几页会被改」是老板确认框里那句话的来源，也是事后对账的凭据。
emit({
  event: 'plan',
  dryRun,
  changes: plan.changes.map((c) => ({
    file: path.relative(rootDir, c.file), index: c.index, id: c.id,
    from: c.from, to: c.to, renamed: c.renamed, roleAdded: c.roleAdded,
  })),
  blockers: plan.blockers.map((b) => ({
    file: path.relative(rootDir, b.file), index: b.index, id: b.id, type: b.type, reason: b.reason,
  })),
});

if (plan.blockers.length) {
  // 🔴 在动任何文件之前中止。宁可升不了，也不许静默删掉客人的内容 —— 未知类型在新模板上走的是
  //    `SectionRenderer` 那条 console.warn + return null，块会从页面上消失而构建照样 exit 0。
  const where = plan.blockers
    .map((b) => `${path.relative(rootDir, b.file)}${b.index >= 0 ? `[${b.index}]` : ''}`
      + `${b.type ? ` (${b.type})` : ''}`)
    .join(', ');
  emit({
    event: 'blocked',
    blockers: plan.blockers.length,
    message: 'This website has content we do not know how to carry over yet, so nothing was changed: '
      + `${where}. Tell us and we will add it.`,
  });
  process.exit(3);
}

if (dryRun) {
  emit({ event: 'migrated', dryRun: true, files: [] });
  process.exit(0);
}

try {
  const written = applyPlan(plan);
  emit({ event: 'migrated', files: written.map((f) => path.relative(rootDir, f)) });
} catch (e) {
  emit({ event: 'error', message: `could not write this website's data: ${e.message}` });
  process.exit(1);
}
