#!/usr/bin/env node
/**
 * editor-roundtrip.test.js — #1404：编辑器 config 从区块库生成 + 页面 JSON ⇄ Puck Data 往返无损。
 *
 *   node scripts/editor-roundtrip.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管三个文件：`scripts/lib/editor-schema.js`（清单）· `scripts/lib/editor-convert.js`（往返）·
 * `scripts/lib/editor-page.js` §effectiveWeights（锚点权重）。编辑器页的服务端 / 客户端两半调的就是它们。
 *
 * 🔴 「弄坏一次它会红」在本文件里**自己跑**，不靠人手改代码再改回去：每一格反向对照都拿一份被弄坏的
 *    副本（源码字符串替换后加载 / 临时目录里的假注册表 / 改过的 manifest）跑同一个判据，断言它点名。
 *    这样守卫将来被改瞎时，反向那一格先红。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });
function tmpdir(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `editor-rt-${label}-`));
  temps.push(d);
  return d;
}

let editorSchema; let slotCoverageProblems; let convert; let blocksLib; let manifestLib; let catalogLib; let editorPage;
try {
  ({ editorSchema, slotCoverageProblems } = require('./lib/editor-schema.js'));
  convert = require('./lib/editor-convert.js');
  blocksLib = require('./blocks.js');
  manifestLib = require('./lib/block-manifest.js');
  catalogLib = require('./lib/block-catalog.js');
  editorPage = require('./lib/editor-page.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

let schema;
try {
  schema = editorSchema();
} catch (e) {
  // blockShapeCatalog 拿不到 typescript 时抛「什么都没查」—— 那是读数取不到，不是通过。
  die(`算不出编辑器 schema：${e.message}`);
}
const manifests = manifestLib.loadManifests();
const catalog = catalogLib.blockShapeCatalog();
const compOf = (t) => schema.components.find((c) => c.type === t);
const nonRegion = [...manifests.values()].filter((m) => m.region !== true);

// ══ ① 组件清单：每份非 region manifest 都在，外壳不在 ═════════════════════════════════════════
console.log('① 组件清单');
{
  const want = nonRegion.map((m) => m.type).sort();
  const got = schema.components.map((c) => c.type).sort();
  check(JSON.stringify(want) === JSON.stringify(got), `组件集合 = 非 region manifest 集合（${want.length}）`,
    `少 ${want.filter((t) => !got.includes(t))} · 多 ${got.filter((t) => !want.includes(t))}`);
  check(!got.includes('header') && !got.includes('footer'), 'header / footer 不在（归 #1405）');
}

// ══ ② 字段两层比：顶层 = editableSlotPaths 的 slot；每个带子字段的 = 它的 sub 集合 ══════════════
console.log('② 字段两层比');
{
  const problems = [];
  let top = 0; let paths = 0;
  for (const m of nonRegion) {
    const c = compOf(m.type);
    if (!c) { problems.push(`${m.type} 整块缺`); continue; }
    const esp = manifestLib.editableSlotPaths(m);
    const wantTop = [...new Set(esp.map((e) => e.slot))].sort();
    const gotTop = c.fields.map((f) => f.slot).sort();
    if (JSON.stringify(wantTop) !== JSON.stringify(gotTop)) problems.push(`${m.type} 顶层 ${gotTop} ≠ ${wantTop}`);
    for (const f of c.fields) {
      // 验收 ③：`kind: link` 在 sub 集合之外只许多一个 `href`（#1404 r3），别的都不许多。
      const wantSub = [...esp.filter((e) => e.slot === f.slot && e.sub !== null).map((e) => e.sub), ...(f.kind === 'link' ? ['href'] : [])].sort();
      const gotSub = f.subs.map((s) => s.sub).sort();
      if (JSON.stringify(wantSub) !== JSON.stringify(gotSub)) problems.push(`${m.type}.${f.slot} 子字段 ${gotSub} ≠ ${wantSub}`);
      // 控件由 kind 决定：list → array；link / object → object；绝不把对象做成 array
      const wantControl = f.subs.length === 0 ? (f.kind === 'list' ? 'strings' : 'text') : (f.kind === 'list' ? 'list' : 'object');
      if (f.control !== wantControl) problems.push(`${m.type}.${f.slot} 控件 ${f.control} ≠ ${wantControl}（kind ${f.kind}）`);
      paths += f.subs.length || 1;
    }
    top += gotTop.length;
  }
  check(problems.length === 0, `每块两层都相等（顶层 ${top} · 路径 ${paths}）`, problems.join(' / '));
  // 反向对照：子字段少一个，只比顶层的判据会漏 —— 两层比必须点名
  const t = compOf('testimonials');
  const mutated = { ...t, fields: t.fields.map((f) => (f.slot === 'items' ? { ...f, subs: f.subs.slice(1) } : f)) };
  const esp = manifestLib.editableSlotPaths(manifests.get('testimonials'));
  const f = mutated.fields.find((x) => x.slot === 'items');
  const wantSub = esp.filter((e) => e.slot === 'items' && e.sub !== null).map((e) => e.sub).sort();
  check(JSON.stringify(f.subs.map((s) => s.sub).sort()) !== JSON.stringify(wantSub), '反向：testimonials.items 少一个子字段 → 第二层比出差异');
  // 图片槽一个都不是字段（「换图不做」：不出现，而不是出现了点不动）
  const imageFields = [];
  for (const m of nonRegion) for (const [slot, s] of Object.entries(m.slots || {})) {
    if (s.kind === 'image' && compOf(m.type).fields.some((x) => x.slot === slot)) imageFields.push(`${m.type}.${slot}`);
  }
  check(imageFields.length === 0, '图片槽 0 个出现在字段里', imageFields.join(' '));
}

// ══ ③ 每个槽位都有归属（字段 / 携带）+ 反向：manifest 加一个槽位而转换器不动 ════════════════════
console.log('③ 槽位归属');
{
  const p = slotCoverageProblems(schema, manifests);
  check(p.length === 0, '每份非 region manifest 的每个槽位恰有一个归属', p.join(' / '));
  const dir = tmpdir('blocks-slot');
  cp.execSync(`cp -a "${path.join(NEXT, 'blocks')}/." "${dir}"`);
  const mf = path.join(dir, 'testimonials', 'manifest.json');
  const j = JSON.parse(fs.readFileSync(mf, 'utf-8'));
  j.slots.ribbon = { kind: 'text', required: false, promptOptional: true, editLabel: 'Ribbon' };
  fs.writeFileSync(mf, JSON.stringify(j, null, 2));
  const mutatedManifests = manifestLib.loadManifests(dir);
  const stale = slotCoverageProblems(schema, mutatedManifests); // 旧 schema（转换器没跟上）配新 manifest
  check(stale.length === 1 && stale[0].startsWith('testimonials.ribbon'), '反向：manifest 加槽位、转换器不动 → 点名 testimonials.ribbon', stale.join(' / '));
  const fresh = slotCoverageProblems(editorSchema({ blocksDir: dir }), mutatedManifests);
  check(fresh.length === 0, '对照：schema 从同一份 manifest 重新派生 → 0 问题', fresh.join(' / '));
}

// ══ ④ 注册表加一个假块而转换器不动 → 点名那个块 ═════════════════════════════════════════════════
console.log('④ 清单不许手写');
{
  const dir = tmpdir('registry');
  const reg = path.join(dir, 'registry.generated.ts');
  const src = fs.readFileSync(catalogLib.REGISTRY_TS, 'utf-8');
  const fake = src.replace(/^(\s*)'announcement-bar':/m, "$1'fake-block-1404': AnnouncementBarSection,\n$1'announcement-bar':");
  if (fake === src) die('没在注册表里找到插假块的位置（注册表的写法变了？）');
  fs.writeFileSync(reg, fake);
  let msg = '';
  try { editorSchema({ registryPath: reg }); } catch (e) { msg = e.message; }
  check(msg.includes('fake-block-1404'), '注册表多一个没有 manifest 的块 → schema 抛并点名 fake-block-1404', msg || '没抛');
}

// ══ ⑤ 形态下拉 = 子目录去掉候选 ════════════════════════════════════════════════════════════════
console.log('⑤ 形态下拉');
{
  const problems = [];
  let total = 0;
  for (const c of schema.components) {
    const want = catalog.pairs.filter((p) => p.block === c.type && p.candidate !== true).map((p) => p.shape).sort();
    const got = c.shapes.map((s) => s.name).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`${c.type}: ${got} ≠ ${want}`);
    if (got.length === 0) problems.push(`${c.type}: 下拉是空的`);
    total += got.length;
  }
  const expectTotal = catalog.pairs.filter((p) => !['header', 'footer'].includes(p.block) && p.candidate !== true).length;
  check(problems.length === 0, `逐块相等（合计 ${total} 项）`, problems.join(' / '));
  check(total === expectTotal, `合计 = 非 region 对数减候选（${expectTotal}）`, String(total));
  const t = compOf('testimonials').shapes.map((s) => s.name);
  check(JSON.stringify(t) === JSON.stringify(['two-up', 'attribution-first', 'three-up', 'quote-rail']),
    'testimonials = two-up · attribution-first · three-up · quote-rail', t.join(' · '));
  check(['heading-side', 'masonry', 'quote-aside', 'single-featured'].every((x) => !t.includes(x)), 'testimonials 不含四个候选');
  const legacy = Object.keys(manifests.get('hero').variants || {});
  const hero = compOf('hero').shapes.map((s) => s.name);
  check(legacy.length > 0 && legacy.every((v) => !hero.includes(v)), `hero 下拉不含 legacy variants（${legacy.length} 条）`, hero.join(' · '));
  // 反向对照：去掉 masonry 的 candidate → 它回到下拉，另外三个候选仍不在（写死名单过不了这一格）
  const dir = tmpdir('blocks-cand');
  cp.execSync(`cp -a "${path.join(NEXT, 'blocks')}/." "${dir}"`);
  const md = path.join(dir, 'testimonials', 'masonry', 'shape.md');
  const before = fs.readFileSync(md, 'utf-8');
  const after = before.replace(/^candidate: true\n/m, '');
  if (after === before) die('masonry/shape.md 里没有 `candidate: true` 这一行（区块库变了？）');
  fs.writeFileSync(md, after);
  const t2 = editorSchema({ blocksDir: dir }).components.find((c) => c.type === 'testimonials').shapes.map((s) => s.name);
  check(t2.includes('masonry'), '反向：去掉 masonry 的 candidate → masonry 出现在下拉', t2.join(' · '));
  check(['heading-side', 'quote-aside', 'single-featured'].every((x) => !t2.includes(x)), '反向：另外三个候选仍不在', t2.join(' · '));
}

// ══ 往返工具 ═══════════════════════════════════════════════════════════════════════════════════
function normalize(raw, siteBlocks = {}) {
  const pages = [JSON.parse(JSON.stringify(raw))];
  blocksLib.normalizeLocalePages(pages, siteBlocks, 'en', () => {});
  return pages[0].blocks;
}

function toPuck(raw, siteBlocks = {}, conv = convert, sch = schema) {
  const blocks = normalize(raw, siteBlocks);
  const located = blocks.map((b) => editorPage.locateInRaw(raw, siteBlocks, raw.slug, b));
  const weights = editorPage.effectiveWeights(raw, siteBlocks, blocks, located);
  // #1406 —— 跟两个真调用方（编辑器页 page.tsx / 运行时底稿）一样把块库传进去：共用块的字段从它取。
  return conv.pageToPuck({ raw, blocks, located, schema: sch, weights, siteBlocks });
}

/** 两份页面 JSON 逐块比，回第一处差异（`块.槽位`），相等回 null。 */
function firstDiff(a, b) {
  const aa = a.blocks || a.sections; const bb = b.blocks || b.sections;
  if (!!a.blocks !== !!b.blocks) return '页面形状（blocks / sections）变了';
  if (aa.length !== bb.length) return `块数 ${aa.length} → ${bb.length}`;
  for (let i = 0; i < aa.length; i += 1) {
    const x = aa[i]; const y = bb[i];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const keys = new Set([...Object.keys(x.data || {}), ...Object.keys(y.data || {})]);
    for (const k of keys) {
      if (JSON.stringify((x.data || {})[k]) !== JSON.stringify((y.data || {})[k])) return `${x.type}.${k}`;
    }
    return `${x.type || x.ref}（块级键）`;
  }
  const rest = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of rest) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return `页面键 ${k}`;
  return null;
}

