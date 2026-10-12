#!/usr/bin/env node
/**
 * editor-image-rows.test.js — #1694：编辑器里成排的图（logo 一排、头像一排、hero 的图片条、点评平台 logo）都能换、改名字、加、删、排序。
 *
 *   node scripts/editor-image-rows.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① 集合（AC1）：按**形状**从全套 manifest 现取「成排的图」的位置（列表项里值是字符串的 `imageUrl` / `logoUrl`；对象槽里包着的列表同样认），
 *      跟编辑器 schema 里的格子逐个相等；每个位置项里的格子照票面那张表；条数上下限跟 manifest 一致（没写 = 不带）。
 *   ② 守卫（AC2）：§itemFieldCoverageProblems 扩到「对象里包着的列表」—— 先证明它量得到（把本票加的 editLabel 摘掉 = main 的样子，
 *      它点名 `pricing.logos.items.imageUrl` 这类条目），改完报 0；豁免名单里没有一条落在这些位置上；往 `hero.logos` 的项形状里加一个
 *      文字字段、不给格子 ⟹ 它点名那一条。
 *   ③ 存盘往返（AC3）：走编辑器真用的那条路（归一化 → pageToPuck → 改 props → puckToPage）：删掉价格块 logo 里的 Google、把 Yelp
 *      拖到第一个 ⟹ `logos.items` 只剩 3 项、顺序 Yelp / OMVIC / CAA，别的字段一字不变；logos 块 / 平台 logo 同理。
 *   ④ 画布上点到的那张 → 数据里的哪一项（§resolveInlineSlot：值是地址字符串，按地址对，不按画布序号）。
 *   ⑤ #1707：一列图里哪几格是必填（`required`）—— 按槽自己的 `itemRequires` 现取（非图片键），跟 schema 逐个相等；别的位置一格都不带；
 *      `validateSite(scope:'edit')` 两臂：名字空 ⟹ 拒「第 3 项没有 alt」，补上 ⟹ 这一条不在。
 *
 * 🔴 判据不抄票面那张表（#643）：集合按谓词现取；8 只作为今天的读数打出来、并钉一次（变了要有人看一眼）。
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
const fieldOf = (t, slot) => (compOf(t) ? compOf(t).fields.find((f) => f.slot === slot) : undefined);

// ══ ① 集合 ══════════════════════════════════════════════════════════════════════════════════════
console.log('① 成排的图的位置 = 编辑器里的格子（AC1）');
// 本文件自己的谓词（不借 editor-schema 的 isImageUrlEntry / objectListsOf —— 借了就是拿它跟它自己比）：
// 一个项形状 `[{…}]` 里，值是一个字符串（不带 `{` / `[`）的 `imageUrl` / `logoUrl` 键。项形状两种写法都认（`key: value` 和裸键）。
const URL_KEYS = ['imageUrl', 'logoUrl'];
const urlKeysIn = (itemShape) => schemaLib.itemShapeEntries(itemShape).filter((e) => URL_KEYS.includes(e.key) && !/[[{]/.test(e.value)).map((e) => e.key);
const want = new Map(); // `块.槽[.列表]` → { urlKey, itemShape, spec, holder }
for (const [type, m] of manifests) {
  if (!m || m.region === true) continue;
  for (const [slot, sp] of Object.entries(m.slots || {})) {
    if (sp.kind === 'list') for (const k of urlKeysIn(sp.shape)) want.set(`${type}.${slot}`, { urlKey: k, itemShape: sp.shape, spec: sp });
    if (sp.kind === 'object' && typeof sp.shape === 'string') {
      const inner = /^\s*\{([\s\S]*)\}\s*$/.exec(sp.shape);
      // 对象形状的顶层键：借列表项那个解析器（把对象包成 `[{…}]` 交给它），值是 `[{…}]` 的就是一列。
      for (const e of inner ? schemaLib.itemShapeEntries(`[{${inner[1]}}]`) : []) {
        if (!/^\[\s*\{[\s\S]*\}\s*\]$/.test(e.value)) continue;
        for (const k of urlKeysIn(e.value)) want.set(`${type}.${slot}.${e.key}`, { urlKey: k, itemShape: e.value, spec: null, holder: slot });
      }
    }
  }
}
const ids = [...want.keys()].sort();
console.log(`     读数：${ids.join(' ')}`);
check(want.size === 8, '今天的读数是 8 个位置（PM 裁定里按两种项形状写法枚举的那一份）', String(want.size));

// 每个位置在 schema 里对应的那一组格子：顶层列表 = 字段的 subs；对象里的列表 = 对象字段里同名子字段的 subs。
function cellsAt(id) {
  const [type, slot, list] = id.split('.');
  const f = fieldOf(type, slot);
  if (!f) return null;
  if (!list) return { holder: f, subs: f.subs };
  const s = (f.subs || []).find((x) => x.sub === list);
  return s ? { holder: s, subs: s.subs || [] } : null;
}
// 票面那张表：每一项的格子（图 + 名字 / 说明 alt + 链接 href）。
const TABLE = {
  'logos.items': ['imageUrl', 'alt', 'href'],
  'pricing.logos.items': ['imageUrl', 'alt'], 'hero.logos.items': ['imageUrl', 'alt'],
  'pricing.proof.avatars': ['imageUrl'], 'hero.proof.avatars': ['imageUrl'],
  'hero.band': ['imageUrl', 'alt'],
};
for (const id of ids) {
  const w = want.get(id);
  const at = cellsAt(id);
  if (!at) { bad(`${id}：编辑器里没有这一列`); continue; }
  const img = at.subs.find((s) => s.sub === w.urlKey);
  check(!!img && img.image === true && img.url === true, `${id}：项里的 ${w.urlKey} 是一格图片（缩略图 + Change，值是地址）`, img);
  if (TABLE[id]) {
    const got = at.subs.map((s) => s.sub);
    check(at.holder.imageRow === true && JSON.stringify(got) === JSON.stringify(TABLE[id]),
      `${id}：一列图，每项格子 = ${TABLE[id].join(' + ')}（${got.join(' + ')}）`, at.holder);
  } else {
    // 点评平台：项是一个平台（source / rating / count / href / logoUrl），logo 只是其中一格，不是「一列图」。
    check(at.holder.imageRow !== true && img && img.optional === true, `${id}：平台 logo 是项里可选的一格（有 Remove），这一列不是「一列图」`, at.holder);
  }
  // 条数上下限：顶层列表照 manifest 的 `minItems` / `maxItems`；对象里包着的列表照对象槽的 `listMax.<列表键>`（#1694 QA2 退回后加：
  //    块的 Section 据同一个数截，面板加得进去的就画得出来 —— 渲染那一半在 hero-render / pricing-render 的「#1694」段）。没写 ⟹ 不带。
  const sp = w.spec;
  const holderSpec = w.holder ? manifests.get(id.split('.')[0]).slots[w.holder] : null;
  const listKey = w.holder ? id.split('.')[2] : null;
  const wantMin = sp && Number.isInteger(sp.minItems) ? sp.minItems : undefined;
  const wantMax = sp && Number.isInteger(sp.maxItems) ? sp.maxItems
    : holderSpec && holderSpec.listMax && Number.isInteger(holderSpec.listMax[listKey]) ? holderSpec.listMax[listKey] : undefined;
  check(at.holder.min === wantMin && at.holder.max === wantMax, `${id}：上下限跟 manifest 一致（min ${wantMin} · max ${wantMax}）`, { min: at.holder.min, max: at.holder.max });
}
{
  const lo = fieldOf('logos', 'items');
  check(lo && lo.min === 3 && lo.max === 12, 'logos.items 是 3–12 项（今天的读数）', lo && { min: lo.min, max: lo.max });
  const altLabels = ids.filter((id) => TABLE[id] && TABLE[id].includes('alt')).map((id) => `${id}=${cellsAt(id).subs.find((s) => s.sub === 'alt').label}`);
  check(JSON.stringify(altLabels) === JSON.stringify(['hero.band=Image description', 'hero.logos.items=Name', 'logos.items=Name', 'pricing.logos.items=Name']),
    `alt 那一格：logo 叫 Name、hero 的图片条叫 Image description（${altLabels.join(' · ')}）`);
  // #1723 —— 上下限挂到了全部列表（画布条目条的 🗑 到 `min` 灰掉，跟面板同一个数）：带上下限的顶层列表 = manifest 里
  //    写了 `minItems` / `maxItems` / `max` 的那几条，一条不多一条不少（原来这一格钉的是「只有本票四列」，#1723 有意改掉）。
  const bounded = schema.components.flatMap((c) => c.fields.filter((f) => f.control === 'list' && (f.min !== undefined || f.max !== undefined)).map((f) => `${c.type}.${f.slot}`)).sort();
  const declared = schema.components.flatMap((c) => c.fields.filter((f) => f.control === 'list').filter((f) => {
    const spec = (manifests.get(c.type).slots || {})[f.slot] || {};
    return [spec.minItems, spec.maxItems, spec.max].some(Number.isInteger);
  }).map((f) => `${c.type}.${f.slot}`)).sort();
  check(bounded.length > 4 && JSON.stringify(bounded) === JSON.stringify(declared),
    `带上下限的顶层列表 = manifest 里写了上下限的那几条（${bounded.length} 条：${bounded.join(' ')}）`);
  // 对象里包着的那 4 列都有上限（QA2 退回：今天页面最多画 logo 6 / 头像 4，面板要在同一处灰掉）。
  const nestedMax = ids.filter((id) => want.get(id).holder).map((id) => `${id}=${cellsAt(id).holder.max}`);
  check(JSON.stringify(nestedMax) === JSON.stringify(['hero.logos.items=6', 'hero.proof.avatars=4', 'pricing.logos.items=6', 'pricing.proof.avatars=4']),
    `对象里的列表上限 = manifest listMax（${nestedMax.join(' · ')}）`);
}
{
  // 画布那一侧：这 8 个位置在 inline 清单里都是 image + url，不打字、不出 AI 按钮。
  const cells = [];
  for (const c of schema.components) for (const e of c.inline) if (e.url) cells.push(`${c.type}.${e.path}`);
  const wantCells = ids.map((id) => `${id}.${want.get(id).urlKey}`).sort();
  check(JSON.stringify(cells.sort()) === JSON.stringify(wantCells), `inline 清单里 url 图片格 = 那 ${wantCells.length} 个位置`, cells.join(' '));
  const wrong = schema.components.flatMap((c) => c.inline.filter((e) => e.url && (e.typing || e.ai || !e.image)).map((e) => `${c.type}.${e.path}`));
  check(wrong.length === 0, '它们全部 image: true · typing: false · ai: false', wrong.join(' '));
}

// ══ ② 守卫 ══════════════════════════════════════════════════════════════════════════════════════
console.log('② 守卫：对象里包着的列表也查（AC2）');
// 「main 的样子」= 把本票加在这几个位置上的 editLabel 摘掉 + 那时的豁免名单（今天的 + 本票删掉的 6 条）。
const MAIN_EXEMPT = {
  ...schemaLib.ITEM_FIELD_EXEMPT,
  'hero.band.imageUrl': 'x', 'logos.items.imageUrl': 'x', 'reviews.platforms.logoUrl': 'x', 'testimonials.summary.logoUrl': 'x',
  'hero.band.alt': 'x', 'logos.items.alt': 'x',
};
function stripRows(m) {
  const x = JSON.parse(JSON.stringify(m));
  for (const sp of Object.values(x.slots || {})) {
    if (!sp.editLabel || typeof sp.editLabel !== 'object') continue;
    for (const k of Object.keys(sp.editLabel)) if (URL_KEYS.includes(k.split('.').pop())) delete sp.editLabel[k];
    if (!Object.keys(sp.editLabel).length) delete sp.editLabel;
  }
  return x;
}
const swap = (mm) => ({ components: schema.components.map((c) => (mm.has(c.type) ? { ...c, fields: schemaLib.fieldsOf(mm.get(c.type)) } : c)) });
{
  const mainMs = new Map([...manifests].map(([t, m]) => [t, m && m.region !== true ? stripRows(m) : m]));
  const p = schemaLib.itemFieldCoverageProblems(swap(mainMs), mainMs, MAIN_EXEMPT);
  const nested = ['hero.logos.items.alt', 'hero.logos.items.imageUrl', 'hero.proof.avatars.imageUrl', 'pricing.logos.items.alt', 'pricing.logos.items.imageUrl', 'pricing.proof.avatars.imageUrl'];
  // 只认 `kind: list` 的那一版按构造看不见这 6 条（它们住在 `kind: object` 的槽里）；扩展后的检查点名它们。
  //    （main 上 logos.items 的 Link 格来自 #1463 的 editItems，那一版已退役，所以这个模拟里 `logos.items.href` 也会被点名 —— 不在这条断言的射程。）
  check(nested.every((x) => p.includes(x)) && nested.every((x) => manifests.get(x.split('.')[0]).slots[x.split('.')[1]].kind === 'object'),
    '先证明量得到：main 的样子（没有这几格、名单是那时的 35 条）⟹ 点名对象里包着的列表那 6 条（槽是 kind: object）', p.join(' / '));
}
{
  const p = schemaLib.itemFieldCoverageProblems(schema, manifests);
  check(p.length === 0, '改完报 0', p.join(' / '));
  const onRows = Object.keys(schemaLib.ITEM_FIELD_EXEMPT).filter((k) => ids.some((id) => k.startsWith(`${id}.`)));
  check(onRows.length === 0, '豁免名单里没有一条落在这 8 个位置上', onRows.join(' '));
  check(schemaLib.slotCoverageProblems(schema, manifests).length === 0, '槽位归属那道检查照样报 0', schemaLib.slotCoverageProblems(schema, manifests).join(' / '));
}
{
  // 反向：往 hero.logos 的项形状里加一个文字字段（note），不给格子 ⟹ 点名 hero.logos.items.note。
  const fake = JSON.parse(JSON.stringify(manifests.get('hero')));
  fake.slots.logos.shape = fake.slots.logos.shape.replace('items: [{imageUrl, alt}]', 'items: [{imageUrl, alt, note}]');
  check(fake.slots.logos.shape.includes('note'), '反向的夹具：hero.logos 的形状里真加上了 note', fake.slots.logos.shape);
  const mm = new Map([...manifests].map(([t, m]) => [t, t === 'hero' ? fake : m]));
  const p = schemaLib.itemFieldCoverageProblems(swap(new Map([['hero', fake]])), mm);
  // 📌 项里多了一个不是图 / 名字 / 链接的键，它就不再是「一列图」（§imageRowKeyOf），整列都没有格子 ⟹ 连 imageUrl / alt 一起被点名：红得更响，不会静默。
  check(p.includes('hero.logos.items.note') && p.every((x) => x.startsWith('hero.logos.items.')), '反向：hero.logos 的项里加一个没格子的 note ⟹ 红，点名 hero.logos.items.note', p.join(' / '));
  const back = schemaLib.itemFieldCoverageProblems(schema, manifests, { ...schemaLib.ITEM_FIELD_EXEMPT, 'pricing.logos.items.alt': 'x' });
  check(back.length === 1 && back[0].startsWith('pricing.logos.items.alt') && back[0].includes('有格子'), '反向：名单里写了对象里那一列已经有格子的字段 ⟹ 点名它', back.join(' / '));
}

// ══ ③ 存盘往返 ═══════════════════════════════════════════════════════════════════════════════════
console.log('③ 存盘往返（AC3）');
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
const item = (o, id) => o.data.content.find((c) => c.props.id === id);
function leafDiff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const obj = (v) => v !== null && typeof v === 'object';
  if (!obj(a) || !obj(b) || Array.isArray(a) !== Array.isArray(b)) return [[at, a, b]];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => leafDiff(a[k], b[k], at ? `${at}.${k}` : k));
}

const U = 'https://uploads.ai1stsite.dev/demo';
const LOGOS = [
  { imageUrl: `${U}/client-logo-1.svg`, alt: 'OMVIC' },
  { imageUrl: `${U}/client-logo-2.svg`, alt: 'CAA Approved Auto Repair' },
  { imageUrl: `${U}/client-logo-3.svg`, alt: 'Google' },
  { imageUrl: `${U}/client-logo-4.svg`, alt: 'Yelp' },
];
const RAW = {
  slug: 'services',
  blocks: [
    { id: 'p1', type: 'pricing', data: { headline: 'Our prices', logos: { caption: 'Approved by', items: LOGOS },
      proof: { avatars: [{ imageUrl: '/a1.jpg' }, { imageUrl: '/a2.jpg' }], rating: 5, text: 'Loved by 200 drivers' },
      plans: [{ name: 'Basic', price: { monthly: '$49' }, features: ['Oil change'], cta: { label: 'Book', href: '/contact' } }] } },
    { id: 'l1', type: 'logos', data: { headline: 'Trusted by', items: [
      { imageUrl: '/l1.svg', alt: 'One', href: 'https://one.example' }, { imageUrl: '/l2.svg', alt: 'Two' }, { imageUrl: '/l3.svg', alt: 'Three' }, { imageUrl: '/l4.svg', alt: 'Four' },
    ] } },
    { id: 'r1', type: 'reviews', data: { headline: 'Reviews', platforms: [{ source: 'Google', rating: 4.8, count: 120 }, { source: 'Yelp', rating: 4.5, count: 30, logoUrl: '/yelp.png' }] } },
    { id: 'h1', type: 'hero', data: { headline: 'Fast repairs', band: [{ imageUrl: '/b1.jpg', alt: 'Shop' }, { imageUrl: '/b2.jpg' }] } },
  ],
};
{
  const o = open(RAW);
  check(leafDiff(RAW, save(RAW, o)).length === 0, '打开什么都不改就存 ⟹ 一字不变', leafDiff(RAW, save(RAW, o)));
}
{
  // 面板上的动作 = ImageRowControl 交给 onChange 的新数组：✕ 删第 3 项（Google），把 Yelp 拖到第一个。
  const o = open(RAW);
  const p = item(o, 'p1');
  check(Array.isArray(p.props.logos.items) && p.props.logos.items.length === 4, `价格块的 logo 一排进了 props（${p.props.logos.items.map((x) => x.alt).join(' / ')}）`);
  const rows = p.props.logos.items.filter((x) => x.alt !== 'Google');
  const yelp = rows.findIndex((x) => x.alt === 'Yelp');
  rows.unshift(rows.splice(yelp, 1)[0]);
  p.props.logos = { ...p.props.logos, items: rows };
  const out = save(RAW, o);
  const got = out.blocks[0].data.logos.items;
  check(JSON.stringify(got.map((x) => x.alt)) === JSON.stringify(['Yelp', 'OMVIC', 'CAA Approved Auto Repair']),
    `删掉 Google、Yelp 拖到第一个 ⟹ logos.items 只剩 3 项且顺序是 Yelp、OMVIC、CAA（${got.map((x) => x.alt).join(' / ')}）`);
  check(JSON.stringify(got) === JSON.stringify([LOGOS[3], LOGOS[0], LOGOS[1]]), '每一项整份原样（图的地址、名字一个字没动）', got);
  const d = leafDiff(RAW, out).map((x) => x[0]);
  check(d.length > 0 && d.every((k) => k.startsWith('blocks.0.data.logos.items')), '别的字段不变：差异全在 blocks[0].data.logos.items 里（caption / proof / plans / 别的块一字不动）', d);
}
{
  // 换一张、改一个名字（AC5 那三个动作里的后两个，在这里先把数据那一半钉住）。
  const o = open(RAW);
  const p = item(o, 'p1');
  const rows = p.props.logos.items.slice();
  rows[1] = { ...rows[1], imageUrl: `${U}/new-caa.png` };
  rows[0] = { ...rows[0], alt: 'OMVIC Registered' };
  p.props.logos = { ...p.props.logos, items: rows };
  const d = leafDiff(RAW, save(RAW, o));
  check(JSON.stringify(d.map((x) => x[0])) === JSON.stringify(['blocks.0.data.logos.items.0.alt', 'blocks.0.data.logos.items.1.imageUrl']),
    '换第 2 张的图 + 改第 1 张的名字 ⟹ 只有那两个值变了', d);
}
{
  // 头像：删一个 ⟹ proof.avatars 少一项，rating / text 不动。
  const o = open(RAW);
  const p = item(o, 'p1');
  p.props.proof = { ...p.props.proof, avatars: p.props.proof.avatars.slice(1) };
  const out = save(RAW, o);
  check(JSON.stringify(out.blocks[0].data.proof) === JSON.stringify({ avatars: [{ imageUrl: '/a2.jpg' }], rating: 5, text: 'Loved by 200 drivers' }),
    '头像删第 1 个 ⟹ proof = {avatars: [a2], rating: 5, text} （rating 没有格子，原样留着）', out.blocks[0].data.proof);
}
{
  // logos 块：加一项（先选图，ImageRowControl 加的是 `{imageUrl, alt: ''}`，放最后）+ 清空第 1 项的链接（可选的 href 清空 = 删键）。
  const o = open(RAW);
  const l = item(o, 'l1');
  const rows = l.props.items.slice();
  const { href, ...rest } = rows[0]; void href;
  rows[0] = rest;
  rows.push({ imageUrl: '/l5.svg', alt: '' });
  l.props.items = rows;
  const out = save(RAW, o);
  check(out.blocks[1].data.items.length === 5 && JSON.stringify(out.blocks[1].data.items[4]) === JSON.stringify({ imageUrl: '/l5.svg', alt: '' }) && !('href' in out.blocks[1].data.items[0]),
    'logos 块：新 logo 出现在末尾、第 1 项的链接删掉了', out.blocks[1].data.items);
  check(JSON.stringify(out.blocks[1].data.items.slice(1, 4)) === JSON.stringify(RAW.blocks[1].data.items.slice(1)), '其余三项一字不动');
}
{
  // 平台 logo：给 Google 加一张、把 Yelp 那张 Remove（面板 Remove 给 undefined ⟹ 那一项不再有 logoUrl 键）。
  const o = open(RAW);
  const r = item(o, 'r1');
  r.props.platforms = [{ ...r.props.platforms[0], logoUrl: '/google.png' }, { ...r.props.platforms[1], logoUrl: undefined }];
  const out = save(RAW, o);
  const pl = out.blocks[2].data.platforms;
  check(pl[0].logoUrl === '/google.png' && !('logoUrl' in pl[1]) && pl[1].source === 'Yelp' && pl[1].count === 30,
    '平台 logo：Google 换上一张、Yelp Remove ⟹ 那一项没有 logoUrl 键，别的不变', pl);
}
{
  // hero 的图片条：拖动排序（第 2 张到第 1 张）⟹ 两项整份对调。
  const o = open(RAW);
  const h = item(o, 'h1');
  h.props.band = [h.props.band[1], h.props.band[0]];
  const out = save(RAW, o);
  check(JSON.stringify(out.blocks[3].data.band) === JSON.stringify([RAW.blocks[3].data.band[1], RAW.blocks[3].data.band[0]]), 'hero.band 拖动排序 ⟹ 两项整份对调', out.blocks[3].data.band);
}

// ══ ④ 画布上点到的那张 → 数据里的哪一项 ═════════════════════════════════════════════════════════════
console.log('④ 画布上点到的那张 → 数据里的哪一项（按地址对，不按画布序号）');
{
  const pricing = compOf('pricing');
  const props = { logos: { caption: 'x', items: [{ alt: 'no image' }, LOGOS[0], LOGOS[1]] } };
  // 块先筛掉没图的项：画布第 0 张是数据里下标 1 那一项。
  const r = inline.resolveInlineSlot({ component: pricing, props, slot: 'logos.items.0.imageUrl', text: LOGOS[0].imageUrl });
  check(r.ok && JSON.stringify(r.path) === JSON.stringify(['logos', 'items', 1, 'imageUrl']) && r.image === true && r.value === LOGOS[0].imageUrl && !r.typing && !r.ai,
    '点画布上的 OMVIC（第 0 张）⟹ logos.items[1].imageUrl（真实下标），image: true、不打字、不出 AI', r);
  const dup = inline.resolveInlineSlot({ component: pricing, props: { logos: { items: [LOGOS[0], LOGOS[0]] } }, slot: 'logos.items.1.imageUrl', text: LOGOS[0].imageUrl });
  check(!dup.ok && dup.why === 'ambiguous', '两项是同一张图 ⟹ 不猜，不让换（ambiguous）', dup);
  const av = inline.resolveInlineSlot({ component: compOf('hero'), props: { proof: { avatars: [{ imageUrl: '/a.jpg' }, { imageUrl: '/b.jpg' }] } }, slot: 'proof.avatars.1.imageUrl', text: '/b.jpg' });
  check(av.ok && JSON.stringify(av.path) === JSON.stringify(['proof', 'avatars', 1, 'imageUrl']) && av.value === '/b.jpg', 'hero 的第 2 个头像 ⟹ proof.avatars[1].imageUrl', av);
  const pl = inline.resolveInlineSlot({ component: compOf('reviews'), props: { platforms: [{ source: 'Google' }, { source: 'Yelp', logoUrl: '/yelp.png' }] }, slot: 'platforms.1.logoUrl', text: '/yelp.png' });
  check(pl.ok && JSON.stringify(pl.path) === JSON.stringify(['platforms', 1, 'logoUrl']) && pl.image === true && pl.value === '/yelp.png', '平台 logo ⟹ platforms[1].logoUrl', pl);
  const miss = inline.resolveInlineSlot({ component: compOf('logos'), props: { items: [{ imageUrl: '/l1.svg', alt: '' }] }, slot: 'items.0.imageUrl', text: '/zzz.svg' });
  check(!miss.ok && miss.why === 'mismatch', '地址对不上任何一项 ⟹ mismatch', miss);
}

// ══ ⑤ 必填的格（#1707）══════════════════════════════════════════════════════════════════════════
console.log('⑤ 一列图里必填的格 = 槽的 itemRequires 里的文字键（#1707）');
{
  // 本文件自己的谓词：位置是顶层列表槽（对象里包着的列表没有 itemRequires —— manifest 自检只许 list 槽写它），
  //   必填格 = itemRequires 里不是那个图片地址键的那几条。
  const wantReq = ids.flatMap((id) => {
    const w = want.get(id);
    const req = w.spec && Array.isArray(w.spec.itemRequires) ? w.spec.itemRequires : [];
    return req.filter((k) => k !== w.urlKey).map((k) => `${id}.${k}`);
  }).sort();
  const gotReq = ids.flatMap((id) => (cellsAt(id) ? cellsAt(id).subs.filter((s) => s.required === true).map((s) => `${id}.${s.sub}`) : [])).sort();
  console.log(`     读数：${gotReq.join(' ') || '(无)'}`);
  check(JSON.stringify(gotReq) === JSON.stringify(wantReq), `schema 里带 required 的格 = itemRequires 现取的那一份（${wantReq.join(' ')}）`, gotReq);
  check(JSON.stringify(gotReq) === JSON.stringify(['logos.items.alt']), '今天的读数只有 logos.items 的名字（变了要有人看一眼）', gotReq);
  // 反向：摘掉 logos 的 itemRequires 里的 alt ⟹ 那一格不再必填（证明 required 是从声明来的，不是写死在 logos 上）。
  const fakeDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'tmp-1707-blocks-'));
  try {
    const src = path.join(__dirname, '..', 'blocks');
    require('fs').cpSync(src, fakeDir, { recursive: true });
    const mf = path.join(fakeDir, 'logos', 'manifest.json');
    const m = JSON.parse(require('fs').readFileSync(mf, 'utf8'));
    m.slots.items.itemRequires = ['imageUrl'];
    require('fs').writeFileSync(mf, JSON.stringify(m, null, 2));
    const s2 = schemaLib.editorSchema({ blocksDir: fakeDir });
    const f2 = s2.components.find((c) => c.type === 'logos').fields.find((f) => f.slot === 'items');
    const alt2 = f2 && f2.subs.find((x) => x.sub === 'alt');
    check(!!alt2 && alt2.required === undefined, 'itemRequires 只留 imageUrl ⟹ 名字那一格不再带 required', alt2);
  } catch (e) {
    bad(`反向臂跑不起来：${e.message}`);
  } finally {
    require('fs').rmSync(fakeDir, { recursive: true, force: true });
  }
  // AC2：AI 改站那一关（scope:'edit'）对这一页的读数。
  const page = (alt3) => ({ pages: [{ slug: 'p', blocks: [{ type: 'logos', data: { items: [
    { imageUrl: '/l1.svg', alt: 'Acme' }, { imageUrl: '/l2.svg', alt: 'Globex' }, { imageUrl: '/l3.svg', alt: alt3 },
  ] } }] }], scope: 'edit' });
  const altProb = (r) => r.problems.filter((x) => /"items" 第 .* 项没有 alt/.test(x));
  const empty = altProb(manifestLib.validateSite(page('')));
  check(empty.length === 1 && /第 3 项没有 alt/.test(empty[0]), '名字空着 ⟹ scope:edit 拒「第 3 项没有 alt」（这就是面板要当场说出来的那件事）', empty);
  const filled = altProb(manifestLib.validateSite(page('Initech')));
  check(filled.length === 0, '名字补上 ⟹ scope:edit 的 problems 里没有这一条', filled);
}

// ══ #1723 全部列表挂上下限（画布条目条 🗑 到 min 灰掉）+ `max` 没被改名 ══════════════════════════════════════
console.log('\n── #1723 列表上下限的读数 + count: 旋钮照旧');
{
  const bound = (type, slot) => { const f = fieldOf(type, slot); return f ? `${f.min}/${f.max}` : 'missing'; };
  const want = { 'faq.items': '1/12', 'features.items': '1/8', 'pricing.plans': '1/4', 'cta.ctas': 'undefined/2', 'page-header.ctas': 'undefined/2',
    'hero.stats': 'undefined/undefined', 'hero.ctas': 'undefined/undefined' };
  for (const [k, v] of Object.entries(want)) {
    const [type, slot] = [k.slice(0, k.lastIndexOf('.')), k.slice(k.lastIndexOf('.') + 1)];
    check(bound(type, slot) === v, `${k} 的 min/max = ${v}`, bound(type, slot));
  }
  // 按钮列表的「最多几项」写在 manifest 的 `max` 上（#1479），itemBounds 回落读它；`count:` 旋钮也据它出 ⟹ 那五个旋钮照旧。
  const knobs = require('./lib/block-knobs.js');
  const counts = [];
  for (const [type, m] of manifests) for (const x of knobs.toolbarControlsOf(m)) if (String(x).startsWith('count:')) counts.push(`${type} ${x}`);
  check(JSON.stringify(counts.sort()) === JSON.stringify(['content count:ctas', 'cta count:ctas', 'features count:introCtas', 'milestones count:introCtas', 'page-header count:ctas']),
    `count: 旋钮集合照旧是五个（${counts.join(' · ')}）`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
