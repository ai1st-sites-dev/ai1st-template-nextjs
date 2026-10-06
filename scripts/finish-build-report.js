#!/usr/bin/env node

/**
 * finish-build-report.js — #1600
 *
 * 建站报告的最后一步。`create-site.js` 退出时 `site/build-report.json` 已经写好，但有两样它那时还不知道：
 *   · 死链 —— 要等 `next build` 产出 out/ 才能查（worker/entrypoint.sh 的 report_dead_links）
 *   · 整次建站的耗时 —— create-site 只知道自己那一段，next build 还没跑
 * entrypoint 在死链检查之后调这个脚本：把那一行 `dead-links` 事件并进去、耗时改成从容器起跑到现在的墙钟秒数，
 * 写回文件，再往 stdout 打一行 `build-report` 事件（worker 转成 Redis 消息 → manager 落 site_build_reports）。
 *
 * Usage:  node scripts/finish-build-report.js [deadLinksFile] [startEpochSec]
 *   deadLinksFile   check-dead-links.js 打出来的那一行（存成文件）；没有 / 读不到 / 不是 dead-links 事件 ⟹ 死链那格留 null
 *   startEpochSec   entrypoint 起跑时的 `date +%s`；不给 ⟹ 耗时保留 create-site 记的那一段
 *   env BUILD_ARCHIVED        #1608 —— entrypoint 的 `git push` 结果：`1` 推上去了 · `0` 没推上去；别的值 / 没设 ⟹ 归档那格不动（null）
 *   env BUILD_ARCHIVE_REASON  没推上去时的原因（entrypoint 已脱敏、截到 300 字）
 *     🔴 走环境变量不走位置参数：entrypoint 有两个调用点，其中 TICKET-321 后台重建那一处在单引号的 `sh -c '…'` 里，
 *        只看得见 export 过的变量（跟 BUILD_START / BUILD_REPORT_PENDING 同一个走法）。
 *   stdout: ONE JSON line — {"event":"build-report","report":{…}}
 *   exit:   0 恒为 0 —— 报告是旁观者，任何一步不成都不许让建站 / 预览失败（跟 report_dead_links 同一个立场）
 *
 * 🔴 `site/build-report.json` 不存在（站仓里的 create-site 是 #1600 之前的那份，或者这是 preview 模式）⟹ 什么都不打。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const br = require('./lib/build-report');

const siteDir = path.resolve(__dirname, '..', 'site');

function main() {
  const report = br.readReport(siteDir);
  if (!report) {
    process.stderr.write(`#1600: ${path.join(siteDir, br.REPORT_FILE)} not found / unreadable — no build report for this build\n`);
    return;
  }
  const [deadFile, startArg] = process.argv.slice(2);
  if (deadFile) {
    try {
      const ev = JSON.parse(fs.readFileSync(deadFile, 'utf-8').trim().split('\n')[0]);
      if (ev && ev.event === 'dead-links') br.recordDeadLinks(report, ev);
    } catch (e) {
      process.stderr.write(`#1600: dead-links summary ${deadFile} unreadable (${e.message}) — dead-link cell stays null\n`);
    }
  }
  const archived = process.env.BUILD_ARCHIVED;
  if (archived === '1' || archived === '0') {
    br.recordArchive(report, { archived: archived === '1', reason: process.env.BUILD_ARCHIVE_REASON });
  }
  const start = Number(startArg);
  if (Number.isFinite(start) && start > 0) {
    report.durationSec = Math.max(0, Math.round(Date.now() / 1000 - start));
  }
  const written = br.writeReport(siteDir, report);
  process.stdout.write(JSON.stringify({ event: 'build-report', report: written }) + '\n');
}

try {
  main();
} catch (e) {
  process.stderr.write(`#1600: finish-build-report failed (${e.message}) — reported nothing\n`);
}
process.exit(0);