/** 打开一页：`initial` 是打开时那份（存盘时要它），`data` 是老板手上会被改的那份。两份各自是 JSON 副本
 *  —— 跨 server → client 边界之后本来就只剩 JSON。 */
function openPage(raw, siteBlocks = {}, conv = convert) {
  const p = toPuck(raw, siteBlocks, conv);
  return { initial: JSON.parse(JSON.stringify(p)), data: JSON.parse(JSON.stringify(p)) };
}

function roundTrip(raw, siteBlocks = {}, conv = convert) {
  const { initial, data } = openPage(raw, siteBlocks, conv);
  return conv.puckToPage({ raw, data, initial, schema, slug: raw.slug });
}

function fixturePage(minimal, shape = 'blocks') {
  const entries = nonRegion.map((m, i) => {
    const e = { type: m.type, data: catalogLib.sampleDataFor(m, { minimal }) };
    return shape === 'blocks' ? { id: `home-${m.type}-${i}`, ...e } : e;
  });
  return { slug: 'home', title: 'Fixture', [shape]: entries };
}

// ══ ⑥ 往返无损：夹具页两版 × 两种页面形状 ═══════════════════════════════════════════════════════
console.log('⑥ 往返无损');
for (const shape of ['blocks', 'sections']) {
  for (const minimal of [false, true]) {
    const raw = fixturePage(minimal, shape);
    const d = firstDiff(raw, roundTrip(raw));
    check(d === null, `${shape} · ${minimal ? '只必填' : '全填满'}（${nonRegion.length} 块）逐块深比相等`, d);
  }
}
{
  // 画布上一个字段都没改、立刻存盘 = 文件一个字节都不变（`Nothing to save.` 那条路的判据）
  const raw = fixturePage(false);
  check(convert.deepEqual(roundTrip(raw), raw), '没改任何东西 → 写回的 JSON 与原文 deepEqual（不会多出 weight / shape / 空串）');
}

