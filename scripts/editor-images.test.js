#!/usr/bin/env node
/**
 * editor-images.test.js — #1693：编辑器里「一个位置一张」的图都能换。
 *
 *   node scripts/editor-images.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① 集合（AC1）：按**形状**从全套 manifest 现取「一个位置一张图」的位置（对象槽形状恰好 `{imageUrl, alt}` + 列表项里值是
 *      `{imageUrl, alt}` 的顶层键），跟编辑器 schema 里的图片格逐个相等；可选的带 Remove（顶层看 `required: false`、列表项看键带 `?`）；
 *      #1686 的豁免名单里不再有它们、那道检查照样报 0；画布点击层的清单里它们不打字、不出 AI 按钮。
 *   ② 存盘往返（AC2）：走编辑器真用的那条路（归一化 → pageToPuck → 改 props → puckToPage），只换一张图的地址和说明 ⟹
 *      页面 JSON 里只有那两个值变了；Remove ⟹ 那个键没了、别的不动；没碰的畸形值原样留着。
 *   ③ 画布上点到的图 → 数据里的哪一项（§resolveInlineSlot 的图片那一支：按地址对，不按画布序号）。
 *
 * 🔴 判据不抄票面那张 12 行的表（#643）：集合按谓词现取；12 只作为今天的读数打出来、并钉一次（变了要有人看一眼）。
 */

'use strict';

