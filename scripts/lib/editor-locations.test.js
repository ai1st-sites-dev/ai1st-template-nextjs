#!/usr/bin/env node
/**
 * editor-locations.test.js — #1980（Epic:MultiLocation T5）：编辑器 Locations 区那一笔存盘（`site.js save` 的 root `locations`）。
 *
 * 跑法:  node scripts/lib/editor-locations.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① 纯函数：§locationsProblem 的拒收话 / §mergeLocations 的「别的键原样留着」/ §remapLocationRefs 的下标 / §remapLocationRefsIn（编辑器画布那一侧，r2）
 *   ② 真站夹具走 `site-editor.js` §save（manager spawn 的同一个函数）：三家地点，首页一颗按钮 `location: 2`、顶栏一颗 `location: 1`、
 *      顶栏上面那一行一项没写 `location`（= 主地点）——
 *      · 把第三家拖到第一 ⟹ 首页那颗存下去是 `location: 0`、顶栏那颗 `location: 2`、没写的那项不动，`remapped` 点名两份文件（AC1）
 *      · 删掉第三家 ⟹ 首页那颗没有 `location`（回到主地点）（AC1）
 *      · 只改第二家电话 ⟹ 一份引用都不动、没有 `remapped`
 *   ③ 老站：营业时间还在 seo.json ⟹ 在编辑器里改第一家的营业时间，存下去是老板改的那份（不被 seo.json 那份盖回去），seo.json 里那两项删掉
 *
 * 用真站夹具 site-0448c807（一家地点），在内存里补成三家。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'scripts', 'fixtures', 'site-fixtures', 'site-0448c807.json');

let failed = 0;
let passed = 0;
const ok = (m) => { passed += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m}\n       ${detail}`));
const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const HOME = 'en/pages/home.json';
const NAV = 'en/navigation.json';

let lib;
let siteEditor;
try {
  lib = require('./editor-locations');
  siteEditor = require('./site-editor');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

/** 跑一次 save，日志收掉；回 `{ ok, out | code, message }`。 */
async function save(content, root) {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return { ok: true, out: await siteEditor.save({ content, changes: { page: 'home', locale: 'en', root } }) };
  } catch (e) {
    if (e instanceof siteEditor.SiteEditorError) return { ok: false, code: e.code, message: e.message };
    throw e;
  } finally {
    console.log = log;
    console.error = err;
  }
}