// ── 反向对照一：转换器丢掉一个槽位 → 红，并点名 ──────────────────────────────────────────────────
function mutantConverter(find, replace) {
  const file = require.resolve('./lib/editor-convert.js');
  const src = fs.readFileSync(file, 'utf-8');
  if (!src.includes(find)) die(`弄坏转换器时没找到要替换的那一句：${find}`);
  const m = new Module(file + '#mutant', module);
  m.filename = file;
  m.paths = module.paths;
  m._compile(src.replace(find, replace), file);
  return m.exports;
}
{
  const dropper = mutantConverter(
    'for (const f of component.fields) mergeSlot(data, f, item.props[f.slot]);',
    'for (const f of component.fields) { if (f === component.fields[0]) { delete data[f.slot]; continue; } mergeSlot(data, f, item.props[f.slot]); }',
  );
  const raw = fixturePage(false);
  const d = firstDiff(raw, roundTrip(raw, {}, dropper));
  const firstField = `${nonRegion[0].type}.${compOf(nonRegion[0].type).fields[0].slot}`;
  check(d === firstField, `反向：转换器丢掉每块的第一个字段 → 守卫点名 ${firstField}`, String(d));
}

// ══ ⑦ 改字段真的写回、只写那一处 ═══════════════════════════════════════════════════════════════
console.log('⑦ 改字段');
{
  const raw = fixturePage(false);
  const { initial, data } = openPage(raw);
  const t = data.content.find((c) => c.type === 'testimonials');
  t.props.headline = 'Edited 1404';
  t.props.items[1].quote = 'New quote 1404';
  t.props.items.push({ name: 'Added', quote: 'Added quote' });
  const h = data.content.find((c) => c.type === 'hero');
  h.props.ctaPrimary.label = 'Book now 1404';
  const tb = data.content.find((c) => c.type === 'trusted-brands');
  tb.props.brands = [{ value: 'Acme' }, ...tb.props.brands];
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const ot = out.blocks.find((b) => b.type === 'testimonials');
  const rt = raw.blocks.find((b) => b.type === 'testimonials');
  check(ot.data.headline === 'Edited 1404', 'text 字段写回');
  check(ot.data.items[1].quote === 'New quote 1404' && ot.data.items[1].rating === rt.data.items[1].rating, 'list 子字段写回，同一项里没字段的键（rating）原样');
  check(ot.data.items.length === rt.data.items.length + 1 && ot.data.items[3].name === 'Added', 'list 加一项');
  const oh = out.blocks.find((b) => b.type === 'hero');
  check(oh.data.ctaPrimary.label === 'Book now 1404' && oh.data.ctaPrimary.href === raw.blocks.find((b) => b.type === 'hero').data.ctaPrimary.href,
    'link 是 object 字段：label 写回、href 原样（没被当成数组）');
  const ob = out.blocks.find((b) => b.type === 'trusted-brands');
  check(Array.isArray(ob.data.brands) && ob.data.brands[0] === 'Acme' && ob.data.brands.every((x) => typeof x === 'string'), '[string] 列表写回成字符串数组');
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed.sort()) === JSON.stringify(['hero', 'testimonials', 'trusted-brands']), '只有改过的三块变了', changed.join(' '));
  check(out.blocks.every((b) => b.weight === undefined), '顺序没动 → 一个 weight 都没写');
  // 形态下拉
  const { initial: initial2, data: data2 } = openPage(raw);
  data2.content.find((c) => c.type === 'testimonials').props._shape = 'three-up';
  const out2 = convert.puckToPage({ raw, data: data2, initial: initial2, schema, slug: 'home' });
  check(out2.blocks.find((b) => b.type === 'testimonials').shape === 'three-up', '改形态 → 那一条写上 shape');
}

