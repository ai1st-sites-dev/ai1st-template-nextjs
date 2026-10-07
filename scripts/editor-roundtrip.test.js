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

let editorSchema; let slotCoverageProblems; let itemTopKeys; let convert; let blocksLib; let manifestLib; let catalogLib; let editorPage;
try {
  ({ editorSchema, slotCoverageProblems, itemTopKeys } = require('./lib/editor-schema.js'));
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
    // #1463 —— 另外三种槽位也出字段，判据全从 manifest 读：`kind: color`（色板）、声明了 `knobs` 的
    //    `options`（预设 + 旋钮）、`editItems: true` 的列表（纯图片、只能挪 / 删）。
    const slots = m.slots || {};
    const special = (slot) => {
      const sp = slots[slot] || {};
      if (sp.kind === 'color') return 'color';
      if (slot === 'options' && Array.isArray(sp.knobs) && sp.knobs.length) return 'options';
      if (sp.editItems === true) return 'items';
      // #1471 —— 选站级表单的槽（`form: { id? }`）：一个对象字段、子字段只有 id（编辑器画成表单下拉）。
      if (slot === 'form' && sp.kind === 'object' && /^\{\s*id\?\s*\}$/.test(String(sp.shape || ''))) return 'formRef';
      if (Array.isArray(sp.intRange) && typeof sp.editLabel === 'string') return 'int'; // #1497 —— 整数设置（postCount）
      return null;
    };
    const wantTop = [...new Set([...esp.map((e) => e.slot), ...Object.keys(slots).filter((x) => special(x))])].sort();
    const gotTop = c.fields.map((f) => f.slot).sort();
    if (JSON.stringify(wantTop) !== JSON.stringify(gotTop)) problems.push(`${m.type} 顶层 ${gotTop} ≠ ${wantTop}`);
    for (const f of c.fields) {
      // 验收 ③：`kind: link` 在 sub 集合之外只许多一个 `href`（#1404 r3），别的都不许多。
      // #1463 —— `choices` 里有的（不是数组取值的）子字段是一格下拉，也算一个子字段。
      const choiceSubs = Object.keys((slots[f.slot] || {}).choices || {})
        .filter((sub) => !new RegExp(`${sub}\\s*:\\s*\\[`).test((slots[f.slot] || {}).shape || ''));
      // #1489 —— 列表槽**每一项**的词表（`itemChoices`，一格下拉）与 `itemNeeds` 点名的必填子字段（一格文字）也各算一个子字段。
      const itemSubs = f.kind === 'list'
        ? [...Object.keys((slots[f.slot] || {}).itemChoices || {}), ...Object.values((slots[f.slot] || {}).itemNeeds || {}).flat()] : [];
      const wantSub = [...new Set([...esp.filter((e) => e.slot === f.slot && e.sub !== null).map((e) => e.sub), ...choiceSubs, ...itemSubs,
        ...(f.kind === 'link' ? ['href'] : []), ...(special(f.slot) === 'formRef' ? ['id'] : []),
        // #1518 —— 项形状里必有 `href` 的列表槽（按钮列表）也多一个 `href`。哪几个槽算数由下面 #1518 那一节逐个钉死。
        ...(f.kind === 'list' && itemTopKeys((slots[f.slot] || {}).shape).includes('href') ? ['href'] : [])])].sort();
      const gotSub = f.subs.map((s) => s.sub).sort();
      if (JSON.stringify(wantSub) !== JSON.stringify(gotSub)) problems.push(`${m.type}.${f.slot} 子字段 ${gotSub} ≠ ${wantSub}`);
      // 控件由 kind 决定：list → array；link / object → object；绝不把对象做成 array
      const sp = special(f.slot);
      const wantControl = sp === 'color' ? 'color' : sp === 'options' ? 'options' : sp === 'items' ? 'list' : sp === 'formRef' ? 'object' : sp === 'int' ? 'int'
        : f.subs.length === 0 ? (f.kind === 'list' ? 'strings' : f.kind === 'richtext' ? 'richtext' : 'text') : (f.kind === 'list' ? 'list' : 'object');
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
  // #1425（T3）：插入锚原来是 'announcement-bar'（随旧库删了），换成 'cta'
  const fake = src.replace(/^(\s*)'cta':/m, "$1'fake-block-1404': CtaSection,\n$1'cta':");
  if (fake === src) die('没在注册表里找到插假块的位置（注册表的写法变了？）');
  fs.writeFileSync(reg, fake);
  let msg = '';
  try { editorSchema({ registryPath: reg }); } catch (e) { msg = e.message; }
  check(msg.includes('fake-block-1404'), '注册表多一个没有 manifest 的块 → schema 抛并点名 fake-block-1404', msg || '没抛');
}

// 在拷出来的块库 `dir` 里删掉一个形态：子目录 + manifest 里点名它的预设（每个形态都有预设，而 loadManifests
// 不许预设点名一个不存在的形态目录）。⑤ 的反向对照与 ⑦d 共用。
function dropShape(dir, block, shape) {
  const shapeDir = path.join(dir, block, shape);
  if (!fs.existsSync(path.join(shapeDir, 'shape.md'))) die(`${block}/${shape}/shape.md 不在（区块库变了？）`);
  fs.rmSync(shapeDir, { recursive: true });
  const mf = path.join(dir, block, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
  if (Array.isArray(m.presets)) m.presets = m.presets.filter((pr) => pr.shape !== shape);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
}

// ══ ⑤ 形态下拉 = 形态子目录 ══════════════════════════════════════════════════════════════════════
console.log('⑤ 形态下拉');
{
  const problems = [];
  let total = 0;
  for (const c of schema.components) {
    const want = catalog.pairs.filter((p) => p.block === c.type).map((p) => p.shape).sort();
    const got = c.shapes.map((s) => s.name).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`${c.type}: ${got} ≠ ${want}`);
    if (got.length === 0) problems.push(`${c.type}: 下拉是空的`);
    total += got.length;
  }
  // #1424 —— 外壳区按 manifest 自己的 `region === true` 判，不手抄名单（手抄的 `['header', 'footer']`
  // 在 `header` 进来那天就少了一个，合计差 1 而报的是「编辑器下拉错了」）。
  const isRegion = (block) => (catalog.manifests.get(block) || {}).region === true;
  const expectTotal = catalog.pairs.filter((p) => !isRegion(p.block)).length;
  check(problems.length === 0, `逐块相等（合计 ${total} 项）`, problems.join(' / '));
  check(total === expectTotal, `合计 = 非 region 对数（${expectTotal}）`, String(total));
  // #1425（T3）：testimonials 改成新库那一块（原来是旧 testimonials 的 two-up · attribution-first · three-up · quote-rail）
  const t = compOf('testimonials').shapes.map((s) => s.name);
  check(JSON.stringify(t) === JSON.stringify(['cards', 'side-intro', 'big-quote', 'quote-card', 'ratings']),
    'testimonials = cards · side-intro · big-quote · quote-card · ratings', t.join(' · '));
  // #1419 —— manifest 里那份旧的 `variants` 词表整套删了（它跟子目录对不上，下拉从来不该读它）。
  // 这一格原来断言「hero 下拉不含那 9 个旧名字」，词表没了就改成断言这个键不再存在 —— 写回去的话这里红。
  const legacyKeyed = [...manifests.values()].filter((m) => 'variants' in m || 'variantKey' in m).map((m) => m.type);
  check(manifests.size > 0 && legacyKeyed.length === 0,
    `manifest 里没有 variants / variantKey 键（${manifests.size} 份）`, legacyKeyed.join(' · '));
  // 反向对照：下拉读的是形态子目录 —— 拷出来的块库里删掉 testimonials/ratings 子目录 → 它从下拉里消失，其余四个仍在
  //    （写死名单的实现过不了这一格）。#1579 之前这一臂是「给 ratings 标成候选」，候选形态那条线删了。
  const dir = tmpdir('blocks-drop');
  cp.execSync(`cp -a "${path.join(NEXT, 'blocks')}/." "${dir}"`);
  dropShape(dir, 'testimonials', 'ratings');
  const t2 = editorSchema({ blocksDir: dir }).components.find((c) => c.type === 'testimonials').shapes.map((s) => s.name);
  check(!t2.includes('ratings'), '反向：删掉 ratings 子目录 → ratings 从下拉里消失', t2.join(' · '));
  check(['cards', 'side-intro', 'big-quote', 'quote-card'].every((x) => t2.includes(x)), '反向：其余四个仍在', t2.join(' · '));
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
  // 画布上一个字段都没改、立刻存盘 = 文件一个字节都不变（「没有要存的」那条路的判据 —— #1453 起 autosave 据它判停手之后发不发）
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
  // #1425（T3）：link 对象字段原来量的是 hero.ctaPrimary（新 hero 的按钮是 ctas 列表），换成 logos.introCta（kind=link）
  const h = data.content.find((c) => c.type === 'logos');
  h.props.introCta.label = 'Book now 1404';
  // 📌 #1425（T3）—— 这里原来还改 trusted-brands.brands（顶层 [string] 列表）；那个块随旧库删了，新库里没有顶层 [string] 列表槽。
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const ot = out.blocks.find((b) => b.type === 'testimonials');
  const rt = raw.blocks.find((b) => b.type === 'testimonials');
  check(ot.data.headline === 'Edited 1404', 'text 字段写回');
  check(ot.data.items[1].quote === 'New quote 1404' && ot.data.items[1].rating === rt.data.items[1].rating, 'list 子字段写回，同一项里没字段的键（rating）原样');
  check(ot.data.items.length === rt.data.items.length + 1 && ot.data.items[3].name === 'Added', 'list 加一项');
  const oh = out.blocks.find((b) => b.type === 'logos');
  check(oh.data.introCta.label === 'Book now 1404' && oh.data.introCta.href === raw.blocks.find((b) => b.type === 'logos').data.introCta.href,
    'link 是 object 字段：label 写回、href 原样（没被当成数组）');
  // 📌 #1425（T3）—— 这里原来还有「[string] 列表写回成字符串数组」（trusted-brands.brands）；理由同上。
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed.sort()) === JSON.stringify(['logos', 'testimonials']), '只有改过的两块变了', changed.join(' '));
  check(out.blocks.every((b) => b.weight === undefined), '顺序没动 → 一个 weight 都没写');
  // 形态下拉
  const { initial: initial2, data: data2 } = openPage(raw);
  data2.content.find((c) => c.type === 'testimonials').props._shape = 'side-intro'; // #1425（T3）：原来是旧 testimonials 的 three-up
  const out2 = convert.puckToPage({ raw, data: data2, initial: initial2, schema, slug: 'home' });
  check(out2.blocks.find((b) => b.type === 'testimonials').shape === 'side-intro', '改形态 → 那一条写上 shape');
}

