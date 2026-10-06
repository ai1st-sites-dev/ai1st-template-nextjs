'use strict';
/**
 * build-stats.js — 一次建站的四个数（#1593）：耗时、费用、字段级修补页数、主语言页数。
 *
 * 本文件只**算**，不存、不显示：存储和显示归建站报告（T8 #1600 的 `lib/build-report.js` → `site/build-report.json`）。
 * #1600 先落地了：create-site.js 结束前取一次 `summary()`，`costUsd` 写进报告顶层；`seoFixed` / `pages` 走报告的 repair 格
 * （seoPass 回值经 recordSeo 累加）；`durationSec` 用 #1600 自己的 finishBuildReport（同一个 `startTime`）。
 *
 * 🔴 口径只算 create-site.js 这一个进程：耗时从脚本的 `startTime` 起到写完配置（跟 `elapsed()` 同一个起点），
 *    费用是本进程所有 `cost` 事件的 `cost` 之和。整次建站（next build、推送、worker 的其它步骤）在 `operation_runs`，
 *    两个数对不上是正常的，别拿来互相核对。
 * 📌 `seoFixed` 就是 seoPass 返回值里的 `rewritten`（键名为 #1600 保留），#1593 起它的含义是「做了字段级修补的页数」，
 *    不再是「整页重写过的页数」。修补率 = seoFixed / pages，超过 10% 说明提示词或规则有问题，去修源头。
 */

function createBuildStats(startTime) {
  let cost = 0;
  let seoFixed = 0;
  return {
    /** 每条 `cost` 事件进一次（create-site.js 的 emit 里调）。 */
    addCost(c) { const n = Number(c); if (Number.isFinite(n)) cost += n; },
    /** 主语言每跑完一次 seoPass 进一次它的 `rewritten`（整站那一次 + 代码补出来的服务详情页那一次）。 */
    addSeoFixed(n) { seoFixed += Number(n) || 0; },
    /** @returns {{ durationSec: number, costUsd: number, seoFixed: number, pages: number }} */
    summary({ pages = 0, now = Date.now() } = {}) {
      return {
        durationSec: Math.round((now - startTime) / 100) / 10,
        costUsd: Math.round(cost * 1e6) / 1e6,
        seoFixed,
        pages: Number(pages) || 0,
      };
    },
  };
}

module.exports = { createBuildStats };