// ══ ⑦b 按钮链接（#1404 r3）：6 个 link 槽位都有 Link 框；改了才写、不改逐字节不变 ═══════════════════
console.log('⑦b 按钮链接');
{
  const links = [];
  for (const c of schema.components) for (const f of c.fields) if (f.kind === 'link') links.push(`${c.type}.${f.slot}`);
  const wantLinks = [];
  for (const m of nonRegion) for (const [slot, sp] of Object.entries(m.slots || {})) {
    if (sp.kind === 'link' && sp.editLabel !== undefined) wantLinks.push(`${m.type}.${slot}`);
  }
  check(JSON.stringify(links.sort()) === JSON.stringify(wantLinks.sort()) && links.length === 6, `link 字段逐个列出（${links.length}）：${links.join(' · ')}`, wantLinks.join(' · '));
  const noHref = [];
  for (const c of schema.components) for (const f of c.fields) {
    if (f.kind === 'link' && !f.subs.some((x) => x.sub === 'href' && x.label === 'Link')) noHref.push(`${c.type}.${f.slot}`);
  }
  check(noHref.length === 0, '每个 link 字段都有显示名为 Link 的 href 子字段', noHref.join(' '));
  // PM 21:58 第 1 点：href 成了可写字段之后，全填满夹具不动就存仍然 deepEqual（href 逐字节不变）
  const raw = fixturePage(false);
  const hrefs = (page) => page.blocks.flatMap((b) => Object.values(b.data || {}).filter((v) => v && typeof v === 'object' && !Array.isArray(v) && 'href' in v).map((v) => v.href));
  check(hrefs(raw).length >= 6, `夹具里带 href 的对象 ${hrefs(raw).length} 个（量得到）`);
  const back = roundTrip(raw);
  check(convert.deepEqual(back, raw), 'href 是字段之后：不动就存，全页 deepEqual');
  // 只改文字：href 不变；只改链接：label 不变
  const { initial, data } = openPage(raw);
  const cta = data.content.find((c) => c.type === 'cta-banner');
  const hero = data.content.find((c) => c.type === 'hero');
  cta.props.button.href = '/contact-1404';
  hero.props.ctaPrimary.label = 'Text only 1404';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const rc = raw.blocks.find((b) => b.type === 'cta-banner'); const oc = out.blocks.find((b) => b.type === 'cta-banner');
  const rh = raw.blocks.find((b) => b.type === 'hero'); const oh = out.blocks.find((b) => b.type === 'hero');
  check(oc.data.button.href === '/contact-1404' && oc.data.button.label === rc.data.button.label, '老块只改链接 → href 变、按钮文字不变');
  check(oh.data.ctaPrimary.label === 'Text only 1404' && oh.data.ctaPrimary.href === rh.data.ctaPrimary.href, '只改文字 → href 逐字节不变');
  // 新插一个 hero，填文字和链接 → 落盘
  const { initial: i2, data: d2 } = openPage(raw);
  const heroComp = compOf('hero');
  const props = { id: 'puck-new-hero', ...convert.fieldProps(heroComp, {}), _shape: heroComp.defaultShape };
  props.ctaPrimary = { ...props.ctaPrimary, label: 'Book', href: '/contact' };
  d2.content.push({ type: 'hero', props });
  const nh = convert.puckToPage({ raw, data: d2, initial: i2, schema, slug: 'home' }).blocks.slice(-1)[0];
  check(nh.type === 'hero' && nh.data.ctaPrimary && nh.data.ctaPrimary.href === '/contact' && nh.data.ctaPrimary.label === 'Book', '新插的 hero 填了链接 → 写成 ctaPrimary {label, href}', JSON.stringify(nh.data));
  // PM 21:58 第 2 点那一格（共用块里 link 的 href 只读）#1406 起反过来：共用块能改字，link 的两格都能改，
  // 只锁形态；字段值取自块库**文件里**那一份（改动合回的就是它）。
  const siteBlocks = { promo: { type: 'cta-banner', data: catalogLib.sampleDataFor(manifests.get('cta-banner')), visibility: ['home'] } };
  const rawS = { slug: 'home', blocks: [{ id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) }, { ref: 'promo' }] };
  const sharedItems = toPuck(rawS, siteBlocks).content.filter((c) => c.props._src.shared);
  const si = sharedItems[0];
  check(sharedItems.length === 1 && si.props._src.locked === false && JSON.stringify(si.readOnly) === JSON.stringify({ _shape: true }),
    '共用块不锁：只有形态只读（button.href / button.label 都能改）', JSON.stringify(si && si.readOnly));
  check(!!si && JSON.stringify(si.props.button) === JSON.stringify(siteBlocks.promo.data.button), '共用块的字段值 = 块库文件里那一份', JSON.stringify(si && si.props.button));
}