// ══ ⑦e #1477：颜色槽写渐变、再改回纯色 ════════════════════════════════════════════════════════
console.log('⑦e 颜色槽写渐变');
{
  const { GRADIENT_SWATCHES, toneForBg } = require('./lib/contrast.js');
  const heroF = compOf('hero').fields.find((f) => f.slot === 'bg');
  check(!!heroF && JSON.stringify(heroF.gradients) === JSON.stringify(GRADIENT_SWATCHES),
    'hero 的 bg 字段带着三档预设渐变（= contrast.js §GRADIENT_SWATCHES）', JSON.stringify(heroF && heroF.gradients));
  const raw = fixturePage(false);
  const g = heroF.gradients[2];
  const { initial, data } = openPage(raw);
  data.content.find((c) => c.type === 'hero').props.bg = JSON.parse(JSON.stringify(g));
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const bg = out.blocks.find((b) => b.type === 'hero').data.bg;
  check(bg && typeof bg === 'object' && JSON.stringify(bg) === JSON.stringify(g) && toneForBg(bg) === 'dark',
    `选一档预设渐变再存 ⟹ data.bg 是 {stops, angle} 对象（${JSON.stringify(bg)}）、字色判成反白`);
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['hero']), '只有 hero 那一块变了', changed.join(' '));
  // 重开：存了渐变的块打开之后字段里仍是那条渐变（不是「没填」），什么都不改再存 ⟹ 逐字不变。
  const reopened = openPage(out);
  check(JSON.stringify(reopened.data.content.find((c) => c.type === 'hero').props.bg) === JSON.stringify(g), '重开：字段里读回同一条渐变');
  check(firstDiff(out, convert.puckToPage({ raw: out, data: reopened.data, initial: reopened.initial, schema, slug: 'home' })) === null,
    '重开什么都不改再存 ⟹ 往返无损（渐变没被当成「无」删掉）');
  reopened.data.content.find((c) => c.type === 'hero').props.bg = '#ffffff';
  const back = convert.puckToPage({ raw: out, data: reopened.data, initial: reopened.initial, schema, slug: 'home' });
  check(back.blocks.find((b) => b.type === 'hero').data.bg === '#ffffff', '再改回 #ffffff ⟹ 存的是字符串（不留 stops）');
  // 阳性对照：toProp 回到只收字符串（#1477 之前的样子）⟹ 重开那一格读成 undefined，存盘把渐变删掉。
  const old = mutantConverter("return typeof value === 'string' ? value : isPlainObject(value) ? clone(value) : undefined;",
    "return typeof value === 'string' ? value : undefined;");
  const o2 = openPage(out, {}, old);
  const lost = old.puckToPage({ raw: out, data: o2.data, initial: o2.initial, schema, slug: 'home' });
  check(o2.data.content.find((c) => c.type === 'hero').props.bg === undefined && firstDiff(out, lost) !== null,
    `阳性对照：toProp 只收字符串 ⟹ 重开读成「没填」，往返报出差异（${firstDiff(out, lost)}）`);
}

// ══ ⑦g #1471：form.id 在 Puck 里是下拉（选项 = 站级表单库的名字），选一张 ⟹ 存盘 data.form.id 就是它 ═══════════════
console.log('⑦g form.id 下拉（站级表单库）');
{
  const { formIdOptions } = require('./lib/site-forms.js');
  // #1635 起新站默认（和演示生意）只有一张表单 ⟹ 「每张」要两张才量得出来：用一份内联的两张（老板自己加了第二张的站就是这个形状）。
  const FORMS = [{ id: 'contact', name: 'Contact us', fields: ['name', 'phone', 'email', 'message'], primary: 'phone' },
    { id: 'booking', name: 'Book a visit', fields: ['name', 'phone'], primary: 'phone' }];
  const opts = formIdOptions(FORMS);
  check(opts[0].value === '' && opts.slice(1).map((o) => o.value).join(',') === 'contact,booking'
    && opts.slice(1).map((o) => o.label).join(' | ') === FORMS.map((x) => x.name).join(' | '),
    `下拉选项 = 「第一张」+ 每张表单的名字（${opts.map((o) => `${o.label}=${o.value || '∅'}`).join(' · ')}）`);
  check(formIdOptions([]).length === 1, '没有表单库 ⟹ 下拉只有「第一张」那一项');
  // EditorApp 把 form 槽的 id 子字段接到这份选项上（源码里那一处）。
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'editor', 'EditorApp.tsx'), 'utf8');
  // #1634 —— 那一格从 Puck 的 select 换成自定义字段 FormIdField（下拉 + 「Edit this form」），选项仍取 formIdOptions(forms)。
  const formField = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'editor', 'FormCopyEditor.tsx'), 'utf8');
  check(/f\.slot === 'form' && s\.sub === 'id'[\s\S]{0,400}<FormIdField /.test(app) && /<select[\s\S]{0,400}formIdOptions\(forms\)/.test(formField),
    'EditorApp：form 槽的 id 画成 FormIdField，它的下拉选项来自 formIdOptions(forms)（🔴 弱判据：只证源码接上了）');
  for (const type of ['hero', 'footer', 'contact', 'cta']) {
    const c = compOf(type);
    if (!c) { if (type === 'footer') continue; bad(`${type} 不在组件清单里`); continue; }
    const fld = c.fields.find((x) => x.slot === 'form');
    check(!!fld && fld.control === 'object' && fld.subs.map((x) => x.sub).join(',') === 'id', `${type}：form 槽是对象字段、子字段只有 id`,
      fld ? `${fld.control} / ${fld.subs.map((x) => x.sub).join(',')}` : '没有');
  }
  const raw = fixturePage(false);
  const { initial, data } = openPage(raw);
  const item = data.content.find((c) => c.type === 'cta');
  item.props.form = { ...(item.props.form || {}), id: opts[2].value };
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const blk = out.blocks.find((b) => b.type === 'cta');
  check(blk.data.form && blk.data.form.id === opts[2].value, `选「${opts[2].label}」再存 ⟹ cta 的 data.form.id = ${JSON.stringify(blk.data.form)}`);
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['cta']), '只有 cta 那一块变了', changed.join(' '));
  const re = openPage(out);
  check(re.data.content.find((c) => c.type === 'cta').props.form.id === opts[2].value, `重开：下拉里读回 ${opts[2].value}`);
}

