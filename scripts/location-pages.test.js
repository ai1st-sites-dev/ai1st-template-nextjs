#!/usr/bin/env node
// #1979（Epic:MultiLocation T4）—— 地点页的纯函数那一半（`lib/location-pages.js`）+ 它接上的几处（页脚 `{source:"locations"}`、
// 菜单同步不收地点页、关键词页判据、`validateSite` 的 `locationsAuto`）。建站 / 渲染 / 命令行那一半在 location-pages-site.test.js。
//
//   验收 1  三个地点（两家 city 都是 Newmarket）⟹ 1 张总览 + 3 张地点页，slug 是 newmarket-<街道> 两个 + 第三个城市；
//           再跑一遍补丁为空；从菜单删掉 Locations 再跑一遍菜单不变；减到一个地点 ⟹ 删掉这 4 张页、菜单项、首页带 locationsAuto 的那一块；
//           一张手写的、没有标记的 locations.json 不被删
//   验收 7  AI 打桩（不带 skip-ai 那条路）：三个地点、两家已有地点页 ⟹ 发给 AI 的请求里只有缺页面的那一家；输出的花费 = 桩报的；
//           提示词里有「只用给出的事实」「各地点不要互相抄句子」两条
'use strict';

const assert = require('assert');
const lp = require('./lib/location-pages');
const itemSources = require('./lib/item-sources');
const { isKeywordPage } = require('./lib/keyword-service');
const { contentPatchesOf } = require('./lib/derive-core');
const manifestLib = require('./lib/block-manifest');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const apply = (content, patch) => {
  const out = { ...content };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete out[k]; else out[k] = v; }
  return out;
};

const LOCS = [
  { id: 'loc-0', label: 'Maple Davis', address: '130 Davis Dr, Newmarket, ON', phone: '(905) 555-0101', city: 'Newmarket', streetAddress: '130 Davis Dr' },
  { id: 'loc-1', label: 'Maple Yonge', address: '17600 Yonge St, Newmarket, ON', city: 'Newmarket', streetAddress: '17600 Yonge St' },
  { id: 'loc-2', label: 'Maple Pickering', address: '1355 Kingston Rd, Pickering, ON', phone: '(905) 555-0303', city: 'Pickering', streetAddress: '1355 Kingston Rd',
    reviews: [{ quote: 'Fixed my tooth same day.', name: 'Carla M.', rating: 5, source: 'google' }] },
];
function site(locations = LOCS, extra = {}) {
  return {
    'site_meta.json': { siteId: 'site-test', defaultLocale: 'en', locales: ['en'] },
    'brand.json': { name: { en: 'Maple Smiles' }, email: 'hi@maple.test', locations: clone(locations) },
    'en/services.json': [{ id: 'cleaning', name: 'Cleaning' }, { id: 'whitening', name: 'Whitening' }],
    'en/seo.json': { siteTitle: 'Maple Smiles', siteDescription: 'Dentist' },
    'en/navigation.json': {
      header: { links: [{ label: 'Home', href: '/' }, { label: 'Contact', href: '/contact' }], knownPages: ['contact'] },
      footer: { columns: [{ title: 'Quick Links', links: [{ label: 'Home', href: '/' }, { label: 'Contact', href: '/contact' }] }] },
    },
    'en/pages/home.json': { slug: 'home', title: 'Home', blocks: [
      { id: 'home-hero-0', type: 'hero', weight: 0, data: { headline: 'Hi' } },
      { id: 'home-features-1', type: 'features', weight: 10, data: { headline: 'F' } },
      { id: 'home-cta-2', type: 'cta', weight: 20, data: { headline: 'Book' } },
    ] },
    'en/pages/contact.json': { slug: 'contact', title: 'Contact', navLabel: 'Contact', blocks: [{ id: 'contact-contact-0', type: 'contact', data: { headline: 'Contact' } }] },
    ...extra,
  };
}