const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail !== undefined ? `${m} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : m));
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

let schemaLib; let convert; let manifestLib; let blocksLib; let editorPage; let inline;
try {
  schemaLib = require('./lib/editor-schema.js');
  convert = require('./lib/editor-convert.js');
  manifestLib = require('./lib/block-manifest.js');
  blocksLib = require('./blocks.js');
  editorPage = require('./lib/editor-page.js');
  inline = require('./lib/inline-edit.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

let schema;
try {
  schema = schemaLib.editorSchema();
} catch (e) {
  die(`算不出编辑器 schema：${e.message}`);
}
const manifests = manifestLib.loadManifests(path.join(__dirname, '..', 'blocks'));
const compOf = (t) => schema.components.find((c) => c.type === t);

// ══ ① 集合 ══════════════════════════════════════════════════════════════════════════════════════
console.log('① 「一个位置一张图」的集合 = 编辑器里的图片格（AC1）');
// 本文件自己的谓词（不借 editor-schema 的 isOneImage —— 借了就是拿它跟它自己比）。
const ONE = (s) => typeof s === 'string' && /^\{\s*imageUrl\s*,\s*alt\s*\}$/.test(s.trim());
const want = new Map(); // id → optional
for (const [type, m] of manifests) {
  if (!m || m.region === true) continue;
  for (const [slot, sp] of Object.entries(m.slots || {})) {
    if (sp.kind === 'object' && ONE(sp.shape)) want.set(`${type}.${slot}`, sp.required === false);
    if (sp.kind === 'list') {
      for (const e of schemaLib.itemShapeEntries(sp.shape)) if (ONE(e.value)) want.set(`${type}.${slot}.${e.key}`, e.optional);
    }
  }
}
const got = new Map();
for (const c of schema.components) {
  for (const f of c.fields) {
    if (f.control === 'image') got.set(`${c.type}.${f.slot}`, !!f.optional);
    for (const s of f.subs || []) if (s.image) got.set(`${c.type}.${f.slot}.${s.sub}`, !!s.optional);
  }
}
const ids = (mp) => [...mp.keys()].sort();
check(JSON.stringify(ids(want)) === JSON.stringify(ids(got)), `按形状现取的位置 = 编辑器里的图片格（${want.size} 个）`,
  `少 ${ids(want).filter((x) => !got.has(x)).join(' ')} · 多 ${ids(got).filter((x) => !want.has(x)).join(' ')}`);
console.log(`     读数：${ids(want).join(' ')}`);
// 今天的读数（PM 2026-10-10 按谓词现取的那 12 个）。变了不一定是错，但要有人看一眼是哪一个新进来 / 走了。
check(want.size === 12, '今天的读数是 12 个（PM 留言里现取的那一份）', String(want.size));
const optMismatch = ids(want).filter((id) => want.get(id) !== got.get(id));
check(optMismatch.length === 0, '带不带 Remove 跟形状一致（顶层 required: false / 列表项键带 ?）', optMismatch.join(' '));
const required = ids(got).filter((id) => !got.get(id));
check(JSON.stringify(required) === JSON.stringify(['gallery.items.image']), `没有 Remove 的只有 gallery 每项的图（${required.join(' ')}）`);
// 成排的图不在射程（T9）：形状是 `[{imageUrl, alt?}]` 的那些照旧没有格子。
for (const [type, slot] of [['hero', 'band'], ['logos', 'items']]) {
  const f = compOf(type) && compOf(type).fields.find((x) => x.slot === slot);
  check(!f || f.control !== 'image', `${type}.${slot}（成排的图）不是图片格 —— T9 的事`, f && f.control);
}

console.log('   豁免名单（#1686）');
for (const id of ['features.items.image', 'gallery.items.image', 'team.members.photo', 'testimonials.items.photo']) {
  check(!Object.prototype.hasOwnProperty.call(schemaLib.ITEM_FIELD_EXEMPT, id), `${id} 不在 ITEM_FIELD_EXEMPT 里了`);
}
check(schemaLib.itemFieldCoverageProblems(schema, manifests).length === 0, '#1686 那道检查照样报 0',
  schemaLib.itemFieldCoverageProblems(schema, manifests).join(' / '));
check(schemaLib.slotCoverageProblems(schema, manifests).length === 0, '槽位归属那道检查照样报 0（图片槽从「携带」变成「字段」，仍然恰居其一）',
  schemaLib.slotCoverageProblems(schema, manifests).join(' / '));
// 反向：把一条删掉的豁免加回去 ⟹ 那道检查点名「有格子，却还在豁免名单里」。
{
  const back = { ...schemaLib.ITEM_FIELD_EXEMPT, 'team.members.photo': '图片' };
  const p = schemaLib.itemFieldCoverageProblems(schema, manifests, back);
  check(p.some((x) => x.startsWith('team.members.photo') && x.includes('有格子')), '反向：把 team.members.photo 加回豁免名单 ⟹ 点名它有格子', p.join(' / '));
}

console.log('   画布点击层（AI 按钮那一半 —— PM 留言「还剩什么 1」要的读数）');
{
  const cells = [];
  for (const c of schema.components) for (const e of c.inline) if (e.image) cells.push({ id: `${c.type}.${e.path}`, ...e });
  check(JSON.stringify(cells.map((x) => x.id).sort()) === JSON.stringify(ids(want)), `inline 清单里 image: true 的 = 那 ${want.size} 个位置`,
    cells.map((x) => x.id).sort().join(' '));
  const wrong = cells.filter((x) => x.typing !== false || x.ai !== false).map((x) => x.id);
  check(wrong.length === 0, '它们全部 typing: false · ai: false（点了是选图：不进打字、不出 AI 卡片）', wrong.join(' '));
  // 反向：判据不看形状、全当字的那一版（#1693 之前的 inlineSlotsOf）⟹ 图片格会 typing/ai 都是 true。
  const naive = manifestLib.editableSlotPaths(manifests.get('hero')).find((e) => e.path === 'image');
  check(!!naive && naive.kind === 'object', '反向的夹具：hero.image 在 editableSlotPaths 里（kind object）—— 不按形状判就会被当成一格字');
}

console.log('   新块落下的播种（#1660）不受影响');
{
  // 把图片那几条 editLabel 去掉的 manifest（= 本票之前）跑一次 seedListsOf，跟现在逐块相等。
  const strip = (m) => {
    const x = JSON.parse(JSON.stringify(m));
    for (const [slot, sp] of Object.entries(x.slots || {})) {
      if (sp.kind === 'object' && ONE(sp.shape)) delete sp.editLabel;
      if (sp.kind === 'list' && sp.editLabel && typeof sp.editLabel === 'object') {
        for (const e of schemaLib.itemShapeEntries(sp.shape)) if (ONE(e.value)) delete sp.editLabel[e.key];
      }
      void slot;
    }
    return x;
  };
  const diff = [];
  for (const [type, m] of manifests) {
    if (!m || m.region === true) continue;
    if (JSON.stringify(schemaLib.seedListsOf(m)) !== JSON.stringify(schemaLib.seedListsOf(strip(m)))) diff.push(type);
  }
  check(diff.length === 0, '每块的播种（列表 / 条数 / 填哪几格）跟没有图片格时一字不差', diff.join(' '));
}

// ══ ② 存盘往返 ══════════════════════════════════════════════════════════════════════════════════
console.log('② 存盘往返：只换一张图的地址和说明 ⟹ 页面 JSON 里只有那两个值变了（AC2）');

function open(raw) {
  const pages = [JSON.parse(JSON.stringify(raw))];
  blocksLib.normalizeLocalePages(pages, {}, 'en', () => {});
  const blocks = pages[0].blocks;
  const located = blocks.map((b) => editorPage.locateInRaw(raw, {}, raw.slug, b));
  const weights = editorPage.effectiveWeights(raw, {}, blocks, located);
  const p = convert.pageToPuck({ raw, blocks, located, schema, weights, siteBlocks: {} });
  return { initial: JSON.parse(JSON.stringify(p)), data: JSON.parse(JSON.stringify(p)) };
}
const save = (raw, o) => convert.puckToPage({ raw, data: o.data, initial: o.initial, schema, slug: raw.slug });

/** 两份 JSON 的叶子差异：`[路径, 前, 后]`。 */
function leafDiff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const obj = (v) => v !== null && typeof v === 'object';
  if (!obj(a) || !obj(b) || Array.isArray(a) !== Array.isArray(b)) return [[at, a, b]];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => leafDiff(a[k], b[k], at ? `${at}.${k}` : k));
}

const RAW = {
  slug: 'home',
  blocks: [
    { id: 'h1', type: 'hero', data: { headline: 'Gentle acupuncture', options: { image: 'right' },
      image: { imageUrl: 'https://uploads.example/u1/aaaaaaaaa_old-hero.jpg', alt: 'Old hero', width: 1200 } } },
    { id: 'g1', type: 'gallery', data: { headline: 'Our clinic', items: [
      { image: { imageUrl: '/photos/a.jpg', alt: 'A' }, title: 'Front desk' },
      { image: { imageUrl: '/photos/b.jpg', alt: 'B' }, title: 'Room 1' },
      { image: { imageUrl: '/photos/c.jpg', alt: 'C' }, title: 'Room 2' },
    ] } },
    { id: 'f1', type: 'features', data: { headline: 'What we treat', items: [
      { title: 'Back pain', text: 'Lower back.', image: { imageUrl: '/photos/f1.jpg', alt: 'F1' } },
      { title: 'Headaches', text: 'Tension.', image: { imageUrl: '/photos/f2.jpg', alt: 'F2' } },
      { title: 'Sleep', text: 'Rest.', image: { imageUrl: '/photos/f3.jpg', alt: 'F3' } },
    ] } },
    { id: 'c1', type: 'content', data: { headline: 'About', image: 'not-an-object' } },
  ],
};
const item = (o, id) => o.data.content.find((c) => c.props.id === id);

{
  const o = open(RAW);
  const noop = save(RAW, o);
  check(leafDiff(RAW, noop).length === 0, '打开什么都不改就存 ⟹ 一字不变', leafDiff(RAW, noop));

  const h = item(o, 'h1');
  check(h.props.image && h.props.image.imageUrl === RAW.blocks[0].data.image.imageUrl, `hero 的 image 进了 props（${JSON.stringify(h.props.image)}）`);
  h.props.image = { ...h.props.image, imageUrl: 'https://uploads.example/u1/bbbbbbbbb_new-hero.jpg', alt: 'Treatment room' };
  const out = save(RAW, o);
  const d = leafDiff(RAW, out);
  check(JSON.stringify(d.map((x) => x[0])) === JSON.stringify(['blocks.0.data.image.imageUrl', 'blocks.0.data.image.alt']),
    'hero：换图 + 改说明 ⟹ 只有 blocks[0].data.image 的 imageUrl / alt 两个值变了（width 原样）', d);
}
{
  const o = open(RAW);
  const g = item(o, 'g1');
  g.props.items[1] = { ...g.props.items[1], image: { ...g.props.items[1].image, imageUrl: '/photos/new-b.jpg', alt: 'Room 1, new' } };
  const d = leafDiff(RAW, save(RAW, o));
  check(JSON.stringify(d.map((x) => x[0])) === JSON.stringify(['blocks.1.data.items.1.image.imageUrl', 'blocks.1.data.items.1.image.alt']),
    'gallery 第 2 项：换图 + 改说明 ⟹ 只有 items[1].image 的那两个值变了，第 1 / 3 项不动', d);
}
{
  const o = open(RAW);
  const f = item(o, 'f1');
  f.props.items[1] = { ...f.props.items[1], image: undefined };   // 面板上 Remove 给的就是 undefined（ImageField §ImageControl）
  const out = save(RAW, o);
  const d = leafDiff(RAW, out);
  check(d.length === 1 && d[0][0] === 'blocks.2.data.items.1.image' && d[0][2] === undefined && !('image' in out.blocks[2].data.items[1]),
    'features 第 2 项 Remove ⟹ 那一项不再有 image 键，其余项和别的字段不变', d);
}
{
  const o = open(RAW);
  item(o, 'h1').props.image = undefined;
  const out = save(RAW, o);
  check(!('image' in out.blocks[0].data) && leafDiff(RAW, out).length === 1, 'hero Remove ⟹ data 里没有 image 这个键了，别的不变', leafDiff(RAW, out));
}
{
  // 没碰的畸形值（content.image 是个字符串）：toProp 给 undefined，存盘不许把它当成 Remove 删掉。
  const o = open(RAW);
  item(o, 'h1').props.headline = 'Changed headline';
  const out = save(RAW, o);
  check(out.blocks[3].data.image === 'not-an-object', '别的块存盘 ⟹ content 里那个不是对象的 image 原样留着（不当成 Remove）', out.blocks[3].data);
}
{
  // 加图：原来没有图的位置 Change ⟹ `{imageUrl, alt: ''}`（ImageControl 的写法）。
  const raw = { slug: 'home', blocks: [{ id: 'c2', type: 'cta', data: { headline: 'Book now' } }] };
  const o = open(raw);
  item(o, 'c2').props.image = { alt: '', imageUrl: '/photos/cta.jpg' };
  const out = save(raw, o);
  check(JSON.stringify(out.blocks[0].data.image) === JSON.stringify({ alt: '', imageUrl: '/photos/cta.jpg' }) && leafDiff(raw, out).length === 1,
    'cta 原来没有图，Change ⟹ data.image = {alt: "", imageUrl}，别的不变', out.blocks[0].data);
}

// ══ ③ 画布上点到的图 → 数据里的哪一项 ══════════════════════════════════════════════════════════════
console.log('③ 画布上点到的图 → 数据里的哪一项（按地址对，不按画布序号）');
{
  const gallery = compOf('gallery');
  // gallery 先筛掉没图的项：数据第 1 项没图 ⟹ 画布上第 0 张是数据里的第 2 项（下标 1）。
  const props = { items: [{ title: 'No photo' }, { image: { imageUrl: '/p/x.jpg', alt: 'X' } }, { image: { imageUrl: '/p/y.jpg', alt: 'Y' } }] };
  const r = inline.resolveInlineSlot({ component: gallery, props, slot: 'items.0.image', text: '/p/x.jpg' });
  check(r.ok && JSON.stringify(r.path) === JSON.stringify(['items', 1, 'image']) && r.image === true && r.value === '/p/x.jpg' && !r.typing && !r.ai,
    '画布第 0 张（/p/x.jpg）⟹ items[1].image（真实下标），image: true、不打字、不出 AI', r);
  const dup = inline.resolveInlineSlot({ component: gallery, props: { items: [props.items[1], props.items[1]] }, slot: 'items.1.image', text: '/p/x.jpg' });
  check(!dup.ok && dup.why === 'ambiguous', '两项是同一张图 ⟹ 不猜，不让换（ambiguous）', dup);
  const miss = inline.resolveInlineSlot({ component: gallery, props, slot: 'items.0.image', text: '/p/zzz.jpg' });
  check(!miss.ok && miss.why === 'mismatch', '地址对不上任何一项 ⟹ mismatch', miss);
  const hero = compOf('hero');
  const top = inline.resolveInlineSlot({ component: hero, props: { image: { imageUrl: '/h.jpg', alt: '' } }, slot: 'image', text: '/h.jpg' });
  check(top.ok && JSON.stringify(top.path) === JSON.stringify(['image']) && top.image === true, 'hero 顶层的图 ⟹ path [image]', top);
  const topMiss = inline.resolveInlineSlot({ component: hero, props: { image: { imageUrl: '/other.jpg', alt: '' } }, slot: 'image', text: '/h.jpg' });
  check(!topMiss.ok && topMiss.why === 'mismatch', '顶层的图也比地址：画布上那张跟数据里不是同一张 ⟹ mismatch', topMiss);
  const sourced = inline.resolveInlineSlot({ component: compOf('features'), props: { items: { source: 'services' } }, slot: 'items.0.image', text: '/s.jpg', sourced: ['items'] });
  check(!sourced.ok && sourced.why === 'sourced', '引用来的列表（items: {source}）里的图 ⟹ 点不动（sourced）', sourced);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
