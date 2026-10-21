#!/usr/bin/env node
/**
 * locations.test.js — #1976（Epic:MultiLocation T1）：营业时间、评分、坐标按地点存，老网站读的时候搬、写的时候落盘。
 *   ① 老形状 content 经读的那一步（derive-core §deriveSite）→ `locations[0].hours` 等于原 `openingHours`，各语言 seo 里没有了
 *   ② 同一份 content 跑两次，结果相同；已经是新形状的 content 再跑一次也不变
 *   ③ 碰了 `brand.json` 的补丁（§contentPatchesOf）→ 所有语言 `seo.json` 都没有 `openingHours` / `aggregateRating`，`brand.json` 有
 *   ④ 一笔只碰页面文件 → 补丁里没有 `brand.json` / `seo.json`
 *   ⑤ 三个地点、`sites.geo` 两项 → 地址对上的两家有 geo、第三家没有；拖动排序后结果不变（§mergeGeo）；老的单个对象当一项
 *   ⑥ 老形状带 `aggregateRating` → `locations[0].rating` 的两个数等于原值（JSON-LD 那一半在 site-render.test.js ⑧）
 *   ⑦ §siteRating 丢掉 `count: 0` / `rating: 6` 那一项，与 reviews 块对同一组数算出的总分相同
 *   ⑧ 直接读站点数据的地方（§mainLocationFacts / contact-facts §siteFactsFrom）：seo 里有老形状以它为准，没有就读地点
 *
 * 跑法:  node scripts/lib/locations.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（不许当成通过）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
let fail = 0;
const check = (cond, m, extra) => {
  if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}${extra === undefined ? '' : ` —— ${JSON.stringify(extra)}`}`); }
};
const J = (v) => JSON.stringify(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

let L;
let D;
let C;
try {
  L = require('./locations');
  D = require('./derive-core');
  C = require('./contact-facts');
} catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'site-fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf-8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-test-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const derive = async (content) => {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await D.deriveSite({ content: clone(content), outDir: path.join(tmp, `out-${n += 1}`), purge: false, skipSiteCss: true });
  } finally { console.log = log; console.error = err; }
};

(async () => {
  console.log('══ #1976 营业时间 / 评分 / 坐标按地点存 ══');

  const blog = fixture('site-blog');
  const multi = fixture('site-multilang');
  const rated = fixture('site-rated');
  const oldHours = blog['en/seo.json'].schema.openingHours;
  // 阳性对照：夹具是老形状 —— 营业时间在 seo.json 里、地点上没有、没有 id。不成立的话下面每一格都是空尺。
  check(oldHours && !blog['brand.json'].locations[0].hours && !blog['brand.json'].locations[0].id,
    '夹具 site-blog 是老形状（seo.json 有 openingHours，locations[0] 没有 hours / id）');
  check(J(rated['en/seo.json'].schema.aggregateRating) === J({ ratingValue: 4.7, reviewCount: 128 }), '夹具 site-rated 的 seo.json 带评分 4.7 / 128');

  console.log('\n── ① 读的那一步：老形状的营业时间进 locations[0]，各语言 seo 里没有了');
  const d1 = (await derive(multi)).data;
  check(J(d1.brand.locations[0].hours) === J(multi['en/seo.json'].schema.openingHours), 'locations[0].hours 等于默认语言 seo.json 的 openingHours', d1.brand.locations[0]);
  check(d1.locales.every((l) => !('openingHours' in d1.seoByLocale[l].schema) && !('aggregateRating' in d1.seoByLocale[l].schema)),
    `内存里 ${d1.locales.join(' / ')} 两种语言的 seo.schema 都没有 openingHours / aggregateRating`);
  check(d1.brand.locations[0].id === 'loc-0', '没有 id 的地点按下标补 loc-0', d1.brand.locations[0].id);

  console.log('\n── ② 同一份 content 跑两次结果相同；新形状再跑也不变');
  const d2 = (await derive(multi)).data;
  check(J(d2.brand) === J(d1.brand) && J(d2.seoByLocale) === J(d1.seoByLocale), '两次读出来的 brand / seo 逐字节相同');
  {
    const lifted = L.liftLocationFacts(multi['brand.json'], multi['en/seo.json']);
    const again = L.liftLocationFacts(lifted, { schema: {} });
    check(J(again) === J(lifted), '已经搬过（seo 里没有、id 齐了）再搬一次 ⟹ 不变');
    const twoIds = L.withLocationIds([{ label: 'a', id: 'loc-1' }, { label: 'b' }, { label: 'c' }]);
    check(J(twoIds.map((l) => l.id)) === J(['loc-1', 'loc-1-1', 'loc-2']), '补的 id 撞上已有的 ⟹ 接 -1，不重复', twoIds.map((l) => l.id));
    const fresh = L.newLocationId(['loc-0']);
    check(/^loc-[0-9a-f]{4}$/.test(fresh) && fresh !== 'loc-0', `新地点 id = loc- + 4 位十六进制（${fresh}）`);
  }

  console.log('\n── ③ 碰了 brand.json 的补丁：搬进 brand.json，所有语言 seo.json 都删掉那两项');
  const withRating = clone(multi);
  for (const l of ['en', 'fr']) withRating[`${l}/seo.json`].schema.aggregateRating = { ratingValue: 4.2, reviewCount: 9, source: 'Google' };
  const p3 = D.contentPatchesOf(clone(withRating), { touchedFiles: ['brand.json'] });
  check(J(p3['brand.json'] && p3['brand.json'].locations[0].hours) === J(multi['en/seo.json'].schema.openingHours), '补丁的 brand.json：locations[0].hours = 原营业时间');
  check(J(p3['brand.json'] && p3['brand.json'].locations[0].rating) === J({ ratingValue: 4.2, reviewCount: 9, source: 'Google' }), '补丁的 brand.json：locations[0].rating = 原评分（带 source）');
  check(['en/seo.json', 'fr/seo.json'].every((r) => p3[r] && !('openingHours' in p3[r].schema) && !('aggregateRating' in p3[r].schema)),
    '补丁里 en / fr 两份 seo.json 都没有 openingHours / aggregateRating', Object.keys(p3));
  check(['en/seo.json', 'fr/seo.json'].every((r) => J({ ...p3[r], schema: undefined }) === J({ ...withRating[r], schema: undefined })
    && J(Object.keys(p3[r].schema)) === J(Object.keys(withRating[r].schema).filter((k) => k !== 'openingHours' && k !== 'aggregateRating'))),
  'seo.json 别的键一个没动');
  {
    const bySeo = D.contentPatchesOf(clone(withRating), { touchedFiles: ['fr/seo.json'] });
    check(!!bySeo['brand.json'] && !!bySeo['en/seo.json'] && !!bySeo['fr/seo.json'], '只碰了某一种语言的 seo.json 也算 ⟹ 同样搬', Object.keys(bySeo));
    const applied = { ...clone(withRating), ...p3 };
    const twice = D.contentPatchesOf(applied, { touchedFiles: ['brand.json'] });
    check(!('brand.json' in twice) && !('en/seo.json' in twice) && !('fr/seo.json' in twice), '落过盘再存一次 ⟹ 补丁里没有 brand.json / seo.json（重复跑结果不变）', Object.keys(twice));
    const dApplied = (await derive(applied)).data;
    check(J(dApplied.brand.locations[0].hours) === J(d1.brand.locations[0].hours), '落过盘的站读出来的营业时间跟没落盘时读出来的一样');
  }

  console.log('\n── ④ 只碰页面文件：补丁里没有 brand.json / seo.json');
  {
    const p4 = D.contentPatchesOf(clone(withRating), { touchedFiles: ['en/pages/about.json'] });
    check(!('brand.json' in p4) && !Object.keys(p4).some((k) => /seo\.json$/.test(k)), `补丁的键：${Object.keys(p4).join(', ')}`);
    const p4b = D.contentPatchesOf(clone(withRating));
    check(!('brand.json' in p4b) && !Object.keys(p4b).some((k) => /seo\.json$/.test(k)), '不给 touchedFiles ⟹ 也不搬');
    check(J(D.locationFactFilesChanged(withRating, { ...withRating, 'en/pages/about.json': { slug: 'about', blocks: [] } })) === '[]',
      '§locationFactFilesChanged：只改了页面 ⟹ []');
    const changed = D.locationFactFilesChanged(withRating, { ...withRating, 'brand.json': { ...withRating['brand.json'], email: 'x@y.z' } });
    check(J(changed) === J(['brand.json']), '§locationFactFilesChanged：改了 brand.json ⟹ [brand.json]', changed);
    const asText = { ...withRating, 'brand.json': JSON.stringify(withRating['brand.json']) };
    check(J(D.locationFactFilesChanged(withRating, asText)) === '[]', '§locationFactFilesChanged：同一份 JSON 一边是字符串一边是对象 ⟹ 不算改了');
  }

  console.log('\n── ⑤ sites.geo 一组，按地址对');
  {
    const brand = { locations: [
      { id: 'loc-a', label: 'A', address: '1 First St' },
      { id: 'loc-b', label: 'B', address: '2 Second St' },
      { id: 'loc-c', label: 'C', address: '3 Third St' },
    ] };
    const geo = [{ address: '2 Second St', lat: 2, lng: -2 }, { address: '1 First St', lat: 1, lng: -1, city: 'Toronto' }];
    const m = L.mergeGeo(brand, geo);
    check(J(m.locations.map((l) => l.geo || null)) === J([{ lat: 1, lng: -1 }, { lat: 2, lng: -2 }, null]), '对上的两家有 geo（只并 lat/lng），第三家没有', m.locations);
    const moved = { locations: [brand.locations[2], brand.locations[0], brand.locations[1]] };
    const m2 = L.mergeGeo(moved, geo);
    const byId = (b) => J(b.locations.map((l) => [l.id, l.geo || null]).sort((x, y) => x[0].localeCompare(y[0])));
    check(byId(m2) === byId(m), '拖动排序之后每家的 geo 不变');
    check(J(L.mergeGeo(brand, { address: '3 Third St', lat: 3, lng: -3 }).locations[2].geo) === J({ lat: 3, lng: -3 }), '老的单个对象 {lat, lng, address} 当成一项');
    check(L.mergeGeo(brand, [{ address: 'nowhere', lat: 9, lng: 9 }]) === brand, '一项都对不上 ⟹ 原样返回');
    const stripped = L.stripGeo(m);
    check(stripped.brand.locations.every((l) => !('geo' in l)) && J(stripped.entries) === J([{ lat: 1, lng: -1, address: '1 First St' }, { lat: 2, lng: -2, address: '2 Second St' }]),
      '§stripGeo：每家的 geo 都剥掉，剥下来的是一组 {lat, lng, address}', stripped.entries);
    check(J(L.geoEntries({ lat: 1, lng: 2, address: 'x' })) === J([{ lat: 1, lng: 2, address: 'x' }]) && J(L.geoEntries(null)) === '[]', '§geoEntries：对象 ⟹ 一项，null ⟹ 空');
  }

  console.log('\n── ⑥ 老形状的评分进 locations[0].rating，两个数不变');
  {
    const d6 = (await derive(rated)).data;
    const r = d6.brand.locations[0].rating || {};
    check(r.ratingValue === 4.7 && r.reviewCount === 128, `locations[0].rating = ${J(r)}`);
    check(!('aggregateRating' in d6.seoByLocale.en.schema), '内存里 en/seo.json 没有 aggregateRating 了');
  }

  console.log('\n── ⑦ 整站评分：丢掉不合格的那一项，与 reviews 块同一个算法');
  {
    // reviews 块（blocks/reviews/Section.tsx）的算法：count ≤ 0 / 分数不在 0..5 的丢掉；Σ(rating×count)÷Σcount，一位小数。
    const reviewsTotal = (platforms) => {
      const ok = platforms.filter((p) => Number.isFinite(p.rating) && p.rating >= 0 && p.rating <= 5 && Number.isFinite(p.count) && p.count > 0)
        .map((p) => ({ rating: p.rating, count: Math.round(p.count) }));
      const totalCount = ok.reduce((s, p) => s + p.count, 0);
      return { ratingValue: totalCount ? Math.round((ok.reduce((s, p) => s + p.rating * p.count, 0) / totalCount) * 10) / 10 : 0, reviewCount: totalCount };
    };
    const rows = [{ rating: 4.6, count: 212 }, { rating: 3.1, count: 235 }, { rating: 5, count: 0 }, { rating: 6, count: 40 }];
    const brand = { locations: rows.map((x, i) => ({ id: `loc-${i}`, label: String(i), rating: { ratingValue: x.rating, reviewCount: x.count } })) };
    const got = L.siteRating(brand);
    check(J(got) === J(reviewsTotal(rows)), `siteRating = reviews 块的总分（${J(got)}）`, reviewsTotal(rows));
    check(got.reviewCount === 447, 'count: 0 和 rating: 6 那两项不算进条数（212 + 235 = 447）');
    check(L.siteRating({ locations: [{ label: 'x' }] }) === null && L.siteRating({}) === null, '没有能用的评分 ⟹ null');
    check(J(L.siteRating({ locations: [{ rating: { ratingValue: 4.25, reviewCount: 3.6 } }] })) === J({ ratingValue: 4.3, reviewCount: 4 }), '条数取整、分数一位小数');
  }

  console.log('\n── ⑧ 直接读站点数据：seo 里有老形状以它为准，没有就读地点');
  {
    const hours = [{ days: ['Monday'], opens: '10:00', closes: '16:00' }];
    const brand = { email: 'a@b.c', locations: [{ label: 'x', phone: '416-555-0101', address: '1 First St', hours }] };
    check(C.siteFactsFrom(brand, { schema: {} }).hours === 'Mon · 10am – 4pm', 'contact 那一行读地点的 hours');
    check(C.siteFactsFrom(brand, { schema: { openingHours: { days: ['Tuesday'], opens: '09:00', closes: '17:00' } } }).hours === 'Tue · 9am – 5pm',
      'seo.json 里还有老形状（没搬过 / AI 刚写回去 / 回退）⟹ 以它为准');
    check(C.siteFactsFrom({ locations: [{ label: 'x' }] }, { schema: { openingHours: hours } }).hours === 'Mon · 10am – 4pm', '老站：地点上没有、seo 里有 ⟹ 照读');
    check(J(L.mainLocationFacts({}, null)) === J({ hours: undefined, rating: undefined }) && L.mainLocation({ locations: [] }) === null, '没有地点 ⟹ 都是空');
    const noLoc = { name: 'x' };
    check(L.liftLocationFacts(noLoc, { schema: { openingHours: hours } }) === noLoc, '没有地点的站不搬（原样返回，营业时间留在 seo.json）');
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(`🔴 跑不起来: ${e.stack || e.message}`); process.exit(2); });