// ══ ⑧ 排序 / 增删 / 复制 ══════════════════════════════════════════════════════════════════════
console.log('⑧ 排序 / 增删 / 复制');
function orderAfterRebuild(page, siteBlocks = {}) {
  return normalize(page, siteBlocks).map((b) => b.id);
}
{
  const raw = fixturePage(false);
  const { initial, data } = openPage(raw);
  [data.content[0], data.content[1]] = [data.content[1], data.content[0]];
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const canvas = data.content.map((c) => c.props.id);
  check(out.blocks[0].weight === 0 && out.blocks[1].weight === 10 && out.blocks[0].id === canvas[0], '换位 → weight 按画布位置 × 10 重算');
  check(JSON.stringify(orderAfterRebuild(out)) === JSON.stringify(canvas), '重建后的顺序 = 画布顺序');
  // 删除 + 插入 + 复制
  const { initial: i2, data: d2 } = openPage(raw);
  const removed = d2.content.splice(2, 1)[0];
  d2.content.splice(1, 0, { type: 'faq-accordion', props: { id: 'puck-new-1', ...convert.fieldProps(compOf('faq-accordion'), {}), headline: 'New FAQ', _shape: compOf('faq-accordion').defaultShape } });
  const dup = JSON.parse(JSON.stringify(d2.content[0])); dup.props.id = 'puck-dup-1';
  d2.content.splice(1, 0, dup);
  const out2 = convert.puckToPage({ raw, data: d2, initial: i2, schema, slug: 'home' });
  const ids = out2.blocks.map((b) => b.id);
  check(!ids.includes(removed.props.id), '删掉的块不在了');
  check(new Set(ids).size === ids.length, 'id 一页之内唯一（新块 / 复制品各有新 id）', ids.join(' '));
  const added = out2.blocks.find((b) => b.type === 'faq-accordion' && b.data && b.data.headline === 'New FAQ');
  check(!!added && added.shape === undefined, '插入的块落盘（没改形态就不写 shape）');
  const d5 = JSON.parse(JSON.stringify(i2));
  d5.content.push({ type: 'gallery', props: { id: 'puck-new-empty', ...convert.fieldProps(compOf('gallery'), {}), _shape: compOf('gallery').defaultShape } });
  const emptyNew = convert.puckToPage({ raw, data: d5, initial: i2, schema, slug: 'home' }).blocks.slice(-1)[0];
  check(emptyNew.type === 'gallery' && emptyNew.data && typeof emptyNew.data === 'object' && Object.keys(emptyNew.data).length === 0,
    '什么都没填就插入的块也带 data: {}（不造一种没有 data 的块）', JSON.stringify(emptyNew));
  let built = null; try { built = orderAfterRebuild(out2); } catch (e) { built = e.message; }
  check(Array.isArray(built) && built.length === d2.content.length, '增删复制之后仍能归一化（构建不会炸）', String(built));
  // 老 sections 形状：复制品不写 id（那种页面本来就没有 id）
  const rawS = fixturePage(false, 'sections');
  const { initial: i3, data: d3 } = openPage(rawS);
  const dup3 = JSON.parse(JSON.stringify(d3.content[0])); dup3.props.id = 'puck-dup-2';
  d3.content.push(dup3);
  const out3 = convert.puckToPage({ raw: rawS, data: d3, initial: i3, schema, slug: 'home' });
  check(Array.isArray(out3.sections) && !out3.blocks && out3.sections.every((s) => s.id === undefined), 'sections 形状保持 sections，条目不长出 id');
}

