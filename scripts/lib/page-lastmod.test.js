#!/usr/bin/env node
/**
 * page-lastmod.test.js — #1025 条 13:给 #1026 那条规则装一个常设的守卫。
 *
 *   node scripts/lib/page-lastmod.test.js        （CI 里由 `npm run test:scripts` 自动发现，
 *                                                 .github/workflows/ci-cd.yml 的 template-scripts）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * #1026 定下的规则是「`<lastmod>` 由内容决定，不是由构建时刻决定」。那一轮证明它成立的读数
 * （连建两次、md5 相同）**是四个人手跑出来的** —— 而 `tests/e2e/specs/` 里 `lastmod` /
 * `lastModified` 一次都没出现（QA2 在 #1026 grep 过）。也就是说下一个人把 `new Date()` 写回去，
 * CI 是绿的。一个只在写的那天跑过的检查，等于没有检查。
 *
 * 🔴 这里不起浏览器、不建站、不碰 git 仓：直接喂 `createLastModifiedResolver` 一个临时目录。
 *    理由是这条规则的承重面就在这个函数里，而 e2e 那一层要先建站（分钟级）才问得出同一个问题。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLastModifiedResolver } = require('./page-lastmod.js');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof createLastModifiedResolver !== 'function') die('page-lastmod.js 没导出 createLastModifiedResolver');

// 分母自检:`toIso` 从 #1025 条 11 起【不】导出。写成断言而不是注释 —— 哪天有人把它加回来，
// 这一格会说出来（不是失败，是提醒:那说明有了外部调用方，条 11 的理由就不成立了）。
if (Object.prototype.hasOwnProperty.call(require('./page-lastmod.js'), 'toIso')) {
  bad('`toIso` 又被导出了 —— #1025 条 11 去掉它的理由是「外部调用点 0 个」，现在请重新数一遍');
} else {
  ok('`toIso` 没有被导出（#1025 条 11）');
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lastmod-'));
const mk = (name, mtime) => {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, 'x');
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
};
// 这个目录不是 git 仓 ⟹ `gitIndex` 那条路读不到东西，resolveOne 走 mtime 那一档，
// 正是本文件要问的那一档。（git 那一档由 #1033 的 e2e 覆盖。）
const BUILD = '2026-08-16T00:00:00.000Z';
const r = (buildTime = BUILD) => createLastModifiedResolver({ rootDir: TMP, pathspec: '.', buildTime });

// ── ① #1026 的规则本体:内容没变 ⟹ 两次算出来的日期一样，而且【不等于】构建时刻 ──────────────
{
  const f = mk('a.json', new Date('2026-03-04T05:06:07Z'));
  const one = r().resolveLatest([f]);
  const two = r('2026-12-31T23:59:59.000Z').resolveLatest([f]);   // 换一个构建时刻再算一次
  if (one.value === two.value && one.value === '2026-03-04T05:06:07.000Z') {
    ok(`内容没变 ⟹ 换个构建时刻算出来还是同一个日期（${one.value}）—— 这就是 #1026 那条规则`);
  } else {
    bad(`两次读数 ${one.value} / ${two.value} —— 构建时刻漏进 <lastmod> 了，#1026 那条规则破了`);
  }
}

// ── ② #1025 条 12:未来的时间要被压回构建时刻 ────────────────────────────────────────────────
{
  const f = mk('future.json', new Date('2030-01-01T00:00:00Z'));
  const got = r().resolveLatest([f]);
  if (got.value === BUILD) ok(`mtime 在 2030 ⟹ 压回构建时刻（source=${got.source}）`);
  else bad(`mtime 在 2030 而 <lastmod> 写成 ${got.value} —— 未来的日期对搜索引擎是坏信号`);
  // 反向:别只看压没压，还要确认它没把 2030 原样吐出来
  if (got.value.startsWith('2030')) bad('压回之后仍然是 2030 —— 这一格的判据本身失灵了');
  else ok('压回之后确实不再是 2030');
  // source 要说出发生过什么，否则排查时「为什么这一页是构建时刻」答不上来
  if (String(got.source).endsWith('-capped')) ok(`source 说清了它被压过：${got.source}`);
  else bad(`source=${got.source} —— 压过却不说，排查时分不清它和真正的 build 兜底`);
}

// ── ③ 只压上界、不碰下界:很旧的日期是真话 ───────────────────────────────────────────────────
{
  const f = mk('old.json', new Date('2001-02-03T04:05:06Z'));
  const got = r().resolveLatest([f]);
  if (got.value === '2001-02-03T04:05:06.000Z') ok('2001 年的 mtime 原样保留 —— 上界不是「一律改写」');
  else bad(`2001 年的 mtime 被改成了 ${got.value} —— 压过头了，旧日期是真话`);
}

// ── ④ 一个源文件都说不出来 ⟹ 落到构建时刻那一档（这是它本来的兜底，不许因为上界而改变）──────
{
  const got = r().resolveLatest([]);
  if (got.value === BUILD && got.source === 'build') ok('没有源文件 ⟹ 构建时刻 + source=build，兜底没被动过');
  else bad(`空数组算出 ${got.value} / source=${got.source}，期望 ${BUILD} / build`);
}

// ── ⑤ 多个文件取最晚的那个（#1033 的性质，顺带钉住，别被上界改坏）────────────────────────────
{
  const a = mk('m1.json', new Date('2026-01-01T00:00:00Z'));
  const b = mk('m2.json', new Date('2026-06-01T00:00:00Z'));
  const got = r().resolveLatest([a, b]);
  if (got.value === '2026-06-01T00:00:00.000Z' && got.from === b) ok('多个文件取最晚的那个，并说出是哪一个');
  else bad(`取到 ${got.value} / from=${got.from}，期望 2026-06-01 / ${b}`);
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n逐条断言:PASS ${pass} · FAIL ${fail}`);
console.log(fail === 0 ? '✅ #1025 page-lastmod: 全过' : '❌ #1025 page-lastmod: 有失败');
process.exit(fail === 0 ? 0 : 1);