// ══ ⑦f #1483：pricing 在 Puck 里 —— 能拖、能改 plans、点预设 / 拧旋钮显示 Custom、点 Rainbow 颜色跟着变 ═══════
console.log('⑦f pricing 预设带颜色');
{
  const { presetClickProps, presetNameFor } = require('./lib/block-knobs.js');
  const comp = compOf('pricing');
  check(!!comp, 'pricing 在组件清单里（左栏能拖）');
  const opt = comp.fields.find((f) => f.control === 'options');
  const RB = { stops: ['#7d52f4', '#f7b733'], angle: 135 };
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  const nameOf = (props) => presetNameFor(man, { ...(props.options || {}), ...Object.fromEntries(opt.colorSlots.map((c) => [c, props[c]])) });
  const raw = fixturePage(false);
  const { initial, data } = openPage(raw);
  const item = data.content.find((c) => c.type === 'pricing');
  check(!!item && Array.isArray(item.props.plans) && item.props.plans.length > 0, `打开之后 plans 是列表字段（${item && item.props.plans && item.props.plans.length} 项）`);
  // 点 Rainbow ⟹ options = 它的旋钮、bg / featuredColor = 那道渐变；侧栏判成 Rainbow（Plan cards 不亮）。
  item.props = presetClickProps(opt, item.props, 'Rainbow');
  check(JSON.stringify(item.props.bg) === JSON.stringify(RB) && JSON.stringify(item.props.featuredColor) === JSON.stringify(RB) && nameOf(item.props) === 'Rainbow',
    `点 Rainbow ⟹ bg / featuredColor 设成渐变、侧栏亮 Rainbow（${nameOf(item.props)}）`);
  item.props.plans[0].name = 'Renamed plan';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const blk = out.blocks.find((b) => b.type === 'pricing');
  check(JSON.stringify(blk.data.bg) === JSON.stringify(RB) && JSON.stringify(blk.data.featuredColor) === JSON.stringify(RB)
    && blk.data.options.introPosition === 'top' && blk.data.plans[0].name === 'Renamed plan',
  '存盘 ⟹ data.bg / data.featuredColor 是那道渐变、options 是 Rainbow 的旋钮、plans[0].name 改了');
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['pricing']), '只有 pricing 那一块变了', changed.join(' '));
  // 拧 featuredColor ⟹ 回落 Plan cards；拧一个旋钮 ⟹ Custom；点 Plan cards ⟹ 两个颜色都清掉。
  check(nameOf({ ...item.props, featuredColor: '#dc2626' }) === 'Plan cards', 'featuredColor 改成 #dc2626 ⟹ 侧栏回落 Plan cards');
  check(nameOf({ ...item.props, options: { ...item.props.options, planStyle: 'plain' } }) === 'custom', '拧 planStyle ⟹ Custom');
  const back = presetClickProps(opt, item.props, 'Plan cards');
  check(!('bg' in back) && !('featuredColor' in back) && nameOf(back) === 'Plan cards', '点 Plan cards ⟹ 两个颜色字段都删掉、侧栏亮 Plan cards');
  const re = openPage(out);
  re.data.content.find((c) => c.type === 'pricing').props = presetClickProps(opt, re.data.content.find((c) => c.type === 'pricing').props, 'Plan cards');
  const cleared = convert.puckToPage({ raw: out, data: re.data, initial: re.initial, schema, slug: 'home' }).blocks.find((b) => b.type === 'pricing');
  check(!('bg' in cleared.data) && !('featuredColor' in cleared.data), '存盘 ⟹ 页面 JSON 里 bg / featuredColor 两个键都没了（恢复成空）');
  // 没有带颜色预设的块：点预设颜色一个都不碰（规则 2 只对 pricing 生效）。
  const heroOpt = compOf('hero').fields.find((f) => f.control === 'options');
  const hp = presetClickProps(heroOpt, { bg: '#0f172a', options: {} }, heroOpt.presets[1].name);
  check(hp.bg === '#0f172a' && JSON.stringify(heroOpt.colorSlots) === '[]', `hero 点预设 ⟹ bg 不动（colorSlots ${JSON.stringify(heroOpt.colorSlots)}）`);
  // 阳性对照：把 pricing 字段里的 colorSlots 拿掉（= 编辑器不知道哪些颜色归预设管）⟹ 点 Plan cards 渐变还留着。
  const blind = presetClickProps({ ...opt, colorSlots: [] }, item.props, 'Plan cards');
  check(JSON.stringify(blind.bg) === JSON.stringify(RB), '阳性对照：没有 colorSlots ⟹ 点 Plan cards 渐变还留着（上面那格的「清掉」是 colorSlots 带来的）');
}

// ══ ⑦g #1487：team 在 Puck 里 —— 能拖、能改 members、点预设 / 拧旋钮显示 Custom、点 Hiring 招聘卡出现 ═══════
console.log('⑦g team 预设带部件');
{
  const { presetClickProps, presetNameFor } = require('./lib/block-knobs.js');
  const comp = compOf('team');
  check(!!comp, 'team 在组件清单里（左栏能拖）');
  const opt = comp.fields.find((f) => f.control === 'options');
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  const nameOf = (props) => presetNameFor(man, { ...(props.options || {}), join: props.join });
  const raw = fixturePage(false);
  const tb = raw.blocks.find((b) => b.type === 'team');
  check(!!tb, '夹具页里有 team');
  // 从一块没有招聘卡的 team 开始（join 空）。
  delete tb.data.join;
  tb.data.options = { ...opt.presets.find((p) => p.name === 'Cards').knobs };
  const { initial, data } = openPage(raw);
  const item = data.content.find((c) => c.type === 'team');
  check(!!item && Array.isArray(item.props.members) && item.props.members.length > 0, `打开之后 members 是列表字段（${item && item.props.members && item.props.members.length} 项）`);
  check(nameOf(item.props) === 'Cards', `打开时侧栏亮 Cards（${nameOf(item.props)}）`);
  check(nameOf({ ...item.props, options: { ...item.props.options, memberStyle: 'plain' } }) === 'custom', '拧 memberStyle ⟹ Custom');
  item.props = presetClickProps(opt, item.props, 'Hiring');
  check(JSON.stringify(item.props.join) === JSON.stringify(opt.partDemos.join) && nameOf(item.props) === 'Hiring',
    `点 Hiring ⟹ join 用占位内容填上、侧栏亮 Hiring（${nameOf(item.props)}）`);
  item.props.members[0].name = 'Renamed member';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const blk = out.blocks.find((b) => b.type === 'team');
  check(blk.data.join && blk.data.join.title === opt.partDemos.join.title && blk.data.options.membersColumns === '3' && blk.data.members[0].name === 'Renamed member',
    '存盘 ⟹ data.join 是占位招聘卡、options 是 Hiring 的旋钮、members[0].name 改了');
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['team']), '只有 team 那一块变了', changed.join(' '));
  // 再点 Cards ⟹ Cards 亮、join 还在；清空 join ⟹ 不再是 Hiring。
  const cards = presetClickProps(opt, item.props, 'Cards');
  check(nameOf(cards) === 'Cards' && cards.join && cards.join.title === opt.partDemos.join.title, '再点 Cards ⟹ Cards 亮、招聘卡内容还在');
  check(nameOf({ ...item.props, join: undefined }) === 'custom', '把 join 清空 ⟹ Hiring 不亮（Custom）');
  // 阳性对照：字段里没有 partDemos（= 编辑器不知道拿什么填）⟹ 点 Hiring 招聘卡不出现、侧栏也不亮 Hiring。
  const blind = presetClickProps({ ...opt, partDemos: {} }, { ...item.props, join: undefined }, 'Hiring');
  check(blind.join === undefined && nameOf(blind) === 'custom', '阳性对照：没有 partDemos ⟹ 点 Hiring 招聘卡不出现（上面那格的「填上」是 partDemos 带来的）');
}

// ══ ⑦h #1495：gallery 在 Puck 里 —— 能拖、能增删照片、点预设 / 拧旋钮显示 Custom ════════════════════════
console.log('⑦h gallery 增删照片 · 预设');
{
  const { presetNameFor } = require('./lib/block-knobs.js');
  const comp = compOf('gallery');
  check(!!comp, 'gallery 在组件清单里（左栏能拖）');
  const opt = comp.fields.find((f) => f.control === 'options');
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  const nameOf = (props) => presetNameFor(man, props.options || {});
  check(JSON.stringify(opt.presets.map((p) => p.name)) === '["Grid","Masonry","Mosaic","Side intro"]', `四个预设按钮（${opt.presets.map((p) => p.name).join(' / ')}）`);
  const raw = fixturePage(false);
  const gb = raw.blocks.find((b) => b.type === 'gallery');
  check(!!gb, '夹具页里有 gallery');
  const photo = (i) => ({ image: { imageUrl: `https://example.com/p${i}.jpg`, alt: '' }, title: `Job ${i}`, caption: `Place ${i}` });
  gb.data.items = [photo(0), photo(1), photo(2)];
  const { initial, data } = openPage(raw);
  const item = data.content.find((c) => c.type === 'gallery');
  check(Array.isArray(item.props.items) && item.props.items.length === 3, `打开之后 items 是列表字段（${item.props.items.length} 张）`);
  // 点 Masonry（整组旋钮写进 options）⟹ 侧栏亮 Masonry；拧 itemShape ⟹ Custom。
  item.props.options = { ...(item.props.options || {}), ...opt.presets.find((p) => p.name === 'Masonry').knobs };
  check(nameOf(item.props) === 'Masonry', `点 Masonry ⟹ 侧栏亮 Masonry（${nameOf(item.props)}）`);
  check(nameOf({ ...item.props, options: { ...item.props.options, itemShape: 'portrait' } }) === 'custom', '拧 itemShape=portrait ⟹ Custom');
  // 增一张、删一张（Puck 列表字段就是改这个数组）、改一张的标题 ⟹ 存盘逐项对得上，每张的 image 原样带着。
  item.props.items.splice(1, 1);
  item.props.items.push(photo(9));
  item.props.items[0].title = 'Renamed job';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const blk = out.blocks.find((b) => b.type === 'gallery');
  check(JSON.stringify(blk.data.items.map((x) => x.title)) === '["Renamed job","Job 2","Job 9"]'
    && blk.data.items.every((x, i) => x.image && x.image.imageUrl === `https://example.com/p${[0, 2, 9][i]}.jpg`),
  `删第 2 张、加第 9 张、改第 1 张标题 ⟹ 存盘 items = ${JSON.stringify(blk.data.items.map((x) => x.title))}，每张的 image 原样`);
  check(blk.data.options.itemShape === 'original' && blk.data.options.itemsLayout === 'grid', '存盘 options 是 Masonry 那组旋钮');
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['gallery']), '只有 gallery 那一块变了', changed.join(' '));
  const re = openPage(out);
  check(firstDiff(out, convert.puckToPage({ raw: out, data: re.data, initial: re.initial, schema, slug: 'home' })) === null, '重开什么都不改再存 ⟹ 往返无损');
}