// ══ ⑨ 共用块：原样保留、没拖过就当锚点（#1406 之前是「锁住」）═══════════════════════════════════════════════════════════
console.log('⑨ 共用块');
{
  const siteBlocks = {
    promo: { type: 'cta-banner', data: catalogLib.sampleDataFor(manifests.get('cta-banner')), visibility: ['home'], weight: 15 },
    faq: { type: 'faq-accordion', data: catalogLib.sampleDataFor(manifests.get('faq-accordion')), visibility: [] },
  };
  const raw = {
    slug: 'home',
    blocks: [
      { id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) },
      { id: 'home-text-block-1', type: 'text-block', data: catalogLib.sampleDataFor(manifests.get('text-block')) },
      { ref: 'faq' },
      { id: 'home-gallery-3', type: 'gallery', data: catalogLib.sampleDataFor(manifests.get('gallery')) },
    ],
  };
  const { initial, data } = openPage(raw, siteBlocks);
  const canvas0 = data.content.map((c) => c.props.id);
  check(JSON.stringify(canvas0) === JSON.stringify(['home-hero-0', 'home-text-block-1', 'promo', 'faq', 'home-gallery-3']), '画布顺序 = 构建顺序（promo 按 weight 15 插在中间）', canvas0.join(' '));
  const shared = data.content.filter((c) => c.props._src.shared).map((c) => c.props.id);
  const locked = data.content.filter((c) => c.props._src.locked).map((c) => c.props.id);
  check(JSON.stringify(shared) === JSON.stringify(['promo', 'faq']) && locked.length === 0, '两种共用块都认得是共用的，都不锁（#1406）', `shared=${shared.join(' ')} locked=${locked.join(' ')}`);
  check(firstDiff(raw, convert.puckToPage({ raw, data, initial, schema, slug: 'home' })) === null, '不动 → 往返无损（注入的 promo 不被抄进这一页）');
  // 把 gallery 拖到最前、hero 拖到最后：promo(15) 是锚点，重建顺序必须 = 画布顺序
  const d2 = JSON.parse(JSON.stringify(data));
  const g = d2.content.pop(); const h = d2.content.shift();
  d2.content.unshift(g); d2.content.push(h);
  const canvas = d2.content.map((c) => c.props.id);
  const out = convert.puckToPage({ raw, data: d2, initial, schema, slug: 'home' });
  check(!out.blocks.some((b) => b.ref === 'promo' || b.id === 'promo'), '注入的共用块仍不进这一页的文件');
  check(out.blocks.some((b) => b.ref === 'faq' && Object.keys(b).every((k) => k === 'ref' || k === 'weight')), '{ref} 条目原样（只多一个 weight）');
  check(JSON.stringify(orderAfterRebuild(out, siteBlocks)) === JSON.stringify(canvas), '有锚点时重建顺序 = 画布顺序', `${orderAfterRebuild(out, siteBlocks).join(' ')} ≠ ${canvas.join(' ')}`);
  // 把两块都拖到锚点之后：画布下标 × 10 会越过锚点，必须插值
  const d3 = JSON.parse(JSON.stringify(data));
  const [hero3, text3] = d3.content.splice(0, 2);
  d3.content.splice(1, 0, hero3, text3); // promo, hero, text, faq, gallery
  const canvas3 = d3.content.map((c) => c.props.id);
  const out3 = convert.puckToPage({ raw, data: d3, initial, schema, slug: 'home' });
  check(JSON.stringify(orderAfterRebuild(out3, siteBlocks)) === JSON.stringify(canvas3), '块拖到锚点之后 → 重建顺序仍 = 画布顺序', `${orderAfterRebuild(out3, siteBlocks).join(' ')} ≠ ${canvas3.join(' ')}`);
  // 复制一个共用块：不落盘（否则一页里两条同 id 的 ref）
  const d4 = JSON.parse(JSON.stringify(data));
  const dup = JSON.parse(JSON.stringify(d4.content[3])); dup.props.id = 'puck-dup-ref';
  d4.content.push(dup);
  const out4 = convert.puckToPage({ raw, data: d4, initial, schema, slug: 'home' });
  check(out4.blocks.filter((b) => b.ref === 'faq').length === 1, '复制共用块不会造出第二条 {ref}');
}