function pure() {
  console.log('① 纯函数');
  const A = { id: 'loc-a', label: 'Downtown', address: '1 King St', geo: { lat: 1, lng: 2 }, slug: 'downtown', reviews: [{ quote: 'x' }] };
  const B = { id: 'loc-b', label: 'Uptown', phone: '555' };
  check(lib.locationsProblem([A]) && lib.locationsProblem([A]).bad, '交来的一家带 geo / slug / reviews ⟹ 形状不对（编辑器发不出来的东西）');
  const edA = lib.editorLocations({ locations: [A, B] }, null);
  check(same(edA, [{ id: 'loc-a', label: 'Downtown', address: '1 King St' }, { id: 'loc-b', label: 'Uptown', phone: '555' }]), '读值只留编辑器能改的那几样', JSON.stringify(edA));
  check(lib.locationsProblem(edA) === null, '读出来的那一份原样交回去能存');
  const merged = lib.mergeLocations([A, B], [{ ...edA[1], phone: '' }, { ...edA[0], label: 'Downtown 2' }]);
  check(same(merged, [{ id: 'loc-b', label: 'Uptown' }, { ...A, label: 'Downtown 2' }]), '合并：顺序照交来的；清空 = 删键；geo / slug / reviews 原样、键序照盘上', JSON.stringify(merged));
  check(same(lib.editorLocations({ locations: [{ label: 'x' }, { label: 'y' }] }, null).map((l) => l.id), ['loc-0', 'loc-1']), '没有 id 的按下标补 loc-0 / loc-1');
  const p = lib.locationsProblem([{ id: 'loc-a', label: 'Downtown', hours: [{ days: ['Monday'], opens: '25:00', closes: '18:00' }] }]);
  check(p && /opening hours of Downtown are not valid/.test(p.refuse), '25:00 ⟹ 拒收话点名那一家', JSON.stringify(p));
  check(lib.locationsProblem([{ id: 'loc-a', hours: [{ days: [], opens: '09:00', closes: '18:00' }] }]).refuse, '一天都没勾 ⟹ 拒收');
  check(lib.locationsProblem([{ id: 'loc-a', hours: [{ days: ['Sunday'], opens: '00:00', closes: '24:00' }] }]) === null, '00:00–24:00 合格');

  const content = {
    'brand.json': { locations: [A, B, { id: 'loc-c' }] },
    [HOME]: { blocks: [{ id: 'h', data: { ctas: [{ label: 'Call', href: { source: 'phone', location: 2 } }, { label: 'Main', href: { source: 'phone' } }] } }] },
    [NAV]: { header: { buttons: [{ label: 'B', href: { source: 'phone', location: 1 } }] }, footer: { contact: { source: 'brand', location: 0 } } },
    'en/seo.json': { siteTitle: 'x', note: { source: 'phone', location: 2 } },
  };
  const order = (ids) => ids.map((id) => content['brand.json'].locations.find((l) => l.id === id));
  let r = lib.remapLocationRefs(content, content['brand.json'].locations, order(['loc-c', 'loc-a', 'loc-b']));
  check(r[HOME] && r[HOME].blocks[0].data.ctas[0].href.location === 0 && !('location' in r[HOME].blocks[0].data.ctas[1].href),
    '第三家拖到第一：location 2 ⟹ 0；没写 location 的（主地点）不动', JSON.stringify(r[HOME]));
  check(r[NAV] && r[NAV].header.buttons[0].href.location === 2 && r[NAV].footer.contact.location === 1, '菜单 / 页脚里的也跟着挪（1 ⟹ 2、brand 源 0 ⟹ 1）', JSON.stringify(r[NAV]));
  check(!('en/seo.json' in r), 'seo.json 不在射程里（只管页面 / navigation.json / site-blocks.json）');
  check(same(content[HOME].blocks[0].data.ctas[0].href, { source: 'phone', location: 2 }), '不改入参');
  r = lib.remapLocationRefs(content, content['brand.json'].locations, order(['loc-a', 'loc-b']));
  check(r[HOME] && !('location' in r[HOME].blocks[0].data.ctas[0].href) && !(NAV in r), '删掉第三家：指它的去掉 location；指前两家的不动', JSON.stringify(r));
  r = lib.remapLocationRefs(content, content['brand.json'].locations, content['brand.json'].locations);
  check(same(r, {}), '顺序没变 ⟹ 一份都不改');

  // r2 —— 编辑器画布那一侧（§remapLocationRefsIn，就地改一个值）：Puck data 的 root 顶栏按钮 + 页面块，跟服务器挪的是同一套下标。
  const canvas = {
    root: { props: { locations: content['brand.json'].locations, headerButtons: [{ label: 'Call C', href: { source: 'phone', location: 2 } }, { label: 'Quote', href: '/contact' }] } },
    content: [{ type: 'cta', props: { ctas: [{ label: 'B', href: { source: 'address', location: 1 } }, { label: 'Mail', href: { source: 'email', location: 0 } }] } }],
  };
  const c1 = clone(canvas);
  const n = lib.remapLocationRefsIn(c1, content['brand.json'].locations, order(['loc-c', 'loc-a', 'loc-b']));
  check(n === 3 && c1.root.props.headerButtons[0].href.location === 0 && c1.content[0].props.ctas[0].href.location === 2 && c1.content[0].props.ctas[1].href.location === 1,
    '画布：顶栏按钮 2 ⟹ 0、页面块 address 1 ⟹ 2、email 0 ⟹ 1（三处）', JSON.stringify(c1));
  check(same(c1.root.props.locations, canvas.root.props.locations) && c1.root.props.headerButtons[1].href === '/contact', '地点数组本身、不是引用的 href 不动');
  const c2 = clone(canvas);
  check(lib.remapLocationRefsIn(c2, content['brand.json'].locations, order(['loc-a', 'loc-b'])) === 1 && !('location' in c2.root.props.headerButtons[0].href),
    '画布：删掉第三家 ⟹ 顶栏那颗去掉 location', JSON.stringify(c2.root.props.headerButtons));
  check(lib.remapLocationRefsIn(clone(canvas), content['brand.json'].locations, content['brand.json'].locations) === 0, '画布：顺序没变 ⟹ 0 处');
  // 名单从 item-sources.js §SOURCES 现取：每一个带 `location` 下标参数的源都跟着挪（以后加第五个源不用回来改这里）。
  const { SOURCES } = require('./item-sources');
  const indexed = Object.keys(SOURCES).filter((k) => SOURCES[k].params && SOURCES[k].params.location !== undefined);
  const each = indexed.map((source) => ({ source, location: 2 }));
  lib.remapLocationRefsIn(each, content['brand.json'].locations, order(['loc-c', 'loc-a', 'loc-b']));
  check(indexed.length >= 4 && each.every((r2) => r2.location === 0), `带 location 参数的源 ${indexed.length} 个（${indexed.join(' / ')}）全部跟着挪`, JSON.stringify(each));
}

