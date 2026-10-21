#!/usr/bin/env node
// #1979（Epic:MultiLocation T4）—— 地点页的整条路：真 `site.js create`（skipAI）建站 → 真 `site.js render` 出 HTML → 真 `site.js location-pages`。
// 纯函数那一半在 location-pages.test.js。
//
//   验收 2  三地点 payload（两家 Newmarket、一家 Pickering；评价：第一家 2 条 5 星、Pickering 1 条 5 星 + 1 条 2 星、第二家 0 条，
//           另 1 条不带 location 的 5 星）skipAI 建站 + render：locations/index.html + 三张地点页；地址 / 电话 / 代码那一句介绍；
//           评价逐字、2 星哪儿都没有、不带 location 的不上地点页、第二家没有 testimonials 块、brand.json 2 / 0 / 1；
//           菜单有 Locations、首页有一块 Compact + locationsAuto 的 contact 列出三家、排在 cta 之前；页脚三行各链到它的地点页（三种排布都量）。
//           另渲一次（三家各一份不同的 hours + --geo）：每页只显示它自己那份营业时间，有地图卡片。
//   验收 3  一个地点 skipAI：没有 locations/ 目录，菜单 / 页脚里没有地点那一项
//   验收 4  双语（secondaryLocales）三地点：两种语言各 4 张页
//   验收 6  命令：删掉 Pickering 那页 ⟹ 只新建它、评价从 brand.json 取回、总览 / 菜单 / 首页不动、花费 0；没删过的站 ⟹ 补丁为空；
//           不存在的文件 ⟹ ok:false code bad、退出码 3、没有堆栈
'use strict';

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE_JS = path.join(__dirname, 'site.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loc1979-'));
const BUNDLE = path.join(ROOT, 'render', 'dist', `test-loc1979-${process.pid}`);
process.on('exit', () => {
  if (process.env.LOC_KEEP === '1') { console.log(`📌 LOC_KEEP=1 ⟹ 留着 ${tmp}`); return; }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(BUNDLE, { recursive: true, force: true });
});
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

function node(args, input) {
  return cp.spawnSync(process.execPath, [SITE_JS, ...args], { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 300000 });
}

