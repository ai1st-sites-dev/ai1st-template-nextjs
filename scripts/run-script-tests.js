#!/usr/bin/env node
/**
 * run-script-tests.js — 跑 `templates/nextjs/scripts/` 底下所有 `*.test.js`（#1034 r2）。
 *
 *   npm run test:scripts
 *
 * 退出码: 0 全过 · 1 至少一个失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * `scripts/lib/homepage-recipe.test.js`（#1034 r1）写完之后**没有任何东西会跑它**：CI 里没有、
 * `TEST-MAP` 不收 node 测试、`lint:scripts` 只查语法。合起来的后果是具体的：那份测试有一格专门
 * 守着「有人把块改名时不许静默把它放回配方池」，而**块被改名的那天 CI 仍然是绿的** ——
 * 一个只有人手动跑才存在的检查，就是「写的那天跑过一次」的检查（#1009 为两个 CSS 校验器写过
 * 同一句话，那次的修法也是给它接一个自动调用方）。
 *
 * ── 按【发现】而不是【枚举】 ────────────────────────────────────────────────────────────────────
 * 这里不写文件名清单:以后谁在 `scripts/` 底下加一个 `*.test.js`，不用记得回来改这个文件，也不用
 * 改 CI。代价是「发现不到 = 什么都没跑」这种失败方向，所以下面有一条硬规矩：
 *
 * 🔴 **一个测试文件都没发现 ⟹ exit 2，不是 exit 0。** 一个什么都没跑的绿是最贵的那种绿：
 *    它长得跟「全过」一模一样。这条纪律在本仓已经付过账（`ai-team/dispatcher/ship-check-all.sh`
 *    的汇总里那一格「什么都没审」就是为它加的）。
 *
 * 🔴 每个测试文件**各起一个进程**:一个文件 `process.exit(2)` 或者把 require 缓存搞脏，不该让
 *    别的文件跟着假红或假绿。汇总看的是每个进程自己的退出码。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = __dirname;

/** 递归找 `*.test.js`，跳过 node_modules。返回相对 scripts/ 的路径，排过序（读数可复算）。 */
function findTests(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findTests(full));
    else if (e.name.endsWith('.test.js')) out.push(full);
  }
  return out.sort();
}

const tests = findTests(SCRIPTS);

if (tests.length === 0) {
  console.error('🔴 scripts/ 底下一个 *.test.js 都没发现 —— 这不是「全过」，这是什么都没跑。');
  console.error('   要么是有人把测试删了/改名了，要么是这个脚本找错了目录: ' + SCRIPTS);
  process.exit(2);
}

console.log(`══ templates/nextjs 的 script 测试:发现 ${tests.length} 个文件 ══`);

let failed = 0;
let broken = 0;
for (const t of tests) {
  const rel = path.relative(SCRIPTS, t);
  console.log(`\n── ${rel}`);
  const r = spawnSync(process.execPath, [t], { stdio: 'inherit', cwd: path.resolve(SCRIPTS, '..') });
  const rc = r.status === null ? 2 : r.status;   // 被信号打死 = 拿不到读数，不是通过
  if (rc === 0) continue;
  if (rc === 2) { broken++; console.log(`   🔴 ${rel} 跑不起来（rc=2）`); }
  else { failed++; console.log(`   ❌ ${rel} 有失败（rc=${rc}）`); }
}

console.log(`\n══ 汇总:${tests.length} 个文件 · 有失败 ${failed} · 跑不起来 ${broken} ══`);
if (broken) { console.log('🔴 有测试跑不起来 —— 那不是通过'); process.exit(2); }
if (failed) { console.log('❌ 有测试失败'); process.exit(1); }
console.log('✅ 全过');