// ══ ⑩a 页面里有一个区块库不认识的块（QA1 r1）：能打开、往返无损、那一条原样写回 ══════════════════
console.log('⑩a 不认识的块类型');
{
  const retired = { id: 'home-retired-block-xyz-1', type: 'retired-block-xyz', data: { headline: 'Old', items: [1, 2] }, weight: 7 };
  const raw = {
    slug: 'home',
    blocks: [
      { id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) },
      retired,
      { id: 'home-gallery-2', type: 'gallery', data: catalogLib.sampleDataFor(manifests.get('gallery')) },
    ],
  };
  let opened = null; let err = '';
  try { opened = openPage(raw); } catch (e) { err = e.message; }
  check(!!opened, '能打开（不抛）', err);
  if (opened) {
    const u = opened.initial.content.find((c) => c.props.id === retired.id);
    check(!!u && u.type === convert.UNKNOWN_TYPE && u.props._src.locked === true, '画布上是一个锁住的「未知块」占位', JSON.stringify(u && { type: u.type, locked: u.props._src.locked }));
    check(firstDiff(raw, convert.puckToPage({ raw, data: opened.data, initial: opened.initial, schema, slug: 'home' })) === null, '不动 → 往返无损');
    // 其余块换位：未知块那一条原样（只可能多一个 weight），不丢
    const { initial, data } = openPage(raw);
    [data.content[0], data.content[2]] = [data.content[2], data.content[0]];
    const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
    const kept = out.blocks.find((b) => b.id === retired.id);
    const { weight: _w, ...keptRest } = kept || {};
    const { weight: _w0, ...origRest } = retired;
    check(!!kept && convert.deepEqual(keptRest, origRest), '其余块换位之后，未知块那一条原样写回', JSON.stringify(kept));
    check(out.blocks.length === 3, '块数不变', String(out.blocks.length));
  }
  // 按 visibility 注进来的共用块类型也不认识：同样能打开，而且不被抄进这一页
  const siteBlocks = { oldpromo: { type: 'retired-block-xyz', data: {}, visibility: ['home'] } };
  const raw2 = { slug: 'home', blocks: [{ id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) }] };
  let back2 = null; try { back2 = roundTrip(raw2, siteBlocks); } catch (e) { back2 = e.message; }
  check(back2 && typeof back2 === 'object' && firstDiff(raw2, back2) === null, '注入的共用块类型不认识 → 也能打开、往返无损', String(typeof back2 === 'string' ? back2 : ''));
}

