'use strict';
// #1597 —— callAIWithRetry 内层（接口重试）那一次等多久。
//
// 以前是固定的 5s / 10s：#1593 把单页并行提到 5 之后，5 条请求同时撞 429，SDK 自己那 2 次重试放弃、抛到我们这层，
// 固定退避又把 5 条【重新对齐】到同一时刻再撞一次。所以抖动要加在我们这层（SDK 的抖动只管它自己那 2 次）。
//   · 服务器给了 retry-after-ms / retry-after（秒数或 HTTP 日期）⟹ 照它等。SDK 抛出来之后这个值只在这里还读得到。
//     跟 SDK 同一个口径（@anthropic-ai/sdk client.js §retryRequest）：只认 0 ≤ 值 < 60 秒，否则当没给。
//   · 没给 ⟹ 基数 5s · 2^(n-1) 乘一个 [0.5, 1.5) 的随机系数：均值跟以前一样，同时撞上的几条散开。

const BASE_MS = 5000;
const MAX_RETRY_AFTER_MS = 60 * 1000;

function headerOf(err, name) {
  const h = err && err.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  return h[name] ?? null;
}

/** 服务器要我们等多少毫秒；没给 / 读不懂 / 不在 [0, 60s) ⟹ null。 */
function retryAfterMs(err, now = Date.now()) {
  let ms = null;
  const msHeader = headerOf(err, 'retry-after-ms');
  if (msHeader != null && !Number.isNaN(parseFloat(msHeader))) ms = parseFloat(msHeader);
  const secHeader = headerOf(err, 'retry-after');
  if (ms === null && secHeader != null && secHeader !== '') {
    const sec = parseFloat(secHeader);
    ms = Number.isNaN(sec) ? Date.parse(secHeader) - now : sec * 1000;
  }
  if (ms === null || Number.isNaN(ms) || ms < 0 || ms >= MAX_RETRY_AFTER_MS) return null;
  return Math.round(ms);
}

/** 第 apiAttempt 次接口失败之后（从 1 数起）等多少毫秒。random 只为单测可注入。 */
function apiRetryDelayMs(err, apiAttempt, random = Math.random) {
  const told = retryAfterMs(err);
  if (told !== null) return { waitMs: told, why: 'retry-after' };
  const base = BASE_MS * Math.pow(2, apiAttempt - 1);
  return { waitMs: Math.floor(base * (0.5 + random())), why: 'backoff' };
}

module.exports = { apiRetryDelayMs, retryAfterMs, BASE_MS, MAX_RETRY_AFTER_MS };