let n = 0;
function create(label, payload) {
  const out = path.join(tmp, `create-${label}`);
  const r = node(['create', '--out-dir', out], JSON.stringify({ ...payload, skipAI: true }));
  if (r.status !== 0) die(`${label}：建站失败 rc=${r.status}\n${(r.stdout || '').slice(-1500)}\n${(r.stderr || '').slice(-1500)}`);
  return JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')).content;
}
function render(label, content, extra = []) {
  const file = path.join(tmp, `site-${label}-${++n}.json`);
  fs.writeFileSync(file, JSON.stringify(content));
  const out = path.join(tmp, `out-${label}-${n}`);
  const r = node(['render', '--site', file, '--out', out, '--bundle-dir', BUNDLE, ...extra]);
  if (r.status !== 0) die(`${label}：render 失败 rc=${r.status}\n${(r.stderr || '').slice(-2000)}`);
  return (p) => {
    const f = path.join(out, p, 'index.html');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
}
const exists = (dir, p) => fs.existsSync(path.join(dir, p));

const sectionsOf = (html, block) => [...html.matchAll(new RegExp(`<section[^>]*data-block="${block}"[\\s\\S]*?</section>`, 'g'))].map((m) => m[0]);
const footerOf = (html) => (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
const headerOf = (html) => (html.match(/<header[\s\S]*?<\/header>/) || [''])[0];
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (s) => unesc(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const LOCS = [
  { label: 'Maple Smiles Davis Drive', address: '130 Davis Dr, Newmarket, ON L3Y 2N1', phone: '(905) 555-0101', city: 'Newmarket', streetAddress: '130 Davis Dr', postalCode: 'L3Y 2N1' },
  { label: 'Maple Smiles Yonge Street', address: '17600 Yonge St, Newmarket, ON L3Y 4Z1', phone: '(905) 555-0202', city: 'Newmarket', streetAddress: '17600 Yonge St', postalCode: 'L3Y 4Z1' },
  { label: 'Maple Smiles Pickering', address: '1355 Kingston Rd, Pickering, ON L1V 1B8', phone: '(905) 555-0303', city: 'Pickering', streetAddress: '1355 Kingston Rd', postalCode: 'L1V 1B8' },
];
const R = {
  a1: 'Dr. Lee at Davis Drive made my cleaning painless.',
  a2: 'Friendly front desk on Davis, always on time.',
  p5: 'Pickering team fixed my chipped tooth same day.',
  p2: 'Waited an hour in Pickering, not great.',
  none: 'Great dentists across the board, every single visit.',
};
const REVIEWS = [
  { text: R.a1, author: 'Anna K.', rating: 5, platform: 'google', location: 0 },
  { text: R.a2, author: 'Ben T.', rating: 5, platform: 'google', location: 0 },
  { text: R.p5, author: 'Carla M.', rating: 5, platform: 'google', location: 2 },
  { text: R.p2, author: 'Dan P.', rating: 2, platform: 'google', location: 2 },
  { text: R.none, author: 'Eve R.', rating: 5, platform: 'google' },
];
const PAYLOAD = (extra = {}) => ({
  siteId: 'site-1979test', siteUrl: 'https://maplesmiles.test', companyName: 'Maple Smiles Dental', industry: 'dentist',
  location: 'Newmarket, ON', language: 'en', services: ['Cleaning', 'Whitening'], homepageFingerprint: false, skipGeocode: true, ...extra,
});
const SLUGS = ['newmarket-130-davis-dr', 'newmarket-17600-yonge-st', 'pickering'];

// ── 打一份只属于这一跑的包（别拿 render/dist 里一份旧包来判）─────────────────────────────────────
{
  const r = node(['bundle', '--out-dir', BUNDLE]);
  if (r.status !== 0) die(`bundle 失败 rc=${r.status}\n${(r.stderr || '').slice(-2000)}`);
}

console.log('验收 2 —— 三地点 skipAI 建站 + render');
const site3 = create('three', PAYLOAD({ locations: LOCS, reviews: REVIEWS }));
const page = render('three', site3);
const locPages = SLUGS.map((s) => page(`locations/${s}`));
check('locations/index.html + 三张地点页都在', () => {
  assert.ok(page('locations'), '没有 locations/index.html');
  locPages.forEach((h, i) => assert.ok(h, `没有 locations/${SLUGS[i]}/index.html`));
});
check('每张地点页有地址、电话；介绍是「<品牌名> <地点名> — <地址>」', () => {
  locPages.forEach((h, i) => {
    const contact = textOf(sectionsOf(h, 'contact')[0] || '');
    assert.ok(contact.includes(LOCS[i].address), `${SLUGS[i]} 的 contact 里没有地址：${contact}`);
    assert.ok(contact.includes(LOCS[i].phone), `${SLUGS[i]} 的 contact 里没有电话：${contact}`);
    const intro = textOf(sectionsOf(h, 'content')[0] || '');
    assert.strictEqual(intro, `Maple Smiles Dental ${LOCS[i].label} — ${LOCS[i].address}`);
  });
});
check('评价：第一家正好那 2 条（逐字）、Pickering 正好那 1 条 5 星、第二家没有 testimonials 块', () => {
  const quotes = (slug) => site3[`en/pages/locations/${slug}.json`].blocks.filter((b) => b.type === 'testimonials').flatMap((b) => b.data.items.map((it) => it.quote));
  assert.deepStrictEqual(quotes(SLUGS[0]), [R.a1, R.a2]);
  assert.deepStrictEqual(quotes(SLUGS[2]), [R.p5]);
  assert.strictEqual(sectionsOf(locPages[1], 'testimonials').length, 0);
  const t0 = textOf(sectionsOf(locPages[0], 'testimonials')[0] || '');
  assert.ok(t0.includes(R.a1) && t0.includes(R.a2), t0);
  assert.ok(textOf(sectionsOf(locPages[2], 'testimonials')[0] || '').includes(R.p5));
});
check('2 星那条哪一页都没有、brand.json 里也没有；不带 location 的那条不上任何地点页', () => {
  for (const h of [page('locations'), ...locPages, page('')]) assert.ok(!unesc(h).includes(R.p2), '2 星那条出现了');
  assert.ok(!JSON.stringify(site3['brand.json']).includes(R.p2));
  for (const h of [page('locations'), ...locPages]) assert.ok(!unesc(h).includes(R.none), '不带 location 的那条上了地点页');
});
check('brand.json 三家的 reviews：2 条、0 条（不写这一键）、1 条', () => {
  const locs = site3['brand.json'].locations;
  assert.deepStrictEqual(locs.map((l) => (Array.isArray(l.reviews) ? l.reviews.length : 0)), [2, 0, 1]);
  assert.ok(!('reviews' in locs[1]));
  assert.deepStrictEqual(locs[2].reviews, [{ quote: R.p5, name: 'Carla M.', rating: 5, source: 'google' }]);
});
check('首页菜单有 Locations（指向 /locations）', () => {
  const a = (headerOf(page('')).match(/<a[^>]*href="\/locations"[^>]*>[\s\S]*?<\/a>/) || [''])[0];
  assert.strictEqual(textOf(a), 'Locations', `顶栏里指向 /locations 的那一项：${a}`);
});
check('首页：一块 Compact、带 locationsAuto 的 contact，列出三家，排在原有 cta 之前', () => {
  const home = site3['en/pages/home.json'].blocks;
  const auto = home.filter((b) => b.locationsAuto === true);
  assert.strictEqual(auto.length, 1);
  assert.strictEqual(auto[0].type, 'contact');
  assert.strictEqual(auto[0].shape, 'compact');
  const h = page('');
  const ct = sectionsOf(h, 'contact').find((s) => /data-shape="compact"/.test(s));
  assert.ok(ct, '首页 HTML 里没有 compact 形态的 contact');
  assert.strictEqual((ct.match(/data-part="location"/g) || []).length, 3, '没列出三家');
  const at = h.indexOf(ct);
  const cta = h.search(/<section[^>]*data-block="cta"/);
  assert.ok(cta > at, `contact 在 ${at}、cta 在 ${cta}`);
});
for (const layout of ['row', 'stacked', 'columns']) {
  check(`页脚（layout=${layout}）三行，每行链到对应地点页`, () => {
    const c = { ...site3, 'theme.json': { ...site3['theme.json'], regionOptions: { footer: { layout } } } };
    const h = layout === 'row' ? page('locations') : render(`footer-${layout}`, c)('locations');
    const f = footerOf(h);
    assert.ok(f.includes(`ftr-layout-${layout}`), `页脚不是 ${layout}`);
    const rows = [...f.matchAll(/<li[^>]*data-footer-location="\d+"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    assert.strictEqual(rows.length, 3, `页脚地点行 ${rows.length} 行`);
    rows.forEach((r, i) => {
      assert.ok(r.includes(`href="/locations/${SLUGS[i]}"`), `第 ${i + 1} 行没链到 ${SLUGS[i]}：${r}`);
      assert.ok(textOf(r).includes(LOCS[i].label) && textOf(r).includes(LOCS[i].phone), textOf(r));
    });
  });
}
{
  // 另渲一次：三家各一份不同的营业时间 + 坐标。
  const HOURS = [
    [{ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '18:00' }],
    [{ days: ['Tuesday', 'Wednesday', 'Thursday'], opens: '10:00', closes: '19:00' }],
    [{ days: ['Saturday', 'Sunday'], opens: '08:00', closes: '14:00' }],
  ];
  const SHOWN = ['Mon–Fri · 9am – 6pm', 'Tue–Thu · 10am – 7pm', 'Sat, Sun · 8am – 2pm'];
  const c = JSON.parse(JSON.stringify(site3));
  c['brand.json'].locations.forEach((l, i) => { l.hours = HOURS[i]; });
  const geo = LOCS.map((l, i) => ({ address: l.address, lat: [44.0501, 44.059, 43.8384][i], lng: [-79.4663, -79.48, -79.0868][i] }));
  const pg = render('hours', c, ['--geo', JSON.stringify(geo)]);
  check('另渲（hours + --geo）：每张地点页显示它自己那份营业时间、别家的不出现，有地图卡片', () => {
    SLUGS.forEach((s, i) => {
      const ct = sectionsOf(pg(`locations/${s}`), 'contact')[0] || '';
      const shown = unesc(ct);
      assert.ok(shown.includes(SHOWN[i]), `${s} 没显示自己的营业时间`);
      SHOWN.filter((_, j) => j !== i).forEach((o) => assert.ok(!shown.includes(o), `${s} 显示了别家的 ${o}`));
      assert.ok(/data-part="map-card"/.test(ct), `${s} 没有地图卡片`);
    });
  });
}

console.log('验收 3 —— 一个地点');
{
  const one = create('one', PAYLOAD({ locations: [LOCS[0]], reviews: REVIEWS.slice(0, 1) }));
  const pg = render('one', one);
  check('没有 locations/ 页、content 里没有标记页', () => {
    assert.strictEqual(pg('locations'), null);
    assert.ok(!Object.keys(one).some((k) => k.includes('/pages/locations')), Object.keys(one).join(' '));
  });
  check('菜单 / 页脚里没有地点那一项', () => {
    const h = pg('');
    assert.ok(!/href="\/locations"/.test(h));
    assert.ok(!footerOf(h).includes('data-footer-location'));
  });
}

console.log('验收 4 —— 双语三地点');
{
  const two = create('bilingual', PAYLOAD({ locations: LOCS, reviews: REVIEWS, secondaryLocales: ['fr'] }));
  check('en / fr 各 4 张页', () => {
    for (const l of ['en', 'fr']) {
      assert.deepStrictEqual(Object.keys(two).filter((k) => k.startsWith(`${l}/pages/locations`)).sort(),
        [`${l}/pages/locations.json`, ...SLUGS.map((s) => `${l}/pages/locations/${s}.json`)], l);
    }
  });
}

console.log('验收 6 —— 命令 site.js location-pages');
{
  const cut = { ...site3 };
  delete cut[`en/pages/locations/${SLUGS[2]}.json`];
  const file = path.join(tmp, 'cut.json');
  fs.writeFileSync(file, JSON.stringify(cut));
  const r = node(['location-pages', '--site', file, '--skip-ai']);
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  check('删掉 Pickering 那页 ⟹ 标准输出一行 ok:true、退出码 0', () => {
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(lines.length, 1, r.stdout);
    assert.strictEqual(JSON.parse(lines[0]).ok, true);
  });
  const out = JSON.parse(lines[0] || '{}');
  check('补丁只新建 Pickering 那一张，评价是它那 1 条 5 星（从 brand.json 取回）', () => {
    assert.deepStrictEqual(Object.keys(out.patch), [`en/pages/locations/${SLUGS[2]}.json`]);
    const t = out.patch[`en/pages/locations/${SLUGS[2]}.json`].blocks.find((b) => b.type === 'testimonials');
    assert.deepStrictEqual(t.data.items, [{ quote: R.p5, name: 'Carla M.', rating: 5, source: 'google' }]);
  });
  check('AI 花费是 0', () => assert.deepStrictEqual(out.usage, { model: null, inputTokens: 0, outputTokens: 0 }));
  const whole = path.join(tmp, 'whole.json');
  fs.writeFileSync(whole, JSON.stringify(site3));
  const r2 = node(['location-pages', '--site', whole, '--skip-ai']);
  check('没删过的站 ⟹ ok:true、补丁为空', () => {
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.deepStrictEqual(JSON.parse(r2.stdout.trim()).patch, {});
  });
  const r3 = node(['location-pages', '--site', path.join(tmp, 'no-such-file.json'), '--skip-ai']);
  check('--site 给一个不存在的文件 ⟹ ok:false、code bad、退出码 3、没有堆栈', () => {
    assert.strictEqual(r3.status, 3);
    const o = JSON.parse(r3.stdout.trim());
    assert.strictEqual(o.ok, false);
    assert.strictEqual(o.code, 'bad');
    assert.ok(!/\n\s+at /.test(r3.stderr || ''), r3.stderr);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
