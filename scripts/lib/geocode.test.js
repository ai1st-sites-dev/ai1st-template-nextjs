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
    check(u.searchParams.get('addressdetails') === '1', `#1530：同一个请求带 addressdetails=1（城市顺带回来，不多发请求）（${url}）`);
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

  // #1530 —— 城市。三份夹具是**录下来的真响应**（2026-10-02，带仓里那个 User-Agent 逐个发、间隔 1.5 秒，`limit=1&addressdetails=1`），
  //    只留 lat / lon / address 三样。键名不固定（city / town / village / municipality）就是从这几份里看出来的。
  console.log('\n── 城市：addressdetails 里按 city → town → village → municipality 取（#1530）');
  {
    const REC_CITY = [{ lat: '43.7037100', lon: '-79.3980100', address: { house_number: '2150', road: 'Yonge Street', city_block: 'Yonge-Eglinton', quarter: 'Toronto—St. Paul\'s', city: 'Toronto', state: 'Ontario', 'ISO3166-2-lvl4': 'CA-ON', postcode: 'M4S 2A7', country: 'Canada', country_code: 'ca' } }];
    const REC_TOWN = [{ lat: '44.5027226', lon: '-80.2172379', address: { town: 'Collingwood', county: 'Simcoe County', state_district: 'Central Ontario', state: 'Ontario', 'ISO3166-2-lvl4': 'CA-ON', country: 'Canada', country_code: 'ca' } }];
    const REC_NONE = [{ lat: '45.6571356', lon: '-78.4995386', address: { national_park: 'Algonquin Provincial Park', state: 'Ontario', 'ISO3166-2-lvl4': 'CA-ON', country: 'Canada', country_code: 'ca' } }];

    G._reset();
    const a = await G.geocodeAddress('2150 Yonge St, Toronto, ON', { fetchImpl: fakeFetch(REC_CITY), ...noSleep });
    check(a && a.city === 'Toronto' && a.lat === 43.70371, `返回 city ⟹ city = "Toronto"、坐标照旧（${JSON.stringify(a)}）`);
    G._reset();
    const b = await G.geocodeAddress('Collingwood, Ontario', { fetchImpl: fakeFetch(REC_TOWN), ...noSleep });
    check(b && b.city === 'Collingwood', `只返回 town ⟹ city = "Collingwood"（${JSON.stringify(b)}）`);
    G._reset();
    const c = await G.geocodeAddress('Algonquin Provincial Park', { fetchImpl: fakeFetch(REC_NONE), ...noSleep });
    check(c && !('city' in c) && c.lat === 45.6571356, `一个都没有 ⟹ 不带 city 这一格、坐标照旧（${JSON.stringify(c)}）`);
    // 反向对照：state 是有值的（Ontario），取它就会画省名 —— 上一格读不到 city 说明没有把 state 当城市。
    check(REC_NONE[0].address.state === 'Ontario', '反向对照：那份响应里 state 有值 —— 上一格没把它当城市');
    check(G.CITY_KEYS.join(',') === 'city,town,village,municipality', `取的顺序 ${G.CITY_KEYS.join(' → ')}`);

    // 写进站点数据：有城市就写、没有就删掉旧的（地址改了、旧城市还挂着 = 页脚画错城）。
    G._reset();
    const b1 = { locations: [{ label: 'x', address: '2150 Yonge St, Toronto, ON', phone: '1' }] };
    await G.geocodeBrand(b1, { fetchImpl: fakeFetch(REC_CITY), ...noSleep });
    check(b1.locations[0].city === 'Toronto' && JSON.stringify(b1.locations[0].geo) === '{"lat":43.70371,"lng":-79.39801}',
      `geocodeBrand ⟹ locations[0].city = "Toronto"，geo 仍只有 lat / lng（${JSON.stringify(b1.locations[0])}）`);
    G._reset();
    const b2 = { locations: [{ label: 'x', address: 'Algonquin Provincial Park', phone: '1', city: 'Toronto' }] };
    await G.geocodeBrand(b2, { fetchImpl: fakeFetch(REC_NONE), ...noSleep });
    check(!('city' in b2.locations[0]) && b2.locations[0].geo, `查到坐标但没有城市 ⟹ 旧 city 删掉（${JSON.stringify(b2.locations[0])}）`);
    G._reset();
    const b3 = { locations: [{ label: 'x', address: 'Nowhere', phone: '1', city: 'Toronto', geo: { lat: 1, lng: 2 } }] };
    await G.geocodeBrand(b3, { fetchImpl: fakeFetch([]), ...noSleep });
    check(!('city' in b3.locations[0]) && !('geo' in b3.locations[0]), '查不到 ⟹ 旧 city、旧 geo 一起删');

    // #1551 —— 街道（门牌号 + 街道名）与邮编：同一份录下来的响应里取，给 LocalBusiness 的 streetAddress / postalCode。
    check(a && a.street === '2150 Yonge Street' && a.postcode === 'M4S 2A7', `REC_CITY ⟹ street = "2150 Yonge Street"、postcode = "M4S 2A7"（${JSON.stringify(a)}）`);
    check(b && !('street' in b) && !('postcode' in b), `只有 town、没有 road / postcode ⟹ 两格都不带（${JSON.stringify(b)}）`);
    check(b1.locations[0].streetAddress === '2150 Yonge Street' && b1.locations[0].postalCode === 'M4S 2A7',
      `geocodeBrand ⟹ locations[0].streetAddress / postalCode 写进去（${JSON.stringify(b1.locations[0])}）`);
    G._reset();
    const b4 = { locations: [{ label: 'x', address: 'Collingwood, Ontario', phone: '1', streetAddress: '1 Old St', postalCode: 'A1A 1A1' }] };
    await G.geocodeBrand(b4, { fetchImpl: fakeFetch(REC_TOWN), ...noSleep });
    check(!('streetAddress' in b4.locations[0]) && !('postalCode' in b4.locations[0]) && b4.locations[0].city === 'Collingwood',
      `地址改了、新结果没有街道 / 邮编 ⟹ 旧的两格删掉（不留一个指着老地方的街道）（${JSON.stringify(b4.locations[0])}）`);
    G._reset();
    const onlyNum = await G.geocodeAddress('x', { fetchImpl: fakeFetch([{ lat: '1', lon: '2', address: { house_number: '7' } }]), ...noSleep });
    check(onlyNum && !('street' in onlyNum), '只有门牌号、没有街道名 ⟹ 不出街道');
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