// ══ ⑦i #1500：testimonials 的 summary 在 Puck 里 —— 能增删平台、改平台名、拧 summaryStyle、点 Ratings 填占位 ═══════
console.log('⑦i testimonials summary 一组平台');
{
  const { presetClickProps, presetNameFor } = require('./lib/block-knobs.js');
  const comp = compOf('testimonials');
  const opt = comp.fields.find((f) => f.control === 'options');
  const sf = comp.fields.find((f) => f.slot === 'summary');
  check(!!sf && sf.control === 'list', `summary 是列表字段（${sf && sf.control}）—— Puck 里能加一个平台 / 删一个平台`);
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  const nameOf = (props) => presetNameFor(man, { ...(props.options || {}), summary: props.summary });
  const raw = fixturePage(false);
  const tb = raw.blocks.find((b) => b.type === 'testimonials');
  check(!!tb && Array.isArray(tb.data.summary) && tb.data.summary.length > 0, `夹具页的 testimonials 带 summary（${tb && Array.isArray(tb.data.summary) && tb.data.summary.length} 个平台）`);
  const { initial, data } = openPage(raw);
  const item = data.content.find((c) => c.type === 'testimonials');
  const n0 = item.props.summary.length;
  check(Array.isArray(item.props.summary) && n0 > 0, `打开之后 summary 是数组（${n0} 项）`);
  // 加一个平台、删掉第一个、改第一个的平台名、拧 summaryStyle=cards。
  item.props.summary = [...item.props.summary.slice(1), { source: 'Facebook', rating: '4.6', count: '19' }];
  item.props.summary[0].source = 'Yelp (Toronto)';
  item.props.options = { ...(item.props.options || {}), summaryStyle: 'cards' };
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const blk = out.blocks.find((b) => b.type === 'testimonials');
  check(blk.data.summary.length === n0 && blk.data.summary[n0 - 1].source === 'Facebook' && blk.data.summary[0].source === 'Yelp (Toronto)' && blk.data.options.summaryStyle === 'cards',
    `存盘 ⟹ summary 删一加一（${blk.data.summary.map((x) => x.source).join(' · ')}）、第一项改名、options.summaryStyle = cards`);
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['testimonials']), '只有 testimonials 那一块变了', changed.join(' '));
  // 点 Ratings：summary 空 ⟹ 用槽上 demo 填上、Ratings 亮；再点 Cards ⟹ 内容还在、Cards 亮。
  const empty = { ...item.props, summary: [] };
  const r = presetClickProps(opt, empty, 'Ratings');
  check(JSON.stringify(r.summary) === JSON.stringify(opt.partDemos.summary) && nameOf(r) === 'Ratings', `空 summary 点 Ratings ⟹ 填上占位、Ratings 亮（${nameOf(r)}）`);
  const c = presetClickProps(opt, r, 'Cards');
  check(nameOf(c) === 'Cards' && JSON.stringify(c.summary) === JSON.stringify(opt.partDemos.summary), '再点 Cards ⟹ Cards 亮、summary 还在');
  item.props = r;
  const out2 = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const b2 = out2.blocks.find((b) => b.type === 'testimonials');
  check(JSON.stringify(b2.data.summary) === JSON.stringify(opt.partDemos.summary) && b2.data.options.summaryStyle === 'cards',
    '存盘 ⟹ data.summary 是占位那一个平台、options 是 Ratings 的旋钮（summaryStyle cards）');
}

// ══ ⑦b 按钮链接（#1404 r3）：每个 link 槽位都有 Link 框；改了才写、不改逐字节不变 ═══════════════════
//    （#1404 时是 6 个；#1496 / #1497 后 8 个；#1425 T3 旧库删掉后只剩 logos.introCta / blog.introCta —— 其余按钮都成了 ctas 列表。
//     #1425（T3）：原来写死「=== 8」钉「没有静默多 / 少」；改成跟 manifest 里**全部** kind=link 槽位数（不看 editLabel）现算相等 ——
//     哪个 link 槽丢了 editLabel、或者编辑器漏派生一个，都对不上。）
console.log('⑦b 按钮链接');
{
  const links = [];
  for (const c of schema.components) for (const f of c.fields) if (f.kind === 'link') links.push(`${c.type}.${f.slot}`);
  const wantLinks = [];
  for (const m of nonRegion) for (const [slot, sp] of Object.entries(m.slots || {})) {
    if (sp.kind === 'link' && sp.editLabel !== undefined) wantLinks.push(`${m.type}.${slot}`);
  }
  let allLinkSlots = 0;
  for (const m of nonRegion) for (const sp of Object.values(m.slots || {})) if (sp && sp.kind === 'link') allLinkSlots += 1;
  if (allLinkSlots === 0) die('manifest 里一个 kind=link 的槽位都没有 —— ⑦b 没有对象可量');
  check(JSON.stringify(links.sort()) === JSON.stringify(wantLinks.sort()) && links.length === allLinkSlots, `link 字段逐个列出（${links.length} = manifest 里 kind=link 槽位数 ${allLinkSlots}）：${links.join(' · ')}`, wantLinks.join(' · '));
  const noHref = [];
  for (const c of schema.components) for (const f of c.fields) {
    if (f.kind === 'link' && !f.subs.some((x) => x.sub === 'href' && x.label === 'Link')) noHref.push(`${c.type}.${f.slot}`);
  }
  check(noHref.length === 0, '每个 link 字段都有显示名为 Link 的 href 子字段', noHref.join(' '));
  // PM 21:58 第 1 点：href 成了可写字段之后，全填满夹具不动就存仍然 deepEqual（href 逐字节不变）
  const raw = fixturePage(false);
  const hrefs = (page) => page.blocks.flatMap((b) => Object.values(b.data || {}).filter((v) => v && typeof v === 'object' && !Array.isArray(v) && 'href' in v).map((v) => v.href));
  check(hrefs(raw).length >= allLinkSlots, `夹具里带 href 的对象 ${hrefs(raw).length} 个（≥ link 槽位数 ${allLinkSlots}，量得到）`); // #1425（T3）：原来写死 ≥ 6
  const back = roundTrip(raw);
  check(convert.deepEqual(back, raw), 'href 是字段之后：不动就存，全页 deepEqual');
  // 只改文字：href 不变；只改链接：label 不变
  const { initial, data } = openPage(raw);
  // #1425（T3）：原来是 cta-banner.button（只改链接）+ hero.ctaPrimary（只改文字）；两个单槽随旧库删了，换成新库仅有的两个 link 槽
  const cta = data.content.find((c) => c.type === 'blog');
  const hero = data.content.find((c) => c.type === 'logos');
  cta.props.introCta.href = '/contact-1404';
  hero.props.introCta.label = 'Text only 1404';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const rc = raw.blocks.find((b) => b.type === 'blog'); const oc = out.blocks.find((b) => b.type === 'blog');
  const rh = raw.blocks.find((b) => b.type === 'logos'); const oh = out.blocks.find((b) => b.type === 'logos');
  check(oc.data.introCta.href === '/contact-1404' && oc.data.introCta.label === rc.data.introCta.label, '只改链接 → href 变、按钮文字不变');
  check(oh.data.introCta.label === 'Text only 1404' && oh.data.introCta.href === rh.data.introCta.href, '只改文字 → href 逐字节不变');
  // 新插一个 hero，填文字和链接 → 落盘（#1425 T3：新 hero 的按钮是 ctas 列表，原来是 ctaPrimary 单槽）
  const { initial: i2, data: d2 } = openPage(raw);
  const heroComp = compOf('hero');
  const props = { id: 'puck-new-hero', ...convert.fieldProps(heroComp, {}), _shape: convert.THEME_DEFAULT };
  props.ctas = [{ label: 'Book', href: '/contact', style: 'solid' }];
  d2.content.push({ type: 'hero', props });
  const nh = convert.puckToPage({ raw, data: d2, initial: i2, schema, slug: 'home' }).blocks.slice(-1)[0];
  check(nh.type === 'hero' && Array.isArray(nh.data.ctas) && nh.data.ctas[0] && nh.data.ctas[0].href === '/contact' && nh.data.ctas[0].label === 'Book', '新插的 hero 填了链接 → 写成 ctas[0] {label, href}', JSON.stringify(nh.data));
  // PM 21:58 第 2 点那一格（共用块里 link 的 href 只读）#1406 起反过来：共用块能改字，link 的两格都能改，
  // 只锁形态；字段值取自块库**文件里**那一份（改动合回的就是它）。
  // #1425（T3）：共用块原来是 cta-banner（随旧库删了），换成 logos（同样带一个单个 link 槽 introCta）
  const siteBlocks = { promo: { type: 'logos', data: { ...catalogLib.sampleDataFor(manifests.get('logos')), introCta: { label: 'Shared 1425', href: '/shared-1425' } }, visibility: ['home'] } };
  const rawS = { slug: 'home', blocks: [{ id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) }, { ref: 'promo' }] };
  const sharedItems = toPuck(rawS, siteBlocks).content.filter((c) => c.props._src.shared);
  const si = sharedItems[0];
  check(sharedItems.length === 1 && si.props._src.locked === false && JSON.stringify(si.readOnly) === JSON.stringify({ _shape: true }),
    '共用块不锁：只有形态只读（introCta.href / introCta.label 都能改）', JSON.stringify(si && si.readOnly));
  check(!!si && JSON.stringify(si.props.introCta) === JSON.stringify(siteBlocks.promo.data.introCta), '共用块的字段值 = 块库文件里那一份', JSON.stringify(si && si.props.introCta));
}