// ══ ⑩ 两种站形状：真站（skipAI 建站路）每一页都往返一次 ═════════════════════════════════════════
console.log('⑩ 两种站形状');
function makeSite(label, flat) {
  const root = tmpdir(`site-${label}`);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'rttest01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  if (!fs.existsSync(path.join(site, 'en', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  if (flat) {
    for (const e of fs.readdirSync(path.join(site, 'en'))) fs.renameSync(path.join(site, 'en', e), path.join(site, e));
    fs.rmSync(path.join(site, 'en'), { recursive: true });
    fs.rmSync(path.join(site, 'site_meta.json'));
  }
  return work;
}
for (const flat of [false, true]) {
  const work = makeSite(flat ? 'flat' : 'multi', flat);
  const { readSiteShape } = require(path.join(work, 'scripts', 'lib', 'site-shape.js'));
  const shape = readSiteShape(path.join(work, 'site'));
  check(!!shape && shape.flat === flat, `${flat ? '扁平' : '多语言'}站：site-shape.js 判它是 ${flat ? 'flat' : '多语言'}`);
  const pagesDir = flat ? path.join(work, 'site', 'pages') : path.join(work, 'site', 'en', 'pages');
  const pages = [];
  require('./lib/page-files.js').readPagesRecursive(pagesDir, '', pages, new Map());
  const siteSchema = editorSchema({ rootDir: work });
  const diffs = [];
  let n = 0;
  for (const p of pages) {
    const src = editorPage.editorSource(work, 'en', p.slug);
    if ('error' in src) { diffs.push(`${p.slug}: ${src.error}`); continue; }
    const blocks = normalize(src.raw, src.siteBlocks);
    const located = blocks.map((b) => editorPage.locateInRaw(src.raw, src.siteBlocks, p.slug, b));
    const opened = convert.pageToPuck({ raw: src.raw, blocks, located, schema: siteSchema, weights: editorPage.effectiveWeights(src.raw, src.siteBlocks, blocks, located) });
    const data = JSON.parse(JSON.stringify(opened));
    const back = convert.puckToPage({ raw: src.raw, data, initial: JSON.parse(JSON.stringify(opened)), schema: siteSchema, slug: p.slug });
    const d = firstDiff(src.raw, back);
    if (d) diffs.push(`${p.slug}: ${d}`);
    n += 1;
  }
  check(n > 0 && diffs.length === 0, `${flat ? '扁平' : '多语言'}站 ${n} 页全部往返无损`, diffs.join(' / '));
}

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail > 0 ? 1 : 0);