async function integration() {
  console.log('② 真站夹具：site-editor.js §save');
  if (!fs.existsSync(SITE)) die(`夹具 ${SITE} 不在`);
  for (const k of ['AI1ST_BLOCKS_DIR', 'AI1ST_REGISTRY_PATH']) delete process.env[k];
  const site = JSON.parse(fs.readFileSync(SITE, 'utf-8'));
  const hero = site[HOME].blocks.find((b) => b.type === 'hero');
  if (!hero || !Array.isArray(hero.data.ctas) || !hero.data.ctas.length) die('夹具首页的 hero 没有按钮');
  if (!site[NAV].header || !Array.isArray(site[NAV].header.buttons)) die('夹具没有顶栏按钮');
  const base = clone(site);
  const main = base['brand.json'].locations[0];
  base['brand.json'].locations = [
    main,
    { label: 'North York', address: '5000 Yonge St, Toronto, ON', phone: '416-555-0002' },
    { label: 'Scarborough', address: '300 Borough Dr, Toronto, ON', phone: '416-555-0003' },
  ];
  base[HOME].blocks.find((b) => b.type === 'hero').data.ctas[0].href = { source: 'phone', location: 2 };
  base[NAV].header.buttons = [{ label: 'Call North York', href: { source: 'phone', location: 1 } }];
  base[NAV].header.topbarLinks = [{ label: 'Call', href: { source: 'phone' } }];

  // 这一份就是编辑器读到的（id 按下标补）
  const read = lib.editorLocations(base['brand.json'], base['en/seo.json']);
  check(same(read.map((l) => l.id), ['loc-0', 'loc-1', 'loc-2']), '夹具：三家，id 读成 loc-0 / loc-1 / loc-2');

  // 拖第三家到第一
  let r = await save(base, { locations: [read[2], read[0], read[1]] });
  check(r.ok, '排序那一笔存得进去', JSON.stringify(r));
  if (!r.ok) return;
  let c = r.out.content;
  const heroAfter = c[HOME].blocks.find((b) => b.type === 'hero').data.ctas[0].href;
  check(same(heroAfter, { source: 'phone', location: 0 }), 'AC1：首页那颗 location: 2，第三家拖到第一 ⟹ 存下去是 location: 0', JSON.stringify(heroAfter));
  check(same(c[NAV].header.buttons[0].href, { source: 'phone', location: 2 }), '顶栏那颗 location: 1 ⟹ 2（North York 现在是第三家）', JSON.stringify(c[NAV].header.buttons[0].href));
  check(same(c[NAV].header.topbarLinks[0].href, { source: 'phone' }), '没写 location 的那项不动（= 新的主地点 Scarborough）');
  check(same(r.out.remapped, [NAV, HOME]), '`remapped` 点名改到的两份文件（编辑器据它重取底稿）', JSON.stringify(r.out.remapped));
  check(same(c['brand.json'].locations.map((l) => l.id), ['loc-2', 'loc-0', 'loc-1']) && same(c['brand.json'].locations[1].geo, main.geo),
    'brand.json：顺序照新的、id 落盘、主地点那家的 geo 跟着它走', JSON.stringify(c['brand.json'].locations));
  check(r.out.files.includes('brand.json') && r.out.files.includes(HOME) && r.out.files.includes(NAV), 'files 里有 brand.json + 两份改了引用的文件', JSON.stringify(r.out.files));
  // r2 —— 开着的这一页（home）被挪过下标：回的 hash 就是下一次打开编辑器读到的那一个（不然下一笔的 baseHash 对不上 ⟹ 假 409）。没交页面也回。
  const quiet = console.log;
  console.log = () => {};
  let ed;
  try { ed = await siteEditor.editorData({ content: c, locale: 'en', page: 'home' }); } finally { console.log = quiet; }
  const edHash = ed && ed.baseline && ed.baseline.hash;
  check(typeof r.out.hash === 'string' && r.out.hash === edHash, '`hash` = 存完之后 editor-data 给这一页的 hash（挪过之后那份）', `save ${r.out.hash} · editor-data ${edHash}`);

  // 从原始那份删掉第三家
  r = await save(base, { locations: [read[0], read[1]] });
  c = r.ok ? r.out.content : {};
  const heroDel = r.ok ? c[HOME].blocks.find((b) => b.type === 'hero').data.ctas[0].href : null;
  check(r.ok && same(heroDel, { source: 'phone' }), 'AC1：删掉第三家 ⟹ 那颗按钮没有 location（回到主地点）', JSON.stringify(heroDel));
  check(r.ok && same(c[NAV].header.buttons[0].href, { source: 'phone', location: 1 }), '指第二家的那颗不动');

  // 只改第二家电话：引用一份都不动
  r = await save(base, { locations: [read[0], { ...read[1], phone: '416-555-9999' }, read[2]] });
  check(r.ok && !r.out.remapped && same(r.out.content[HOME], base[HOME]) && r.out.content['brand.json'].locations[1].phone === '416-555-9999',
    '只改第二家电话 ⟹ 首页一个字节不动、没有 remapped', JSON.stringify(r.ok ? r.out.files : r));

  // 拒收：营业时间 25:00 ⟹ refused，原话给老板
  r = await save(base, { locations: [read[0], { ...read[1], hours: [{ days: ['Monday'], opens: '09:00', closes: '25:00' }] }, read[2]] });
  check(!r.ok && r.code === 'refused' && /opening hours of North York are not valid/.test(r.message), '营业时间 25:00 ⟹ refused（manager 回给编辑器的那句）', JSON.stringify(r));

  console.log('③ 老站：营业时间还在 seo.json');
  const legacy = clone(base);
  legacy['en/seo.json'] = { ...legacy['en/seo.json'], schema: { ...(legacy['en/seo.json'].schema || {}), openingHours: [{ days: ['Monday'], opens: '09:00', closes: '17:00' }] } };
  const lr = lib.editorLocations(legacy['brand.json'], legacy['en/seo.json']);
  check(same(lr[0].hours, [{ days: ['Monday'], opens: '09:00', closes: '17:00' }]), '读值：seo.json 那份就是第一家的营业时间');
  const mine = [{ days: ['Tuesday', 'Wednesday'], opens: '10:00', closes: '19:00' }];
  r = await save(legacy, { locations: [{ ...lr[0], hours: mine }, lr[1], lr[2]] });
  c = r.ok ? r.out.content : {};
  check(r.ok && same(c['brand.json'].locations[0].hours, mine), '改第一家营业时间 ⟹ 存下去是老板这份，没被 seo.json 那份盖回去', JSON.stringify(r.ok ? c['brand.json'].locations[0] : r));
  check(r.ok && !('openingHours' in ((c['en/seo.json'] || {}).schema || {})), 'seo.json 里那一项删掉了（搬过了，以后只读地点上的）');
}

(async () => {
  try {
    pure();
    await integration();
  } catch (e) {
    console.log(e && e.stack ? e.stack : e);
    process.exit(2);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