// ══ ⑦c 单个块「恢复主题默认」（#1443）：下拉多一项 Theme default；选它存盘删 shape 键；画布按当前 data 现算 ══
console.log('⑦c 恢复主题默认');
{
  const hasShape = (b) => Object.prototype.hasOwnProperty.call(b, 'shape');
  // 夹具：testimonials 钉着 side-intro、faq 钉着它清单里第二个形态，其余块没有 shape 键（#1425 T3：原来是 three-up / faq-accordion）
  const raw = fixturePage(false);
  const faqShapes = compOf('faq').shapes.map((x) => x.name);
  if (faqShapes.length < 2) die('faq 的下拉不到两项，夹具钉不了第二个形态');
  raw.blocks.find((b) => b.type === 'testimonials').shape = 'side-intro';
  raw.blocks.find((b) => b.type === 'faq').shape = faqShapes[1];
  const { initial, data } = openPage(raw);
  const item = (d, t) => d.content.find((c) => c.type === t);
  check(item(data, 'testimonials').props._shape === 'side-intro' && item(data, 'faq').props._shape === faqShapes[1],
    '打开：钉着形态的块，下拉显示页面 JSON 里那个值');
  const unpinned = data.content.filter((c) => !['testimonials', 'faq'].includes(c.type));
  check(unpinned.length > 0 && unpinned.every((c) => c.props._shape === convert.THEME_DEFAULT),
    `打开：没有 shape 键的块（${unpinned.length}），下拉显示 Theme default（值 = THEME_DEFAULT）`,
    unpinned.filter((c) => c.props._shape !== convert.THEME_DEFAULT).map((c) => `${c.type}=${c.props._shape}`).join(' '));
  check(firstDiff(raw, convert.puckToPage({ raw, data, initial, schema, slug: 'home' })) === null, '钉着形态的页不动 → 往返无损');

  // AC1 + AC2：testimonials 选 Theme default → 存盘那一条没有 shape 键；faq 照旧钉着；其余块逐字节不变
  item(data, 'testimonials').props._shape = convert.THEME_DEFAULT;
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const ot = out.blocks.find((b) => b.type === 'testimonials');
  check(!hasShape(ot), 'AC1：选 Theme default → 存盘后这一块没有 shape 键（不是空串）', JSON.stringify(ot.shape));
  check(out.blocks.find((b) => b.type === 'faq').shape === faqShapes[1], 'AC2：没点它的块，shape 原样保留');
  const others = out.blocks.filter((b, i) => b.type !== 'testimonials' && JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(others.length === 0, 'AC2：除这一块以外，每一块逐字节不变', others.join(' '));
  const { shape: _gone, ...otRest } = raw.blocks.find((b) => b.type === 'testimonials');
  check(JSON.stringify(ot) === JSON.stringify(otRest), '这一块只少了 shape，其余键原样', JSON.stringify(ot));
  // 连存两次：存盘之后 `_src.entry` 不刷新（initial 仍是打开那份），第二次不许把 shape 从底稿带回来
  const out2 = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  check(!hasShape(out2.blocks.find((b) => b.type === 'testimonials')), '连存两次（底稿没刷新）→ 第二次仍没有 shape 键');
  // 恢复之后重开：下拉显示 Theme default，再存一次逐字节不变
  const { initial: i3, data: d3 } = openPage(out);
  check(item(d3, 'testimonials').props._shape === convert.THEME_DEFAULT, '恢复之后重开 → 下拉显示 Theme default');
  check(firstDiff(out, convert.puckToPage({ raw: out, data: d3, initial: i3, schema, slug: 'home' })) === null, '恢复之后重开再存 → 往返无损');
  // 跟着主题的块钉一个形态，再恢复 —— 两步都按当前值判
  const { initial: i4, data: d4 } = openPage(raw);
  const hero = item(d4, 'hero');
  hero.props._shape = compOf('hero').shapes[0].name;
  const pinnedOut = convert.puckToPage({ raw, data: d4, initial: i4, schema, slug: 'home' });
  check(pinnedOut.blocks.find((b) => b.type === 'hero').shape === compOf('hero').shapes[0].name,
    '跟着主题的块在下拉里点名一个形态（哪怕就是默认那个）→ 钉住，写上 shape');
  hero.props._shape = convert.THEME_DEFAULT;
  check(!hasShape(convert.puckToPage({ raw, data: d4, initial: i4, schema, slug: 'home' }).blocks.find((b) => b.type === 'hero')),
    '同一次打开里再选回 Theme default → 不写 shape');
  // 底稿那条的 shape 不是非空串（构建不认的值）：老板没碰就原样不动
  const rawOdd = fixturePage(false);
  rawOdd.blocks[0].shape = '';
  check(firstDiff(rawOdd, roundTrip(rawOdd)) === null && rawOdd.blocks[0].shape === '' && hasShape(roundTrip(rawOdd).blocks[0]),
    '底稿 shape 是空串（构建不认）→ 不动就原样，往返无损');
  // 共用块 / 锁住的块：下拉只读，照旧显示它戴着的那个
  // #1425（T3）：共用块 cta-banner → cta，下面 faq-accordion → faq、text-block → content（旧库删了）
  const siteBlocks = { promo: { type: 'cta', data: catalogLib.sampleDataFor(manifests.get('cta')), visibility: ['home'] } };
  const rawS = { slug: 'home', blocks: [{ id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) }, { ref: 'promo' }] };
  const si = toPuck(rawS, siteBlocks).content.find((c) => c.props._src.shared);
  check(!!si && si.props._shape === si.props._src.shape0 && si.props._shape !== '', '共用块：下拉显示它解析后的形态（只读）', si && si.props._shape);

  // 反向：entryOf 不删键（本票之前那一句）→ AC1 那一格红
  const noDelete = mutantConverter(
    "else if (typeof base.shape === 'string' && base.shape) delete base.shape;",
    '',
  );
  const { initial: im, data: dm } = openPage(raw, {}, noDelete);
  item(dm, 'testimonials').props._shape = noDelete.THEME_DEFAULT;
  const om = noDelete.puckToPage({ raw, data: dm, initial: im, schema, slug: 'home' });
  check(hasShape(om.blocks.find((b) => b.type === 'testimonials')), '反向：entryOf 不删 shape → 同一格判得出「键还在」');
}
{
  // AC3：画布上的形态 = 构建会给的形态（§shapeForBlock），逐主题 × 逐块 × 点名 × data 对拍
  const { shapeForBlock } = require('./lib/block-shape.js');
  const { shapesFor } = require('./themes.js');
  const pool = require('./theme-pool.json');
  const manifestsObj = Object.fromEntries(catalog.manifests);
  const quiet = () => {};
  const problems = [];
  let n = 0;
  const themeIds = Object.keys(pool);
  for (const tid of themeIds) {
    const sel = shapesFor(tid);
    for (const c0 of schema.components) {
      const c = { ...c0, themeShape: typeof sel[c0.type] === 'string' && sel[c0.type] ? sel[c0.type] : null };
      const m = manifests.get(c.type);
      const needSlots = [...new Set((m.shapes || []).flatMap((x) => x.needs || []))];
      const full = catalogLib.sampleDataFor(m);
      const datas = [{}, full];
      // 每个 needs 槽位单独挖空一次：门控正好在这一格上翻
      for (const slot of needSlots) { const d = { ...full }; delete d[slot]; datas.push(d); }
      const pins = ['', ...(m.shapes || []).map((x) => x.name), 'no-such-shape-1443'];
      for (const data of datas) {
        for (const pin of pins) {
          n += 1;
          const want = shapeForBlock({ type: c.type, data, ...(pin ? { shape: pin } : {}) }, sel, manifestsObj, quiet);
          const got = convert.canvasShape(c, pin, data);
          if (got !== want) problems.push(`${tid}/${c.type} pin=${pin || '∅'} data{${Object.keys(data).join(',')}}: 画布 ${got} ≠ 构建 ${want}`);
        }
      }
    }
  }
  check(n > 0 && problems.length === 0, `AC3：画布形态 = 构建形态（${themeIds.length} 套主题 · ${n} 格）`, problems.slice(0, 5).join(' / '));
  // PM 裁定里点名的那一格：原来是 ember-12 / content-split 带图 → media-right-alternate（content-split 随旧库删了）。
  // #1425（T3）：新库里同一种情形 = azure-29 / hero 的主题形态 cover（needs image）：带图 → cover，空 data → 落回。
  //    主题 / 形态名不写死，从主题选择单现取「主题点了一个带 needs 的形态」的那一对；找不到就是夹具前提没了。
  let pickTid = null; let pickType = null;
  for (const tid of themeIds) {
    const s0 = shapesFor(tid);
    const t0 = schema.components.map((c0) => c0.type).find((t) => (manifests.get(t).shapes || []).some((x) => x.name === s0[t] && (x.needs || []).includes('image')));
    if (t0) { pickTid = tid; pickType = t0; break; }
  }
  if (!pickTid) die('主题池里没有一套主题给页面块点了一个 needs image 的形态 —— 这一格的前提没了');
  const sel = shapesFor(pickTid);
  const want0 = sel[pickType];
  const withImg = { image: { imageUrl: '/x.jpg', alt: '' } };
  const cs = { ...compOf(pickType), themeShape: want0 };
  check(convert.canvasShape(cs, '', withImg) === want0,
    `${pickTid} / ${pickType} 带图、跟着主题 → ${want0}`, `${want0} → ${convert.canvasShape(cs, '', withImg)}`);
  check(convert.canvasShape(cs, '', {}) === compOf(pickType).fallbackShape, '同一块去掉图 → 落回 manifest 默认');
  const collapsedShape = shapeForBlock({ type: pickType, data: {} }, sel, manifestsObj, quiet);
  const collapsed = { ...cs, themeShape: collapsedShape };
  check(collapsedShape !== want0 && convert.canvasShape(collapsed, '', withImg) === collapsedShape,
    `反向：拿按空 data 塌缩过的那个（${collapsedShape}）当主题形态 → 带图的 ${pickType} 画成它、不是 ${want0}（判得出）`);
  // 反向：needs 判定拿掉 → 对拍红
  const noNeeds = mutantConverter("if (!sh || !(sh.needs || []).every((slot) => slotFilled(d[slot])))", 'if (!sh)');
  let red = 0;
  for (const tid of themeIds) {
    const s2 = shapesFor(tid);
    for (const c0 of schema.components) {
      const c = { ...c0, themeShape: typeof s2[c0.type] === 'string' && s2[c0.type] ? s2[c0.type] : null };
      if (noNeeds.canvasShape(c, '', {}) !== shapeForBlock({ type: c.type, data: {} }, s2, manifestsObj, quiet)) red += 1;
    }
  }
  check(red > 0, `反向：canvasShape 不看 needs → 对拍红（${red} 格）`);
  // schema 交出来的两格原料
  const fb = schema.components.filter((c) => c.fallbackShape !== manifestLib.defaultShapeOf(manifests.get(c.type)));
  check(fb.length === 0, 'schema 的 fallbackShape = manifest 默认（逐块）', fb.map((c) => c.type).join(' '));
  check(schema.components.every((c) => c.themeShape === null), '没给 rootDir 的 schema：themeShape 全是 null（不猜主题）');
}

