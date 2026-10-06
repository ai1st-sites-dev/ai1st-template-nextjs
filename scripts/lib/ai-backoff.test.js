#!/usr/bin/env node
// #1597 —— callAIWithRetry 内层那次等多久（§lib/ai-backoff.js）。真进程里的那一格在 create-site-degraded.test.js（站级那一通连续 429）。
'use strict';
const assert = require('assert');
const { apiRetryDelayMs, retryAfterMs } = require('./ai-backoff');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
const err429 = (headers) => Object.assign(new Error('429 rate_limit_error'), { status: 429, headers });

check('没给 retry-after：基数 5s / 10s 乘 [0.5, 1.5) —— 随机数取两端时正好落在区间两头', () => {
  assert.deepStrictEqual(apiRetryDelayMs(err429(), 1, () => 0), { waitMs: 2500, why: 'backoff' });
  assert.deepStrictEqual(apiRetryDelayMs(err429(), 2, () => 0.999999), { waitMs: 14999, why: 'backoff' });
  assert.deepStrictEqual(apiRetryDelayMs(err429(), 2, () => 0.5), { waitMs: 10000, why: 'backoff' });
});
check('没给 retry-after：真随机数下 200 次不是同一个值（同时撞上的几条会散开）', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const { waitMs } = apiRetryDelayMs(err429(), 1);
    assert.ok(waitMs >= 2500 && waitMs < 7500, String(waitMs));
    seen.add(waitMs);
  }
  assert.ok(seen.size > 50, `只有 ${seen.size} 种值`);
});
check('retry-after 秒数（SDK 给的是 Headers 对象）⟹ 照它等，不加抖动', () => {
  assert.deepStrictEqual(apiRetryDelayMs(err429(new Headers({ 'retry-after': '7' })), 1), { waitMs: 7000, why: 'retry-after' });
  assert.deepStrictEqual(apiRetryDelayMs(err429(new Headers({ 'retry-after': '0' })), 2), { waitMs: 0, why: 'retry-after' });
});
check('retry-after-ms 优先于 retry-after；普通对象形状的 headers 也认', () => {
  assert.strictEqual(retryAfterMs(err429(new Headers({ 'retry-after-ms': '1500', 'retry-after': '9' }))), 1500);
  assert.strictEqual(retryAfterMs(err429({ 'retry-after': '3' })), 3000);
});
check('retry-after 是 HTTP 日期 ⟹ 算到那一刻还有多久', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  assert.strictEqual(retryAfterMs(err429(new Headers({ 'retry-after': 'Tue, 06 Oct 2026 12:00:20 GMT' })), now), 20000);
});
check('跟 SDK 同一个口径：≥ 60 秒 / 负数 / 读不懂 ⟹ 当没给，回到带抖动的退避', () => {
  for (const v of ['60', '3600', '-1', 'soon']) {
    assert.strictEqual(retryAfterMs(err429(new Headers({ 'retry-after': v }))), null, v);
    assert.strictEqual(apiRetryDelayMs(err429(new Headers({ 'retry-after': v })), 1, () => 0.5).why, 'backoff', v);
  }
  assert.strictEqual(retryAfterMs(new Error('no headers')), null);
  assert.strictEqual(retryAfterMs(undefined), null);
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