(async () => {
  console.log('验收 1 —— 生成、重跑、删菜单项、减到一个、手写页');
  const base = site();
  const p1 = lp.locationPagesPatch(base);
  const after = apply(base, p1);
  await check('1 张总览 + 3 张地点页，slug = newmarket-<街道> 两个 + pickering', () => {
    const pages = Object.keys(p1).filter((k) => k.startsWith('en/pages/locations')).sort();
    assert.deepStrictEqual(pages, ['en/pages/locations.json', 'en/pages/locations/newmarket-130-davis-dr.json',
      'en/pages/locations/newmarket-17600-yonge-st.json', 'en/pages/locations/pickering.json']);
    assert.deepStrictEqual(p1['en/pages/locations.json'].locationPage, { kind: 'overview' });
    assert.deepStrictEqual(p1['en/pages/locations/pickering.json'].locationPage, { kind: 'location', id: 'loc-2' });
  });
  await check('slug 写回 brand.json（以后不再改）', () => {
    assert.deepStrictEqual(p1['brand.json'].locations.map((l) => l.slug), ['newmarket-130-davis-dr', 'newmarket-17600-yonge-st', 'pickering']);
  });
  await check('地点页的块：page-header · contact(map-beside, location=这一家, 地址/电话/营业时间) · content · testimonials(有评价才有) · cta', () => {
    const pk = p1['en/pages/locations/pickering.json'].blocks;
    assert.deepStrictEqual(pk.map((b) => b.type), ['page-header', 'contact', 'content', 'testimonials', 'cta']);
    const ct = pk[1];
    assert.strictEqual(ct.shape, 'map-beside');
    assert.strictEqual(ct.data.location, 'loc-2');
    assert.deepStrictEqual(ct.data.items.map((i) => i.kind), ['address', 'phone', 'hours']);
    assert.deepStrictEqual(pk[3].data.items, LOCS[2].reviews);
    assert.strictEqual(pk[2].data.body, 'Maple Smiles Maple Pickering — 1355 Kingston Rd, Pickering, ON');
    assert.ok(!p1['en/pages/locations/newmarket-17600-yonge-st.json'].blocks.some((b) => b.type === 'testimonials'), '没有评价的那一家不该有 testimonials');
  });
  await check('总览页：page-header · contact(location-cards，不写 location) · cta', () => {
    const ov = p1['en/pages/locations.json'].blocks;
    assert.deepStrictEqual(ov.map((b) => [b.type, b.shape]), [['page-header', undefined], ['contact', 'location-cards'], ['cta', undefined]]);
    assert.ok(!('location' in ov[1].data));
  });
  await check('菜单末尾加一项 /locations（Locations）；首页 cta 之前一块 Compact、带 locationsAuto', () => {
    assert.deepStrictEqual(p1['en/navigation.json'].header.links.at(-1), { label: 'Locations', href: '/locations' });
    const home = p1['en/pages/home.json'].blocks;
    assert.deepStrictEqual(home.map((b) => b.type), ['hero', 'features', 'contact', 'cta']);
    const auto = home[2];
    assert.strictEqual(auto.shape, 'compact');
    assert.strictEqual(auto.locationsAuto, true);
    assert.ok(!('location' in auto.data));
    assert.strictEqual(auto.weight, 20, '权重取 cta 的（同权按数组先后排在它前面）');
  });
  await check('再跑一遍补丁为空', () => assert.deepStrictEqual(lp.locationPagesPatch(after), {}));
  await check('从菜单删掉 Locations 后再跑：菜单不变（补丁为空）', () => {
    const nav = clone(after['en/navigation.json']);
    nav.header.links = nav.header.links.filter((l) => l.href !== '/locations');
    assert.deepStrictEqual(lp.locationPagesPatch({ ...after, 'en/navigation.json': nav }), {});
  });
  await check('首页那块被老板删了再跑：不再加回来', () => {
    const home = clone(after['en/pages/home.json']);
    home.blocks = home.blocks.filter((b) => !b.locationsAuto);
    assert.deepStrictEqual(lp.locationPagesPatch({ ...after, 'en/pages/home.json': home }), {});
  });
  await check('减到一个地点 ⟹ 删 4 张页、菜单项、首页那一块', () => {
    const one = { ...after, 'brand.json': { ...after['brand.json'], locations: after['brand.json'].locations.slice(0, 1) } };
    const p = lp.locationPagesPatch(one);
    const deleted = Object.keys(p).filter((k) => p[k] === null).sort();
    assert.deepStrictEqual(deleted, ['en/pages/locations.json', 'en/pages/locations/newmarket-130-davis-dr.json',
      'en/pages/locations/newmarket-17600-yonge-st.json', 'en/pages/locations/pickering.json']);
    assert.ok(!p['en/navigation.json'].header.links.some((l) => l.href === '/locations'));
    assert.deepStrictEqual(p['en/pages/home.json'].blocks.map((b) => b.type), ['hero', 'features', 'cta']);
    assert.ok(!('brand.json' in p), 'brand.json 不该动');
  });
  await check('一张手写的、没有标记的 locations.json：一个地点时不被删、菜单里指着它的那一项也不动', () => {
    const handwritten = { slug: 'locations', title: 'Where we are', blocks: [{ type: 'content', data: { body: 'x' } }] };
    const nav = clone(base['en/navigation.json']);
    nav.header.links.push({ label: 'Where', href: '/locations' });
    assert.deepStrictEqual(lp.locationPagesPatch(site(LOCS.slice(0, 1), { 'en/pages/locations.json': handwritten, 'en/navigation.json': nav })), {});
  });
  await check('手写的 locations.json + 三个地点：它不被覆盖，总览不建、菜单首页不碰，地点页照建', () => {
    const handwritten = { slug: 'locations', title: 'Where we are', blocks: [{ type: 'content', data: { body: 'x' } }] };
    const p = lp.locationPagesPatch(site(LOCS, { 'en/pages/locations.json': handwritten }));
    assert.ok(!('en/pages/locations.json' in p));
    assert.ok(!('en/navigation.json' in p) && !('en/pages/home.json' in p));
    assert.strictEqual(Object.keys(p).filter((k) => k.startsWith('en/pages/locations/')).length, 3);
  });
  await check('跟一张没有标记的已有页撞了 slug ⟹ 加后缀', () => {
    const p = lp.locationPagesPatch(site(LOCS, { 'en/pages/locations/pickering.json': { slug: 'locations/pickering', title: 'old', blocks: [] } }));
    assert.ok('en/pages/locations/pickering-2.json' in p, Object.keys(p).join(' '));
    assert.ok(!('en/pages/locations/pickering.json' in p));
    assert.strictEqual(p['brand.json'].locations[2].slug, 'pickering-2');
  });
  await check('已存的 slug 原样用；一家没了（还剩 ≥2）⟹ 它那张标记页删掉', () => {
    const two = { ...after, 'brand.json': { ...after['brand.json'], locations: after['brand.json'].locations.filter((l) => l.id !== 'loc-1') } };
    const p = lp.locationPagesPatch(two);
    assert.deepStrictEqual(Object.keys(p), ['en/pages/locations/newmarket-17600-yonge-st.json']);
    assert.strictEqual(p['en/pages/locations/newmarket-17600-yonge-st.json'], null);
  });
  await check('只有一家、没有任何标记页 ⟹ 补丁为空（不写 slug）', () => assert.deepStrictEqual(lp.locationPagesPatch(site(LOCS.slice(0, 1))), {}));
  await check('两种语言：各 4 张页、各自的菜单和首页', () => {
    const fr = site(LOCS, {
      'site_meta.json': { siteId: 's', defaultLocale: 'en', locales: ['en', 'fr'] },
      'fr/navigation.json': clone(base['en/navigation.json']),
      'fr/pages/home.json': clone(base['en/pages/home.json']),
    });
    const p = lp.locationPagesPatch(fr);
    for (const l of ['en', 'fr']) assert.strictEqual(Object.keys(p).filter((k) => k.startsWith(`${l}/pages/locations`)).length, 4, l);
    assert.deepStrictEqual(p['fr/navigation.json'].header.links.at(-1), { label: 'Emplacements', href: '/locations' });
    assert.strictEqual(p['fr/pages/locations/pickering.json'].blocks[1].data.headline, 'Venez nous voir');
  });

  console.log('建站存评价（§做什么 4）');
  await check('按下标存、只存 ≥4 星（没有 rating 当 5）、不带 location 的不存、0 条的不写 reviews 键', () => {
    const locs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = lp.storeLocationReviews(locs, [
      { text: 'A1', author: 'x', rating: 5, platform: 'google', location: 0 },
      { text: 'A2', author: 'y', location: 0 },
      { text: 'C1', author: 'z', rating: 5, platform: 'yelp', location: 2 },
      { text: 'C2', author: 'w', rating: 2, platform: 'google', location: 2 },
      { text: 'none', author: 'v', rating: 5 },
      { text: 'out of range', rating: 5, location: 3 },
    ]);
    assert.deepStrictEqual(out[0].reviews, [{ quote: 'A1', name: 'x', rating: 5, source: 'google' }, { quote: 'A2', name: 'y' }]);
    assert.ok(!('reviews' in out[1]));
    assert.deepStrictEqual(out[2].reviews, [{ quote: 'C1', name: 'z', rating: 5, source: 'yelp' }]);
  });

  console.log('验收 7 —— AI 打桩：只问缺页的那一家、花费原样、提示词两条要求');
  {
    // 三家里两家已经有地点页（标记页在）。
    const have = apply(base, p1);
    delete have['en/pages/locations/pickering.json'];
    const calls = [];
    const stub = async ({ prompt, wants }) => {
      calls.push({ prompt, wants });
      return {
        parsed: { locations: [{ id: 'loc-2', intros: { en: { paragraphs: ['Pickering paragraph one.', 'Pickering paragraph two.'], description: 'Pickering desc.' } } }] },
        usage: { model: 'stub-model', inputTokens: 1234, outputTokens: 567 },
      };
    };
    const out = await lp.locationPagesCommand({ site: JSON.stringify(have), ai: stub });
    await check('调了一次 AI，请求里只有 loc-2（Pickering）', () => {
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0].wants.map((w) => w.location.id), ['loc-2']);
      assert.ok(calls[0].prompt.includes('Maple Pickering'));
      assert.ok(!calls[0].prompt.includes('Maple Davis') && !calls[0].prompt.includes('Maple Yonge'), '提示词里不该有已经有页的两家');
    });
    await check('输出的花费 = 桩报的那份', () => assert.deepStrictEqual(out.usage, { model: 'stub-model', inputTokens: 1234, outputTokens: 567 }));
    await check('提示词里有「只用给出的事实」「各地点不要互相抄句子」', () => {
      assert.ok(calls[0].prompt.includes('Use only the facts given above'));
      assert.ok(calls[0].prompt.includes('Do not copy sentences between locations'));
    });
    await check('补丁只新建 Pickering 那一张，正文是 AI 给的两段、description 是 AI 给的；块盖了版本号', () => {
      assert.deepStrictEqual(Object.keys(out.patch), ['en/pages/locations/pickering.json']);
      const pg = out.patch['en/pages/locations/pickering.json'];
      assert.strictEqual(pg.description, 'Pickering desc.');
      assert.strictEqual(pg.blocks.find((b) => b.type === 'content').data.body, 'Pickering paragraph one.\n\nPickering paragraph two.');
      assert.ok(pg.blocks.every((b) => Number.isInteger(b.schemaVersion)));
    });
    await check('AI 抛错 ⟹ 不抛，缺的那家落回代码那一句、aiError 带原因、usage 照记', async () => {
      const boom = async () => { const e = new Error('stub 500'); e.usage = { model: 'm', inputTokens: 9, outputTokens: 0 }; throw e; };
      const r = await lp.locationPagesCommand({ site: JSON.stringify(have), ai: boom });
      assert.strictEqual(r.aiError, 'stub 500');
      assert.deepStrictEqual(r.usage, { model: 'm', inputTokens: 9, outputTokens: 0 });
      assert.ok(r.patch['en/pages/locations/pickering.json'].blocks.find((b) => b.type === 'content').data.body.startsWith('Maple Smiles Maple Pickering — '));
    });
    await check('总览页要新建时多要一个菜单字，用 AI 给的那个', async () => {
      const r = await lp.locationPagesCommand({ site: JSON.stringify(base), ai: async ({ prompt }) => {
        assert.ok(prompt.includes('"menuLabel"'));
        return { parsed: { locations: [], menuLabel: { en: 'Our clinics' } }, usage: { model: 'm', inputTokens: 1, outputTokens: 1 } };
      } });
      assert.deepStrictEqual(r.patch['en/navigation.json'].header.links.at(-1), { label: 'Our clinics', href: '/locations' });
    });
    await check('--skip-ai：不调 AI、usage 两个数是 0', async () => {
      let called = false;
      const r = await lp.locationPagesCommand({ site: JSON.stringify(have), skipAI: true, ai: async () => { called = true; return {}; } });
      assert.strictEqual(called, false);
      assert.deepStrictEqual(r.usage, { model: null, inputTokens: 0, outputTokens: 0 });
    });
  }

  console.log('接上的几处');
  await check('页脚 {source:"locations"}：每家 {label, phone(没有用第一家的), href(它的地点页)}', () => {
    const pages = Object.entries(after).filter(([k]) => k.startsWith('en/pages/')).map(([, v]) => v);
    const [footer] = itemSources.resolveItemSources([{ type: 'footer', data: { locations: { source: 'locations' } } }],
      { brand: after['brand.json'], pages, url: (s) => `/${s}` });
    assert.deepStrictEqual(footer.data.locations, [
      { label: 'Maple Davis', phone: '(905) 555-0101', href: '/locations/newmarket-130-davis-dr' },
      { label: 'Maple Yonge', phone: '(905) 555-0101', href: '/locations/newmarket-17600-yonge-st' },
      { label: 'Maple Pickering', phone: '(905) 555-0303', href: '/locations/pickering' },
    ]);
  });
  await check('菜单同步（contentPatchesOf）：地点页不追加进菜单、不进页脚关键词栏', () => {
    const navNow = contentPatchesOf(after)['en/navigation.json'];
    assert.deepStrictEqual(navNow.header.links.map((l) => l.href), ['/', '/contact', '/locations']);
    assert.strictEqual(navNow.footer.columns.length, 1, JSON.stringify(navNow.footer.columns));
  });
  await check('isKeywordPage：locations/<slug> 带标记的不算关键词页，不带标记的照旧算', () => {
    assert.strictEqual(isKeywordPage(after['en/pages/locations/pickering.json']), false);
    assert.strictEqual(isKeywordPage({ slug: 'locations/pickering' }), true);
  });
  await check('validateSite：locationsAuto 只许 contact 块、只许 true', () => {
    const v = (b) => manifestLib.validateSite({ pages: [{ slug: 'home', blocks: [b] }] }).problems.filter((m) => m.includes('locationsAuto'));
    assert.strictEqual(v({ type: 'contact', locationsAuto: true, data: { headline: 'x' } }).length, 0);
    assert.strictEqual(v({ type: 'contact', locationsAuto: 'yes', data: { headline: 'x' } }).length, 1);
    assert.strictEqual(v({ type: 'cta', locationsAuto: true, data: { headline: 'x' } }).length, 1);
    assert.deepStrictEqual(manifestLib.validateSite({ pages: Object.entries(after).filter(([k]) => k.startsWith('en/pages/')).map(([, v]) => v) })
      .problems.filter((m) => /locations|locationsAuto/.test(m)), [], "生成出来的页要过 validateSite");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