// ══ ⑦d 钉着退役形态的块（#1445）：下拉不空白、显示那个名字；不碰就存 → shape 原样 ══════════════════════
console.log('⑦d 钉着退役形态');
{
  // 「钉着一个不在下拉里的形态」：在拷出来的块库里删掉真存在的一个形态子目录（testimonials/ratings），编辑器 schema
  //    从那份派生（= 页面还钉着它、库里已经没有它的样子）；页面归一化 / 构建那一侧照旧读真块库。
  //    #1579 之前这里是「把它标成候选」，候选形态那条线删了。
  const candDir = tmpdir('blocks-retired');
  cp.execSync(`cp -a "${path.join(NEXT, 'blocks')}/." "${candDir}"`);
  dropShape(candDir, 'testimonials', 'ratings');
  const sch2 = editorSchema({ blocksDir: candDir });
  const compOf2 = (t) => sch2.components.find((c) => c.type === t);
  const openPage2 = (raw0, sb = {}, conv = convert) => {
    const pz = toPuck(raw0, sb, conv, sch2);
    return { initial: JSON.parse(JSON.stringify(pz)), data: JSON.parse(JSON.stringify(pz)) };
  };
  const roundTrip2 = (raw0, sb = {}, conv = convert) => {
    const { initial: i0, data: d0 } = openPage2(raw0, sb, conv);
    return conv.puckToPage({ raw: raw0, data: d0, initial: i0, schema: sch2, slug: raw0.slug });
  };
  // 退役对 = 真块库里有、而那份 schema 的下拉里没有的形态（现算，不写死）
  const cands = [];
  for (const c of schema.components) {
    const c2 = compOf2(c.type);
    for (const sh of c.shapes) if (c2 && !c2.shapes.some((x) => x.name === sh.name)) cands.push({ block: c.type, shape: sh.name });
  }
  if (cands.length === 0) die('删掉子目录之后下拉里一项都没少 —— 这一节量不到东西（schema 不读子目录了？）');
  // 下拉框显示的是哪一项：值配上的那一项；配不上时 React 受控 <select> 退到第一项（`Theme default`）——
  // Chromium 里 origin/main 实测 selectedIndex = 0，不是 -1。所以判据是「显示的那一项文字含形态名」，
  // 光看 selectedIndex ≠ -1 在改之前也成立。
  const selectedIndex = (options, value) => options.findIndex((o) => o.value === value);
  const shownLabel = (options, value) => { const at = selectedIndex(options, value); return options[at === -1 ? 0 : at].label; };
  let blank = 0; let lossy = 0; let unlabeled = 0;
  for (const p of cands) {
    const raw = fixturePage(false);
    raw.blocks.find((b) => b.type === p.block).shape = p.shape;
    const { data } = openPage2(raw);
    const it = data.content.find((c) => c.type === p.block);
    const options = convert.shapeOptions(compOf2(p.block), it.props._shape);
    const shown = shownLabel(options, it.props._shape);
    if (it.props._shape !== p.shape || selectedIndex(options, it.props._shape) === -1 || !shown.includes(p.shape)) blank += 1;
    else if (!/retired/.test(shown)) unlabeled += 1;
    if (firstDiff(raw, roundTrip2(raw)) !== null) lossy += 1;
  }
  check(blank === 0, `AC1：${cands.length} 对退役形态逐个钉上 → 下拉配得上一项（selectedIndex ≠ -1），显示的文字含形态名`, `${blank} 对显示错`);
  check(unlabeled === 0, 'AC1：那一项的文字含形态名、标着 retired', `${unlabeled} 对没标`);
  check(lossy === 0, `AC2：${cands.length} 对都不碰直接存 → 整页逐字节无损（shape 原样）`, `${lossy} 对有损`);

  // 那一项只跟着当前值出现：清单里的形态 / Theme default 不多出任何一项；选了别的，它就不在了（不可再选）
  const p0 = cands[0];
  const c0 = compOf2(p0.block);
  const base = convert.shapeOptions(c0, convert.THEME_DEFAULT);
  check(base.length === c0.shapes.length + 1 && base[0].value === convert.THEME_DEFAULT, 'Theme default → 选项 = Theme default + 清单，不多一项');
  check(convert.shapeOptions(c0, c0.shapes[0].name).length === base.length, '钉着清单里的形态 → 不多一项');
  const raw = fixturePage(false);
  raw.blocks.find((b) => b.type === p0.block).shape = p0.shape;
  const { initial, data } = openPage2(raw);
  const it = data.content.find((c) => c.type === p0.block);
  it.props._shape = c0.shapes[0].name;
  check(!convert.shapeOptions(c0, it.props._shape).some((o) => o.value === p0.shape), `选了别的（${c0.shapes[0].name}）→ ${p0.shape} 不再是选项`);
  const out = convert.puckToPage({ raw, data, initial, schema: sch2, slug: 'home' });
  check(out.blocks.find((b) => b.type === p0.block).shape === c0.shapes[0].name, '选了别的存盘 → 覆盖成新形态');

  // 反向 ①：下拉不补那一项（#1443 原样）→ AC1 那一格红
  const noRetired = mutantConverter("    options.push({ value: current, label: `${current} (retired)` });", '');
  const { data: dn } = openPage2(raw, {}, noRetired);
  const itn = dn.content.find((c) => c.type === p0.block);
  const nOpts = noRetired.shapeOptions(c0, itn.props._shape);
  check(selectedIndex(nOpts, itn.props._shape) === -1 && shownLabel(nOpts, itn.props._shape) === 'Theme default',
    '反向：不补那一项 → 配不上，框里退成 Theme default（形态名看不见）', shownLabel(nOpts, itn.props._shape));
  // 反向 ②：把它做成可选中的 Theme default（打开时退役的值换成 THEME_DEFAULT）→ 存盘丢掉 shape，AC2 那一格红
  const toDefault = mutantConverter(
    "const pinned = entry && typeof entry.shape === 'string' && entry.shape ? entry.shape : THEME_DEFAULT;",
    "const pinned = entry && typeof entry.shape === 'string' && entry.shape && (component.shapes || []).some((s) => s.name === entry.shape) ? entry.shape : THEME_DEFAULT;",
  );
  check(firstDiff(raw, roundTrip2(raw, {}, toDefault)) !== null, '反向：退役形态显示成 Theme default → 不碰就存也丢了 shape（往返有损）');
}

