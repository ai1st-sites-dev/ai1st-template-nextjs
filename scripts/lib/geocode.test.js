#!/usr/bin/env node
/**
 * geocode.test.js — #1489 判据 7 最后一条：建站 / 改地址时查坐标的那个请求长什么样（Nominatim 条款三条），
 * 以及查不到 / 网络错时不抛、不留旧坐标。`fetch` 全部注入，不发真请求。
 *
 * 跑法:  node scripts/lib/geocode.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let G;
try { G = require('./geocode'); } catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }

const HIT = [{ lat: '43.7056', lon: '-79.3983' }];
function fakeFetch(rows = HIT, { status = 200, throws = null } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw throws;
    return { ok: status >= 200 && status < 300, status, json: async () => rows };
  };
  f.calls = calls;
  return f;
}
const noSleep = { sleep: async () => {} };

(async () => {
  console.log('── 请求头（条款 ②）');
  {
    G._reset();
    const f = fakeFetch();
    const geo = await G.geocodeAddress('2150 Yonge St, Toronto, ON', { fetchImpl: f, ...noSleep });
    check(geo && geo.lat === 43.7056 && geo.lng === -79.3983, `查到 → { lat, lng } 两个数（${JSON.stringify(geo)}）`);
    check(f.calls.length === 1, `发了 ${f.calls.length} 个请求`);
    const { url, init } = f.calls[0];
    const ua = init && init.headers && init.headers['User-Agent'];
    const u = new URL(url);
    check(u.origin + u.pathname === 'https://nominatim.openstreetmap.org/search' && u.searchParams.get('q') === '2150 Yonge St, Toronto, ON'
      && u.searchParams.get('format') === 'json' && u.searchParams.get('limit') === '1', `打的是 Nominatim /search、q = 地址、limit 1（${url}）`);
    check(typeof ua === 'string' && /ai1st/i.test(ua) && /https:\/\/www\.ai1st\.site/.test(ua), `User-Agent 认得出是我们（${ua}）`);
    check(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(ua), 'User-Agent 里没有任何邮箱');
    const DEFAULT_UA = /^(node|undici|node-fetch|axios|got|python-requests|curl)\b/i;
    check(!DEFAULT_UA.test(ua) && ua !== '*', 'User-Agent 不是 http 库的默认值');
    // 反向对照：同一把尺子对「带邮箱 / 默认值」的 UA 会红。
    check(/[\w.+-]+@[\w-]+\.[\w.]+/.test('ai1st (chris@example.com)') && DEFAULT_UA.test('node'), '反向对照：带邮箱的 UA、node 默认 UA 都会被上面两条拦下');
  }

  console.log('\n── 缓存 + 每秒最多一次（条款 ① ③）');
  {
    G._reset();
    const f = fakeFetch();
    await G.geocodeAddress('A St', { fetchImpl: f, ...noSleep });
    await G.geocodeAddress('A St', { fetchImpl: f, ...noSleep });
    check(f.calls.length === 1, `同一个地址查两次 ⟹ 只发 1 个请求（${f.calls.length}）`);
    G._reset();
    let t = 100000;
    const waits = [];
    const clock = { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } };
    await G.geocodeAddress('A St', { fetchImpl: fakeFetch(), ...clock });
    t += 200;
    await G.geocodeAddress('B St', { fetchImpl: fakeFetch(), ...clock });
    check(waits.length === 1 && waits[0] === G.MIN_INTERVAL_MS - 200, `两个地址隔 200ms ⟹ 第二个先等 ${waits[0]}ms（≥1 秒一次）`);
    check(G.MIN_INTERVAL_MS >= 1000, `MIN_INTERVAL_MS = ${G.MIN_INTERVAL_MS} ≥ 1000`);
  }

  console.log('\n── 查不到 / 出错：不抛、返回 null');
  {
    for (const [name, f] of [['空结果', fakeFetch([])], ['HTTP 429', fakeFetch(HIT, { status: 429 })], ['网络错', fakeFetch(HIT, { throws: new Error('ECONNRESET') })]]) {
      G._reset();
      let r; let threw = null;
      try { r = await G.geocodeAddress('X St', { fetchImpl: f, ...noSleep }); } catch (e) { threw = e; }
      check(!threw && r === null, `${name} ⟹ null、不抛`);
    }
    G._reset();
    const f = fakeFetch();
    check(await G.geocodeAddress('   ', { fetchImpl: f, ...noSleep }) === null && f.calls.length === 0, '空地址 ⟹ null、一个请求都不发');
  }

  console.log('\n── geocodeBrand：写 geo / 查不到删掉旧 geo');
  {
    G._reset();
    const b = { locations: [{ label: 'x', address: 'A St', phone: '1' }] };
    check(await G.geocodeBrand(b, { fetchImpl: fakeFetch(), ...noSleep }) === 'set' && b.locations[0].geo.lat === 43.7056, '查到 ⟹ brand.locations[0].geo 写上');
    G._reset();
    const stale = { locations: [{ label: 'x', address: 'Nowhere', phone: '1', geo: { lat: 1, lng: 2 } }] };
    check(await G.geocodeBrand(stale, { fetchImpl: fakeFetch([]), ...noSleep }) === 'cleared' && !('geo' in stale.locations[0]), '查不到 ⟹ 旧 geo 删掉');
    check(await G.geocodeBrand({ locations: [] }, { fetchImpl: fakeFetch(), ...noSleep }) === 'skipped', '没有地点 ⟹ skipped');
  }

  console.log('\n── refreshGeoAfterEdit：只有地址变了才重查');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'));
    const p = path.join(dir, 'brand.json');
    const before = Buffer.from(JSON.stringify({ locations: [{ address: 'A St', geo: { lat: 1, lng: 2 } }] }));
    try {
      G._reset();
      fs.writeFileSync(p, JSON.stringify({ name: 'n', locations: [{ address: 'A St', geo: { lat: 1, lng: 2 } }] }));
      const f1 = fakeFetch();
      const bytes = fs.readFileSync(p, 'utf-8');
      check(await G.refreshGeoAfterEdit(p, before, { fetchImpl: f1, ...noSleep }) === 'unchanged' && f1.calls.length === 0 && fs.readFileSync(p, 'utf-8') === bytes,
        '地址没变（只改了别的字段）⟹ 不发请求、文件逐字不动');
      fs.writeFileSync(p, JSON.stringify({ locations: [{ address: 'B St', geo: { lat: 1, lng: 2 } }] }));
      const f2 = fakeFetch();
      const r2 = await G.refreshGeoAfterEdit(p, before, { fetchImpl: f2, ...noSleep });
      const after = JSON.parse(fs.readFileSync(p, 'utf-8'));
      check(r2 === 'set' && f2.calls.length === 1 && after.locations[0].geo.lat === 43.7056, `地址变了 ⟹ 重查一次、新坐标写回（${r2}）`);
      G._reset();
      fs.writeFileSync(p, JSON.stringify({ locations: [{ address: 'C St', geo: { lat: 1, lng: 2 } }] }));
      const r3 = await G.refreshGeoAfterEdit(p, before, { fetchImpl: fakeFetch([]), ...noSleep });
      check(r3 === 'cleared' && !('geo' in JSON.parse(fs.readFileSync(p, 'utf-8')).locations[0]), '地址变了但查不到 ⟹ 旧 geo 删掉（钉子不留在老地方）');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(`🔴 跑不起来: ${e.stack || e}`); process.exit(2); });