// ══ ⑦g #1502：page-header 在 Puck 里 —— 能拖、能改标题、面包屑不是字段（只显示不能改）、点预设 / 拧旋钮显示 Custom ═══
console.log('⑦g page-header');
{
  const { presetClickProps, presetNameFor } = require('./lib/block-knobs.js');
  const comp = compOf('page-header');
  check(!!comp, 'page-header 在组件清单里（左栏能拖）');
  const slots = comp.fields.map((f) => f.slot);
  check(!slots.includes('breadcrumbs'), `侧栏字段里没有 breadcrumbs（面包屑按页面路径算，画布上只显示；字段 ${slots.join(' / ')}）`);
  const opt = comp.fields.find((f) => f.control === 'options');
  const man = { slots: { options: { knobs: opt.knobs } }, presets: opt.presets };
  const nameOf = (props) => presetNameFor(man, props.options || {});
  const raw = fixturePage(false);
  const { initial, data } = openPage(raw);
  const item = data.content.find((c) => c.type === 'page-header');
  check(!!item && typeof item.props.headline === 'string', '打开之后 headline 是文字字段');
  item.props = presetClickProps(opt, item.props, 'Split');
  check(nameOf(item.props) === 'Split', `点 Split ⟹ 侧栏亮 Split（${nameOf(item.props)}）`);
  check(nameOf({ ...item.props, options: { ...item.props.options, image: 'left' } }) === 'custom', '拧 image=left ⟹ Custom');
  item.props.headline = 'Renamed page title';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  const blk = out.blocks.find((b) => b.type === 'page-header');
  check(blk.data.headline === 'Renamed page title' && blk.data.options.headlinePosition === 'left' && !('breadcrumbs' in blk.data),
    '存盘 ⟹ headline 改了、options 是 Split 的旋钮、data 里没有 breadcrumbs');
  const changed = out.blocks.filter((b, i) => JSON.stringify(b) !== JSON.stringify(raw.blocks[i])).map((b) => b.type);
  check(JSON.stringify(changed) === JSON.stringify(['page-header']), '只有 page-header 那一块变了', changed.join(' '));
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
  d2.content.splice(1, 0, { type: 'faq', props: { id: 'puck-new-1', ...convert.fieldProps(compOf('faq'), {}), headline: 'New FAQ', _shape: convert.THEME_DEFAULT } });
  const dup = JSON.parse(JSON.stringify(d2.content[0])); dup.props.id = 'puck-dup-1';
  d2.content.splice(1, 0, dup);
  const out2 = convert.puckToPage({ raw, data: d2, initial: i2, schema, slug: 'home' });
  const ids = out2.blocks.map((b) => b.id);
  check(!ids.includes(removed.props.id), '删掉的块不在了');
  check(new Set(ids).size === ids.length, 'id 一页之内唯一（新块 / 复制品各有新 id）', ids.join(' '));
  const added = out2.blocks.find((b) => b.type === 'faq' && b.data && b.data.headline === 'New FAQ');
  check(!!added && added.shape === undefined, '插入的块落盘（没改形态就不写 shape）');
  const d5 = JSON.parse(JSON.stringify(i2));
  d5.content.push({ type: 'gallery', props: { id: 'puck-new-empty', ...convert.fieldProps(compOf('gallery'), {}), _shape: convert.THEME_DEFAULT } });
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
    promo: { type: 'cta', data: catalogLib.sampleDataFor(manifests.get('cta')), visibility: ['home'], weight: 15 },
    faq: { type: 'faq', data: catalogLib.sampleDataFor(manifests.get('faq')), visibility: [] },
  };
  const raw = {
    slug: 'home',
    blocks: [
      { id: 'home-hero-0', type: 'hero', data: catalogLib.sampleDataFor(manifests.get('hero')) },
      { id: 'home-content-1', type: 'content', data: catalogLib.sampleDataFor(manifests.get('content')) },
      { ref: 'faq' },
      { id: 'home-gallery-3', type: 'gallery', data: catalogLib.sampleDataFor(manifests.get('gallery')) },
    ],
  };
  const { initial, data } = openPage(raw, siteBlocks);
  const canvas0 = data.content.map((c) => c.props.id);
  check(JSON.stringify(canvas0) === JSON.stringify(['home-hero-0', 'home-content-1', 'promo', 'faq', 'home-gallery-3']), '画布顺序 = 构建顺序（promo 按 weight 15 插在中间）', canvas0.join(' '));
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
    input: JSON.stringify({ siteId: 'rttest01', siteUrl: 'https://rttest01.example.com', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' }),
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
  {
    // #1443 —— schema 的 themeShape = 这个站穿的那套主题的选择单（没按 data 塌缩）
    const { structureThemeId } = require('./lib/site-regions.js').resolveSiteRegionLayout(path.join(work, 'site'));
    const sel = structureThemeId ? require('./themes.js').shapesFor(structureThemeId) : {};
    const off = siteSchema.components.filter((c) => c.themeShape !== (typeof sel[c.type] === 'string' && sel[c.type] ? sel[c.type] : null));
    check(!!structureThemeId && Object.keys(sel).length > 0 && off.length === 0,
      `${flat ? '扁平' : '多语言'}站：schema 的 themeShape = 主题 ${structureThemeId} 的选择单（逐块）`, off.map((c) => `${c.type}=${c.themeShape}`).join(' '));
  }
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

// ══ #1497 AC12：blog 的 postCount 在 Puck 里是一格下拉（2–6），改了写回、没改不写 ═════════════════════
console.log('\n#1497 blog.postCount');
{
  const f = compOf('blog').fields.find((x) => x.slot === 'postCount');
  check(!!f && f.control === 'int' && JSON.stringify(f.values) === JSON.stringify(['2', '3', '4', '5', '6']),
    `blog.postCount 是 int 控件、取值 2–6（读到 ${f && f.control} / ${f && JSON.stringify(f.values)}）`);
  check(!manifestLib.editableSlotPaths(manifests.get('blog')).some((e) => e.slot === 'postCount'),
    'postCount 不在 editableSlotPaths 里（不是页面上的字 ⟹ 检查器面板不给它输入框、data-slot 守卫不要求它）');
  const raw = { slug: 'home', title: 'T', blocks: [{ id: 'home-blog-0', type: 'blog', data: { headline: 'H' } }] };
  const same = roundTrip(raw);
  check(!('postCount' in same.blocks[0].data), '没改 ⟹ 不凭空写一个 postCount 键');
  const { initial, data } = openPage(raw);
  const c = data.content.find((x) => x.type === 'blog');
  c.props.postCount = '5';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  check(out.blocks[0].data.postCount === '5' && out.blocks[0].data.headline === 'H', '改成 5 ⟹ 写回 "5"，headline 原样');
}
// ══ #1498 richtext：content.body 是多行文本框，那段 markdown 原样进出；改了就只改它 ═══════════════
console.log('\n#1498 richtext 槽');
{
  const f = compOf('content').fields.find((x) => x.slot === 'body');
  check(!!f && f.control === 'richtext' && f.kind === 'richtext', `content.body 是 richtext 控件（读到 ${f && f.control}）`);
  const body = '第一段\n\n- a\n- b\n\n**粗** 和 [链接](/about)';
  const raw = { slug: 'home', title: 'T', blocks: [{ id: 'home-content-0', type: 'content', data: { headline: 'H', body } }] };
  const same = roundTrip(raw);
  check(same.blocks[0].data.body === body, '没改 ⟹ body 逐字节原样存回（换行、- 、** 一个都不丢）');
  const { initial, data } = openPage(raw);
  const c = data.content.find((x) => x.type === 'content');
  check(c.props.body === body, 'Puck 里拿到的 prop 就是那段 markdown 原文');
  c.props.body = `${body}\n\n1. one\n2. two`;
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  check(out.blocks[0].data.body === `${body}\n\n1. one\n2. two` && out.blocks[0].data.headline === 'H', '改了 ⟹ 写回新的那段，headline 原样');
}

// ══ #1518：按钮列表（`ctas` / `introCtas`）每一项有 Link 格 —— 按项形状派生，不写块名单 ═══════════════
console.log('\n#1518 按钮列表的 Link 格');
{
  const subsOf = (type, slot) => {
    const f = compOf(type).fields.find((x) => x.slot === slot);
    return f ? f.subs.map((x) => `${x.sub}:${x.label}`) : null;
  };
  // AC1：哪几个列表槽有 Link 格 —— 钉死成一张表（反向：main 上除 contact.items 外是 0 个）
  const listWithLink = [];
  for (const c of schema.components) for (const f of c.fields) {
    if (f.kind === 'list' && f.subs.some((x) => x.sub === 'href' && x.label === 'Link')) listWithLink.push(`${c.type}.${f.slot}`);
  }
  const want = ['contact.items', 'content.ctas', 'cta.ctas', 'features.introCtas', 'hero.ctas', 'milestones.introCtas', 'page-header.ctas'];
  check(JSON.stringify(listWithLink.sort()) === JSON.stringify(want), `有 Link 格的列表槽 = 六个按钮列表 + contact.items（${listWithLink.length}）`, listWithLink.join(' · '));
  for (const k of want.slice(1)) {
    const [type, slot] = k.split('.');
    check(JSON.stringify(subsOf(type, slot)) === JSON.stringify(['label:Button text', 'href:Link']), `${k} 的子字段 = Button text + Link（顺序）`, JSON.stringify(subsOf(type, slot)));
  }
  // AC2：不误伤 —— 三个本来就有 Link 格的槽逐项不变（不重复、顺序不变）
  check(JSON.stringify(subsOf('contact', 'items')) === JSON.stringify(['title:Title', 'hint:Hint', 'kind:Kind', 'href:Link']), 'contact.items 逐项不变', JSON.stringify(subsOf('contact', 'items')));
  check(JSON.stringify(subsOf('blog', 'introCta')) === JSON.stringify(['label:Button text', 'href:Link']), 'blog.introCta 逐项不变', JSON.stringify(subsOf('blog', 'introCta')));
  check(JSON.stringify(subsOf('logos', 'introCta')) === JSON.stringify(['label:Link text', 'href:Link']), 'logos.introCta 逐项不变', JSON.stringify(subsOf('logos', 'introCta')));
  // AC3：反向对照 —— 项形状里没有【顶层必填】href 的列表槽不长 Link 格
  //   testimonials.items 根本没有 href · features.items 的 href 在嵌套的 link? 里 · logos.items 是可选的 href?
  //   team.members 的 href 在项里再套一层的 links? 列表里
  //   📌 #1425（T3）—— 原来还有一臂 page-header.breadcrumbs（两项示例 `[{…}, {…}]`，不是项形状）；新 page-header 没有
  //      breadcrumbs 槽（面包屑按页面路径算），新库里也没有别的「示例写法」的列表槽，这一类反向臂今天没有对象。
  for (const [type, slot] of [['testimonials', 'items'], ['features', 'items'], ['logos', 'items'], ['team', 'members']]) {
    const got = subsOf(type, slot);
    check(Array.isArray(got) && !got.some((x) => x.startsWith('href:')), `${type}.${slot} 没有 Link 格`, JSON.stringify(got));
  }
  // 解析器本身：顶层、必填、单个对象
  const cases = [
    ['[{label, href, style: "solid" | "outline" | "link", icon?, arrow?, size?}]', ['label', 'href', 'style']],
    ['[{imageUrl, alt, href?}]', ['imageUrl', 'alt']],
    ['[{title, link?: {label, href, style?: "solid"}}]', ['title']],
    ['[{label:"Home", href:"/"}, {label:"<Page Name>"}]', []],
    ['[string]', []],
    [undefined, []],
  ];
  for (const [shape, keys] of cases) {
    check(JSON.stringify(itemTopKeys(shape)) === JSON.stringify(keys), `itemTopKeys(${JSON.stringify(shape)}) = ${JSON.stringify(keys)}`, JSON.stringify(itemTopKeys(shape)));
  }
  // 往返：不动就存 deepEqual；只改链接 ⟹ label / style 逐字节不变；新插一个 hero 填 /contact ⟹ 落盘
  const ctas = [{ label: 'Call', href: '/quote', style: 'solid', icon: 'telephone' }, { label: 'More', href: '/about', style: 'outline' }];
  const raw = { slug: 'home', title: 'T', blocks: [{ id: 'home-hero-0', type: 'hero', data: { headline: 'H', ctas } }] };
  check(convert.deepEqual(roundTrip(raw), raw), 'hero 带两个按钮：不动就存，deepEqual');
  const { initial, data } = openPage(raw);
  const c = data.content.find((x) => x.type === 'hero');
  c.props.ctas[1].href = '/contact';
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  check(JSON.stringify(out.blocks[0].data.ctas) === JSON.stringify([ctas[0], { ...ctas[1], href: '/contact' }]),
    '只改第二个按钮的链接 ⟹ 它的 href 变、label / style 不变，第一个逐字节不变', JSON.stringify(out.blocks[0].data.ctas));
  const { initial: i2, data: d2 } = openPage(raw);
  const props = { id: 'puck-new-hero', ...convert.fieldProps(compOf('hero'), {}), _shape: convert.THEME_DEFAULT };
  props.headline = 'New';
  props.ctas = [{ label: 'Book', href: '/contact' }];
  d2.content.push({ type: 'hero', props });
  const nh = convert.puckToPage({ raw, data: d2, initial: i2, schema, slug: 'home' }).blocks.slice(-1)[0];
  check(nh.type === 'hero' && Array.isArray(nh.data.ctas) && nh.data.ctas[0].href === '/contact' && nh.data.ctas[0].label === 'Book',
    '新插的 hero 填了链接 → 写成 ctas[0] {label, href}', JSON.stringify(nh.data));
}

// ══ #1521：按钮列表的 Link 格也能选「本店电话 / 本店邮箱」—— 跟 kind=link 那格同一份 BUTTON_SOURCES ═══════════
console.log('\n#1521 按钮列表的 Link 格带 sources');
{
  const { BUTTON_SOURCES } = require('./lib/item-sources.js');
  const { linkRejection } = require('./lib/link-href.js');
  const hrefSources = {};
  for (const c of schema.components) for (const f of c.fields) for (const x of f.subs || []) {
    if (x.sub === 'href') hrefSources[`${c.type}.${f.slot}`] = x.sources || null;
  }
  const withSources = Object.keys(hrefSources).filter((k) => hrefSources[k]).sort();
  // AC1 + AC2：带 sources 的 = 今天 kind=link 那几格 + 六个按钮列表；每格都是 BUTTON_SOURCES 那份
  // #1425（T3）：kind=link 原来 8 格（announcement-bar.link / cta-banner.button / hero.ctaPrimary·ctaSecondary / hero-with-form 两格随旧库删了），
  //    今天只剩 blog.introCta / logos.introCta。
  const want = ['blog.introCta', 'content.ctas', 'cta.ctas', 'features.introCtas',
    'hero.ctas', 'logos.introCta', 'milestones.introCtas', 'page-header.ctas'].sort();
  check(JSON.stringify(withSources) === JSON.stringify(want), `带 sources 的 href 格 = 2 格 kind=link + 6 个按钮列表（${withSources.length}）`, withSources.join(' · '));
  check(withSources.every((k) => JSON.stringify(hrefSources[k]) === JSON.stringify(BUTTON_SOURCES)), '每格的 sources 都等于 BUTTON_SOURCES', JSON.stringify(hrefSources));
  // 反向：contact.items 的 Link 格（itemNeeds 补的、项没有 label、不是按钮）不长 sources
  check('contact.items' in hrefSources && hrefSources['contact.items'] === null, 'contact.items 有 Link 格但没有 sources', JSON.stringify(hrefSources['contact.items']));
  // 往返：按钮写成引用 ⟹ 不动就存 deepEqual；在编辑器里把第二个按钮换成「本店电话」⟹ 存成 {source: "phone"}，其余逐字节不变
  const ctas = [{ label: 'Email us', href: { source: 'email' }, style: 'solid' }, { label: 'More', href: '/about', style: 'outline' }];
  const raw = { slug: 'home', title: 'T', blocks: [{ id: 'home-hero-0', type: 'hero', data: { headline: 'H', ctas } }] };
  check(convert.deepEqual(roundTrip(raw), raw), 'hero 带一个引用按钮：不动就存，deepEqual');
  const { initial, data } = openPage(raw);
  const c = data.content.find((x) => x.type === 'hero');
  check(JSON.stringify(c.props.ctas[0].href) === JSON.stringify({ source: 'email' }), '打开时那一格拿到的是引用对象（下拉据它选中）', JSON.stringify(c.props.ctas[0].href));
  c.props.ctas[1].href = { source: 'phone' };
  const out = convert.puckToPage({ raw, data, initial, schema, slug: 'home' });
  check(JSON.stringify(out.blocks[0].data.ctas) === JSON.stringify([ctas[0], { ...ctas[1], href: { source: 'phone' } }]),
    '选「本店电话」⟹ 存成 {source:"phone"}，label / style 不变，第一个逐字节不变', JSON.stringify(out.blocks[0].data.ctas));
  // 存盘那道链接判据（lib/link-href.js）对这种形状照旧放行 —— 三种写入种类都问一遍。
  // 📌 放行的原因要说实话：它今天只读 `kind: link` 槽的字符串 `href`，列表项的 `href` 根本不在它射程里（#1521 交接里报给了 PM）。
  //    这几条钉的是「存盘不被拒」这个结果，不是「判据认过这个形状」。
  for (const kind of ['page', 'any']) {
    check(linkRejection(kind, out, raw) === null, `linkRejection('${kind}') 对引用按钮放行`, String(linkRejection(kind, out, raw)));
  }
  const sb = { promo: { type: 'cta', data: { headline: 'x', ctas: [{ label: 'Call', href: { source: 'phone' } }] } } };
  check(linkRejection('site-blocks', sb, null) === null, "linkRejection('site-blocks') 对引用按钮放行");
}

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail > 0 ? 1 : 0);
