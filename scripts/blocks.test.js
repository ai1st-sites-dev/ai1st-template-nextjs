#!/usr/bin/env node
/**
 * blocks.test.js — 页面块读进来那一层（`scripts/blocks.js`）的承重性质。
 *
 * 跑法:  node scripts/blocks.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 📌 #1425（T3）—— 这个文件原来的主体是「老块名 → 通用块的别名」（#1132 / #1143 / #1162）：
 *    `block-aliases.json`、`GENERIC_TYPES`、`normalizeGenericItems`。别名层随旧库整层删了
 *    （`card-group` 没了，继任是 `features`），那几格跟着删，原位各留一行 📌。今天这里守的是：
 *    别名层不许回来（③）· 列表槽兜底真的接在构建那条路上（④，含票正文要求的两条臂）·
 *    老 type 名不被悄悄改名（⑦）· 全部块的列表槽兜底（⑨）· #1341 残留键 · #1349 块 id · #1350 ref 上的 shape。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let blocks;
try {
  blocks = require(path.join(NEXT, 'scripts', 'blocks.js'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const { normalizeLocalePages } = blocks;

// 📌 #1425（T3）—— 这里原来是别名表的分母自检（通用块自己那一行在 · 真别名 0 条）；别名表随旧库删了。
// 📌 #1425（T3）—— 这里原来是 ①「别名表每一行写齐 type/role/data/itemTag/headingId/parts」；别名表随旧库删了。
// 📌 #1425（T3）—— 这里原来是 ②「词汇的每个部件都是 theme-css-lint 契约里的钩子（两向）」；词汇（card-group）随旧库删了。

// ── ③ 别名层不许回来 ────────────────────────────────────────────────────────────────────────────
// 🔴 #1425（T3）—— 原来这一格是「normalizeGenericItems 不再改任何东西的名字 + 四个老 type 名四处都不在」。
//    `normalizeGenericItems` 本身删了，所以要钉的性质换成「那一整层不在了」：文件、导出、一个都不许回来。
//    四个老名字（values-grid / benefits-list / checklist / service-highlights）加上 card-group 自己，在
//    registry / block-roles / blocks manifest 三处逐个查（不抽样）。
{
  const where = [];
  for (const f of ['src/lib/sections/block-aliases.json', 'src/lib/sections/blockAliases.ts']) {
    if (fs.existsSync(path.join(NEXT, f))) where.push(f);
  }
  for (const k of ['BLOCK_ALIASES', 'GENERIC_TYPES', 'normalizeGenericItems']) {
    if (Object.prototype.hasOwnProperty.call(blocks, k)) where.push(`blocks.js 导出 ${k}`);
  }
  const OLD = ['card-group', 'values-grid', 'benefits-list', 'checklist', 'service-highlights'];
  const reg = fs.readFileSync(path.join(NEXT, 'src/lib/sections/registry.generated.ts'), 'utf8');
  const regKeys = new Set([...reg.matchAll(/^ {2}'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  const roleKeys = new Set(Object.keys(require(path.join(NEXT, 'src/lib/sections/block-roles.json'))));
  // 分母自检：尺子（那条正则）在今天的 registry 上一个键都抠不出来的话，「不在」是恒真的
  if (regKeys.size < 10) die(`从 registry.generated.ts 只抠出 ${regKeys.size} 个键 —— 尺子坏了`);
  for (const n of OLD) {
    if (regKeys.has(n)) where.push(`registry.ts:${n}`);
    if (roleKeys.has(n)) where.push(`block-roles.json:${n}`);
    if (fs.existsSync(path.join(NEXT, 'blocks', n, 'manifest.json'))) where.push(`blocks/${n}/`);
  }
  if (where.length) bad(`别名层（或它服务的老名字）还在: ${where.join(' · ')}`);
  else ok(`别名层不在了：两个文件 · 三个导出 · ${OLD.length} 个老名字在 registry（${regKeys.size} 键）/ block-roles / blocks 三处都不在`);
}

// ── ④ 列表槽兜底真的接在构建那条路上（两种页面形状各一次）+ 票正文的两条臂 ────────────────────
// 🔴 抽出来的函数好使 ≠ 它被接线了。#1425（T3）之前这一格喂的是 `card-group` 的裸串（判「升成 [{title}]」）；
//    那一步随别名层删了，判据换成今天这条路上唯一还会动东西的一步：`normalizeListSlots` 把 `null` 滤掉。
//    🔴 别拿 `type` 当判据 —— 两头都是 features，那样恒绿。
for (const [shapeName, page] of [
  ['sections（老形状）', { slug: 'about', sections: [{ type: 'features', data: { headline: 'H', items: [{ title: '甲' }, null] } }] }],
  ['blocks（新形状）', { slug: 'about', blocks: [{ id: 'x', type: 'features', data: { headline: 'H', items: [{ title: '甲' }, null] } }] }],
]) {
  let out;
  try {
    out = normalizeLocalePages([page], {}, 'en', {});
  } catch (e) {
    bad(`${shapeName}: normalizeLocalePages 抛了 ${e.message}`);
    continue;
  }
  const b = out[0].blocks[0];
  if (b.type !== 'features') bad(`${shapeName}: type 被动过了（${b.type}）`);
  else if (JSON.stringify(b.data.items) !== JSON.stringify([{ title: '甲' }])) {
    bad(`${shapeName}: 兜底没发生在这条路上（items=${JSON.stringify(b.data.items)}）⟹ 接线断了`);
  } else ok(`${shapeName}: 兜底真的在构建那条路上发生了（[{甲}, null] → [{甲}]）`);
}

// 🔴 #1425（T3）票正文要求的两条臂：别名层删了之后，往 `features` 喂坏 items，**站照常建出来**。
//    走真路径：`normalizeLocalePages`（构建期读页面那一层）→ 把解出来的块交给 `blocks/features/Section.tsx`
//    用 react-dom/server 真渲染一次。判据 =「不抛 + 块真画出来了（<section>）」，再数画出来几项。
//    只做 ① 不算：② 是 PM 2026-10-02 裁定接受的**行为变化**，要把新行为钉住。
console.log('\n── ④b #1425 往 features 喂坏 items ⟹ 站照常建出来');
{
  const ts = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const STUB_DIR = fs.mkdtempSync(path.join(NEXT, 'scripts', '.blocks-test-stubs-'));
  process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
  const linkStub = path.join(STUB_DIR, 'link.js');
  fs.writeFileSync(linkStub, "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n");
  for (const ext of ['.tsx', '.ts']) {
    require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
      fileName: filename,
    }).outputText, filename);
  }
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function resolve(req, ...rest) {
    if (req === 'next/link') return linkStub;
    if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
    return origResolve.call(this, req, ...rest);
  };
  let Features;
  try { Features = require(path.join(NEXT, 'blocks', 'features', 'Section.tsx')).default; } catch (e) { die(`载入 features/Section.tsx 失败: ${e.message}`); }

  // 一条臂 = 页面 JSON 进 → 构建那一层 → 真渲染。返回 { html, items(构建后), err }
  const build = (items) => {
    try {
      const page = { slug: 'home', blocks: [{ id: 'f', type: 'features', data: { headline: '块头标题', items } }] };
      const b = normalizeLocalePages([page], {}, 'en', {})[0].blocks[0];
      const html = renderToStaticMarkup(React.createElement(Features, { data: b.data, locale: 'en', iconTable: {}, block: b }));
      return { html, items: b.data.items, err: null };
    } catch (e) { return { html: '', items: null, err: e }; }
  };
  const nItems = (html) => html.split('data-part="item"').length - 1;

  // 阳性对照（尺子没坏）：良构的两项真的画出两项、文字在产物里。没有它，下面「0 项」那条判据恒真。
  const good = build([{ title: '甲' }, { title: '乙' }]);
  if (good.err) bad(`阳性对照: 良构 items 就抛了 ${good.err.message}`);
  else if (nItems(good.html) !== 2 || !good.html.includes('甲')) bad(`阳性对照: 良构两项没画成两项（数到 ${nItems(good.html)}）—— 尺子坏了`);
  else ok('阳性对照: 良构 [{甲},{乙}] ⟹ 画出 2 项、文字在产物里（data-part="item" 这把尺子量得到东西）');

  // ① 含 null ⟹ 不抛、块照常画出来，null 那一项不在
  const withNull = build([{ title: '甲' }, null, { title: '乙' }]);
  if (withNull.err) bad(`① 含 null 的 items 让构建/渲染抛了: ${withNull.err.message}`);
  else if (!/<section/.test(withNull.html) || !withNull.html.includes('块头标题')) bad('① 含 null：没抛，但块（或块头）没画出来');
  else if (nItems(withNull.html) !== 2) bad(`① 含 null：应画出 2 项，数到 ${nItems(withNull.html)}`);
  else ok(`① 含 null 的 items ⟹ 站照常建出来（不抛），null 在构建那一层就被滤掉（${JSON.stringify(withNull.items)}），画出 2 项`);

  // ② 裸字符串 ⟹ 不抛、块照常画出来，那几项**不渲染**（#1425 起的新行为，PM 2026-10-02 裁定接受）。
  //    📌 记下它落在哪一层：构建那一层（normalizeListSlots 的 drawableItem）**放行**字符串，是组件自己的
  //    `filter(isObj)` 把它们滤掉 —— 别名层在的时候这一步是「升成 {title} 画出来」。
  const bare = build(['甲', '乙']);
  if (bare.err) bad(`② 裸字符串 items 让构建/渲染抛了: ${bare.err.message}`);
  else if (!/<section/.test(bare.html) || !bare.html.includes('块头标题')) bad('② 裸字符串：没抛，但块（或块头）没画出来');
  else if (nItems(bare.html) !== 0 || bare.html.includes('甲') || bare.html.includes('乙')) {
    bad(`② 裸字符串：那几项应该不渲染，数到 ${nItems(bare.html)} 项（行为变了的话要回去问 PM）`);
  } else if (JSON.stringify(bare.items) !== '["甲","乙"]') {
    bad(`② 裸字符串：构建那一层的读数变了（${JSON.stringify(bare.items)}）—— 上面那句「落在组件那一层」不再成立`);
  } else ok('② 裸字符串 ["甲","乙"] ⟹ 站照常建出来（不抛、块头照画），那两项不渲染；构建那一层原样放行，是组件的 filter(isObj) 滤掉的');
}

// ── ⑦ #1162：老 type 名走到底会怎样 —— 不改名、不静默接上别的槽位 ────────────────────────────
// 🔴 这一格是 AC5 的机械版：磁盘上写着老 type 名的页面**不会**被改名；它一路走到 `SectionRenderer`，
//    命中未知类型那一支，那个块在页面上不出现。这里钉住「构建那一侧不许悄悄替它做点什么」。
//    #1425（T3）：原来问的是 `normalizeGenericItems` 这一个函数；它删了，改问构建那条真路
//    （`normalizeLocalePages`），并且 `card-group` 自己今天也是老名字了，两个一起问。
{
  for (const [t, data] of [
    ['service-highlights', { headline: 'H', highlights: [{ title: 't' }] }],
    ['card-group', { headline: 'H', items: ['裸串'] }],
  ]) {
    const page = { slug: 'about', blocks: [{ id: 'x', type: t, data: JSON.parse(JSON.stringify(data)) }] };
    const b = normalizeLocalePages([page], {}, 'en', {})[0].blocks[0];
    if (b.type !== t) bad(`老 type 名 ${t} 被改名了（变成 ${b.type}）`);
    else if (JSON.stringify(b.data) !== JSON.stringify(data)) bad(`老 type 名 ${t} 的 data 被动过了: ${JSON.stringify(b.data)}`);
    else ok(`老 type 名 ${t} 原样留着、data 一个字节没动 ⟹ 它走 SectionRenderer 的未知类型那一支（AC5）`);
  }
  // 📌 #1425（T3）—— 这里原来还查 `blocks/card-group/manifest.json` 的槽位（AC3/AC4）；card-group 随旧库删了。
}

// 📌 #1425（T3）—— 这里原来是 ⑥「`[string]` 升成 `[{title}]`」+ 它的同引用反向对照；`normalizeGenericItems` 随别名层删了。
//    裸字符串今天的下场由上面 ④b 的 ② 那条臂钉住。
// 📌 #1425（T3）—— 这里原来是 ⑤「把升格那一步拿掉，第 ⑥ 格必须红」的反向对照；被对照的那一步随别名层删了。
// 📌 #1425（T3）—— 这里原来是 ⑧（#1152）「normalizeGenericItems 滤掉 null / 数字 / 布尔 / 嵌套数组 + 逐个喂 GENERIC_TYPES」；
//    那个函数和 `GENERIC_TYPES` 随别名层删了。滤画不出来的条目今天只剩 ⑨ 那一层（管全部块），四种坏元素挪到那里逐个喂。

// ── ⑨ #1154：所有块的列表槽兜底（不只是一个块，也不只是叫 items 的槽）────────────────────────
//
// 🔴 这一格守的是 `normalizeListSlots`：判据按 manifest 的 `kind: "list"`。
//    #1425（T3）：通用块那一层没了，分母从「不归通用块管的」变成「全部带列表槽的块」。
console.log('── ⑨ #1154 所有块的列表槽兜底');
{
  const { normalizeListSlots } = blocks;
  if (typeof normalizeListSlots !== 'function') die('blocks.js 没导出 normalizeListSlots');

  // 分母先说出来：本仓今天有多少个块带列表槽。很少的话下面每一格都是「全过」，而那什么都没查。
  const manifests = blocks.loadBlockManifests(NEXT);
  const listSlots = Object.entries(manifests)
    .map(([t, m]) => [t, Object.entries((m && m.slots) || {}).filter(([, sp]) => sp && sp.kind === 'list').map(([k]) => k)])
    .filter(([, slots]) => slots.length);
  console.log(`     带列表槽的块 ${listSlots.length} 个`);
  if (listSlots.length < 3) {
    bad(`带列表槽的块只数出 ${listSlots.length} 个 —— 分母不对，下面的读数不作数`);
  }

  // 逐个喂一个 null，一个都不许漏过去（不抽代表）
  const leaked = [];
  for (const [t, slots] of listSlots) {
    for (const slot of slots) {
      const out = normalizeListSlots({ type: t, data: { [slot]: [{ title: 'a' }, null] } });
      if ((out.data[slot] || []).some((x) => x === null)) leaked.push(`${t}.${slot}`);
    }
  }
  if (leaked.length) bad(`这些槽上 null 还是穿过去了: ${leaked.join(' ')}`);
  else ok(`带列表槽的 ${listSlots.length} 个块、逐个槽喂 null，一个都没漏过`);

  // 📌 #1425（T3）：这五个原来是 blog-preview.posts / testimonials.items / process-steps.steps / team-grid.members /
  //    faq-accordion.items（票上那张 `npm run build` 表）；旧块删了，换成新库里同样带列表槽的五个。
  for (const [t, slot] of [['features', 'items'], ['testimonials', 'items'], ['gallery', 'items'], ['team', 'members'], ['faq', 'items']]) {
    const out = normalizeListSlots({ type: t, data: { [slot]: [{ x: 1 }, null] } });
    if (JSON.stringify(out.data[slot]) === '[{"x":1}]') ok(`${t}.${slot}: null 被滤掉`);
    else bad(`${t}.${slot}: ${JSON.stringify(out.data[slot])}`);
  }

  // #1425（T3）：原 ⑧ 的四种坏元素（null 之外还有数字 / 布尔 / 嵌套数组）挪到这一层逐个喂；字符串被放行（见 ④b ②）。
  for (const [name, el] of [['null', null], ['数字', 7], ['布尔', true], ['嵌套数组', ['x']]]) {
    const out = normalizeListSlots({ type: 'features', data: { items: [{ title: '甲' }, el, '乙'] } });
    const want = JSON.stringify([{ title: '甲' }, '乙']);
    if (JSON.stringify(out.data.items) === want) ok(`features.items 里混进 ${name} ⟹ 滤掉，剩下 ${want}`);
    else bad(`features.items 里混进 ${name} 之后没被滤掉: ${JSON.stringify(out.data.items)}`);
  }
  const allBad = normalizeListSlots({ type: 'features', data: { items: [null, null] } });
  if (JSON.stringify(allBad.data.items) === '[]') ok('features.items 全是 null ⟹ []');
  else bad(`全是 null 时没被滤空: ${JSON.stringify(allBad.data.items)}`);

  // 槽的值整个不是数组 ⟹ 换成空数组（组件 map 出零个条目，不炸）
  for (const [t, slot, v] of [['features', 'items', 'abc'], ['faq', 'items', 'abc'], ['team', 'members', {}]]) {
    const out = normalizeListSlots({ type: t, data: { [slot]: v } });
    if (JSON.stringify(out.data[slot]) === '[]') ok(`${t}.${slot} = ${JSON.stringify(v)} ⟹ []`);
    else bad(`${t}.${slot} 没被换成 []: ${JSON.stringify(out.data[slot])}`);
  }

  // 🔴 反向对照一：良构 ⟹ **同一个 block、同一个数组**。AC4 的「逐字节不变」立足在这上面；
  //    无条件 `filter()` 每次都造新数组，这一格当场红。
  const objs = [{ title: 't', description: 'd' }];
  const good = { type: 'features', data: { introHeadline: 'H', items: objs } };
  const same = normalizeListSlots(good);
  if (same === good && same.data.items === objs) ok('反向对照: 良构时返回同一个 block、同一个数组（没有重建对象）');
  else bad(`良构时对象被换掉了: same===good ${same === good} · 数组同一个 ${same.data.items === objs}`);

  // 🔴 反向对照二：没写的选填列表槽不许被无中生有塞一个 []（那会给每个块的 data 多出一堆键）
  const bare = { type: 'features', data: { introHeadline: 'H' } };
  const afterBare = normalizeListSlots(bare);
  if (afterBare === bare && !Object.prototype.hasOwnProperty.call(afterBare.data, 'items')) {
    ok('反向对照: 没写的列表槽不会被塞一个空数组');
  } else bad(`没写的槽被动过了: ${JSON.stringify(afterBare.data)}`);

  // 🔴 反向对照三：跟 validateSite 第 ⑤ 条同一条判据 —— 字符串和普通对象都留着（AC5 的 "" 和 {}）
  const keep = normalizeListSlots({ type: 'features', data: { items: ['', {}, { title: 'y' }] } });
  if (JSON.stringify(keep.data.items) === '["",{},{"title":"y"}]') ok('反向对照: "" 和 {} 是合法条目，一个都没被误杀');
  else bad(`"" / {} 被误杀了: ${JSON.stringify(keep.data.items)}`);

  // 📌 #1425（T3）—— 这里原来是「两步串起来」（`normalizeListSlots(normalizeGenericItems(x))`）；前一步随别名层删了，
  //    今天构建那条路上只剩一步，上面 ④ 已经问过它真的接在路上。
}

// ── ⑩ #1341 老站残留的那两个键读的时候丢掉 ──────────────────────────────────────────────────────
//
// 内容结构那一维退役了，而**磁盘上的老站不会被改**：页面 JSON 里照旧躺着块上的 `block_layout` 和
// `data.variant`。这一格问的是「读的时候真的丢掉了吗」，而且**两向都问** —— 只问前半句的话，
// 「丢掉了」跟「这个字段从来就没被读过」长得一样。
console.log('\n── ⑩ #1341 老站残留的 block_layout / variant 读的时候丢掉');
{
  const { readPageBlocks, normalizeListSlots } = blocks;

  // 前半：真的丢了。两种页面形状都问（老站是 `sections`，新站是 `blocks`）。
  for (const key of ['blocks', 'sections']) {
    const page = { slug: 'home', [key]: [{ type: 'hero', block_layout: 'with-media', data: { headline: 'H' } }] };
    const got = readPageBlocks(page, 'page "home"').blocks[0];
    if ('block_layout' in got) bad(`readPageBlocks 没丢掉 block_layout（${key} 形状）: ${JSON.stringify(got)}`);
    else if (got.type !== 'hero' || got.data.headline !== 'H') bad(`readPageBlocks 把别的东西也动了（${key} 形状）: ${JSON.stringify(got)}`);
    else ok(`readPageBlocks 丢掉了块上的 block_layout（${key} 形状），其余一个字节没动`);
  }

  // 🔴 这一格问的是「没有列表槽的块也丢得掉 variant 吗」，所以被问的那个块**现取**，不写死名字
  //    （#1358 之前这里写的是 `hero`，而本票给 hero 加了 `imageBand` 这个列表槽 —— 写死一个名字的
  //    失败方向是静默的：这一格照样绿，而它走的已经不是「提前返回」那一支了）。
  //    判据跟 `blocks.js` 的 `listSlotsFor` 逐字同一条：`spec.kind === 'list'`。
  const manifestsForList = blocks.loadBlockManifests(NEXT);
  const noListType = Object.keys(manifestsForList).sort()
    .find((t) => !Object.values((manifestsForList[t] || {}).slots || {}).some((sp) => sp && sp.kind === 'list'));
  if (!noListType) {
    bad(`夹具不成立: ${Object.keys(manifestsForList).length} 份 manifest 里一个没有列表槽的块都没有`
      + ' —— 这一格问不出「提前返回」那一支');
  } else ok(`夹具成立: 拿 ${noListType} 来问（它没有列表槽），下面两条读数因此走的是「提前返回」那一支`);
  const variantType = noListType || 'hero';

  const withVariant = normalizeListSlots({ type: variantType, data: { headline: 'H', variant: 'centered' } });
  if ('variant' in withVariant.data) bad(`normalizeListSlots 没丢掉 data.variant: ${JSON.stringify(withVariant.data)}`);
  else if (withVariant.data.headline !== 'H') bad(`normalizeListSlots 把别的键也动了: ${JSON.stringify(withVariant.data)}`);
  else ok(`normalizeListSlots 丢掉了 ${variantType} 的 data.variant，同一个 data 里别的键原样留着`);

  // 🔴 后半（反向对照）：**没写这两个键时一个字节都不动**。丢弃那两行如果写成无条件重建对象，
  //    这一格当场红 —— 而「逐字节不变」那条 AC 就立足在这上面。
  const clean = { slug: 'home', blocks: [{ type: 'hero', data: { headline: 'H' } }] };
  const sameArr = readPageBlocks(clean, 'page "home"').blocks;
  if (sameArr === clean.blocks && sameArr[0] === clean.blocks[0]) {
    ok('反向对照: 没写 block_layout 时 readPageBlocks 返回同一个数组、同一个块对象（没有重建）');
  } else bad(`没写 block_layout 时对象被换掉了: 数组同一个 ${sameArr === clean.blocks} · 块同一个 ${sameArr[0] === clean.blocks[0]}`);

  const noVariant = { type: variantType, data: { headline: 'H' } };
  if (normalizeListSlots(noVariant) === noVariant) ok('反向对照: 没写 variant 时 normalizeListSlots 返回同一个 block（没有重建）');
  else bad('没写 variant 时 block 被换掉了');

  // 🔴 另一半：**有**列表槽的块上，丢 variant 这件事同样要成立 —— 它走的是
  //    `if (!slots.length) return out || block;` 之后那条路（列表槽没填 ⟹ 循环里 `continue`，
  //    最后回的是丢过 variant 的那个 out）。#1358 之前这一支没有人问：那时 hero 没有列表槽。
  const listType = Object.keys(manifestsForList).sort()
    .find((t) => Object.values((manifestsForList[t] || {}).slots || {}).some((sp) => sp && sp.kind === 'list'));
  if (!listType) bad('夹具不成立: 一份带列表槽的 manifest 都没有 —— 问不出「不提前返回」那一支');
  else {
    const withList = normalizeListSlots({ type: listType, data: { headline: 'H', variant: 'centered' } });
    if ('variant' in withList.data) bad(`normalizeListSlots 在带列表槽的 ${listType} 上没丢掉 data.variant: ${JSON.stringify(withList.data)}`);
    else if (withList.data.headline !== 'H') bad(`normalizeListSlots 在 ${listType} 上把别的键也动了: ${JSON.stringify(withList.data)}`);
    else ok(`normalizeListSlots 在带列表槽的 ${listType} 上也丢掉了 data.variant（走的是另一支）`);
  }
}

// ── #1349 —— 块 id：两条路一处实现 ──────────────────────────────────────────────────────────────
//
// 🔴 这一格守的不是「id 长得对」，是**两个调用方算出来的是同一个东西**。它们服务同一个站的两个
//    时刻：`pageWithBlocks()` 在建站写盘那一刻、`normalizeLocalePages()` 在每一次构建（老
//    `sections` 形状的页面在那里才拿到 id）。两处各写一遍的失败方向是静默的 —— 页面照样打开、
//    构建照样绿，而编辑器点中一个块、拿这个 id 回头去改页面 JSON 时改到的是别的块。
//
// 🔴 所以判据是**把同一份页面喂给两条路，比两组 id**，不是各自跟一个手打的字面量比：
//    手打字面量在两边一起抄错时是绿的，而那正是这一格要抓的那种错。
{
  const { pageWithBlocks, generatedBlockId } = blocks;
  if (typeof pageWithBlocks !== 'function' || typeof generatedBlockId !== 'function') {
    die('blocks.js 没导出 pageWithBlocks / generatedBlockId');
  }

  // 老 `sections` 形状（磁盘上今天每一个既有站的样子）：没有 id、没有 role/region/weight。
  const oldShape = () => ({
    slug: 'services/drain-repair',
    blocks: undefined,
    sections: [
      { type: 'page-header', data: { title: 'T' } },
      { type: 'content', data: { body: 'B' } },
      { type: 'contact', data: {} },
    ],
  });
  const stripUndef = (p) => { const o = { ...p }; delete o.blocks; return o; };

  const viaCreate = pageWithBlocks(stripUndef(oldShape())).blocks.map((b) => b.id);
  const built = stripUndef(oldShape());
  normalizeLocalePages([built], {}, 'en', {});
  const viaBuild = built.blocks.map((b) => b.id);

  if (JSON.stringify(viaCreate) === JSON.stringify(viaBuild)) {
    ok(`块 id 两条路一致: ${JSON.stringify(viaBuild)}`);
  } else {
    bad(`块 id 两条路分叉了 —— 建站 ${JSON.stringify(viaCreate)} vs 构建 ${JSON.stringify(viaBuild)}`);
  }

  // 形状本身也要钉一格，否则「两边一起变成空字符串」也会让上面那格绿。
  // 斜杠换横杠是承重的：id 进的是 DOM 属性，也是 React 的 key。
  const want = 'services-drain-repair-content-1';  // #1425（T3）：text-block → content
  if (viaBuild[1] === want) ok(`块 id 是三段「页-类型-序号」且斜杠换成了横杠: ${want}`);
  else bad(`块 id 形状不对: 想要 ${want}，拿到 ${viaBuild[1]}`);

  if (generatedBlockId('home', 'hero', 0) === 'home-hero-0') ok('generatedBlockId 直接调用的读数对');
  else bad(`generatedBlockId('home','hero',0) = ${generatedBlockId('home', 'hero', 0)}`);

  // 🔴 反向对照：**页面 JSON 自己写了 id 的块，构建期不许覆盖它**。覆盖的话
  //    `{ "ref": "<id>" }` 那条路（站级块库）会指不到东西，而那是静默的。
  const authored = { slug: 'home', blocks: [{ id: 'my-own-name', type: 'hero', data: {} }] };
  normalizeLocalePages([authored], {}, 'en', {});
  if (authored.blocks[0].id === 'my-own-name') ok('反向对照: 页面自己写的 id 没被现算的那个覆盖掉');
  else bad(`页面自己写的 id 被覆盖成了 ${authored.blocks[0].id}`);
}

// 📌 原来这里是 ⑪（#1351 `ref` 条目上的 `hidden` 覆盖）。`hidden` 整条由 #1411 退役，那一节跟着删了；
//    编号不重排，免得别处引用「⑫」的注释对不上。

// ── ⑫ #1350 站级共用块的页面级覆盖：`ref` 条目上的 shape 真的被读了 ──────────────────────────
//
// 它在 #1350 交付里漏了：`ref` 那一支原来只显式带过另一个字段（`hidden`，#1411 已退役），
// 于是老板给一个**站级块**挑形态时，manager 放行、worker 真把 `shape` 写进页面 JSON 的 `{ref}`
// 条目、预览里也当场看得见（AC4 是浏览器侧改属性），**而构建把它静默丢掉** —— 保存重建之后产物里
// 那个块回到主题形态。#1350 要治的正是「点了保存、产物里却是另一个形态」，这一格是它自己的漏网。
// 📌 清除那一侧（`resetShapesInSite`）本来就认识 `{ref}` 条目 ⟹ 修之前这个字段只能删、不能用。
console.log('\n── ⑫ #1350 ref 条目上的 shape 被页面级覆盖读到');
{
  // #1425（T3）：team-grid → team；形态名换成 team 今天真有的（cards / list）
  const LIB = { 'our-team': { type: 'team', role: 'optional', region: 'content', data: { headline: '团队' } } };
  const runOne = (entry, lib = LIB) => {
    const report = {};
    const out = normalizeLocalePages([{ slug: 'home', blocks: [entry] }], lib, 'en', report);
    return { block: out[0].blocks.find(b => b.id === 'our-team'), report };
  };

  // 正臂：这一页写了 shape ⟹ 解出来的块带着它（sync-config 的三级取值第 ① 级读的就是 block.shape）
  {
    const { block } = runOne({ ref: 'our-team', shape: 'list' });
    if (!block) bad('正臂: ref 根本没解出来（夹具坏了）');
    else if (block.shape === 'list') ok('正臂: ref 条目上的 shape 被带到解出来的块上');
    else bad(`正臂: shape 没被带过来（block.shape = ${JSON.stringify(block.shape)}）—— 这正是改动前的读数`);
  }

  // 🔴 反向对照一：这一页**没写** shape ⟹ 块上不许凭空出现这个键。
  //    无条件 `shape: entry.shape` 会给每个 ref 条目塞一个 `shape: undefined`；而更坏的变体
  //    （补一个默认值）会让 `shapeForBlock` 的第 ① 级恒命中，主题选择单从此对站级块失效。
  {
    const { block } = runOne({ ref: 'our-team' });
    if (block && !Object.prototype.hasOwnProperty.call(block, 'shape')) {
      ok('反向对照: 这一页没写 shape 时，块上不会凭空多出这个键');
    } else bad(`没写 shape 却多出了这个键: ${JSON.stringify(block && block.shape)}`);
  }

  // 🔴 反向对照二：站级块自己写了形态、这一页没说话 ⟹ 站级那个要留着（`...target` 带过来的）。
  {
    const shapedLib = { 'our-team': { ...LIB['our-team'], shape: 'cards' } };
    const { block } = runOne({ ref: 'our-team' }, shapedLib);
    if (block && block.shape === 'cards') ok('反向对照: 站级块自己写的 shape 没被这一页抹掉');
    else bad(`站级块自己的 shape 丢了: ${JSON.stringify(block && block.shape)}`);
  }

  // 🔴 反向对照三：两边都写了 ⟹ **这一页的赢**（「站级共用块只改本页那一份」是 #1351 定的口径，
  //    本票的写路径也照它）。少了这一格，一个「站级的永远赢」的实现也能让上面三格全绿。
  {
    const shapedLib = { 'our-team': { ...LIB['our-team'], shape: 'cards' } };
    const { block } = runOne({ ref: 'our-team', shape: 'list' }, shapedLib);
    if (block && block.shape === 'list') ok('反向对照: 站级写 cards、这一页写 list ⟹ 这一页的赢');
    else bad(`页面级覆盖没赢过站级: ${JSON.stringify(block && block.shape)}`);
  }

  // 🔴 坏形状：shape 不是字符串 ⟹ 忽略这个字段 + 点名，照 role / weight 那一套。
  //    🔴 这里只判**形状**，不判这个名字存不存在：形态名对不对由 `shapeForBlock` 在有 manifest 的
  //    地方判（#1331 的落回默认 + 日志，本票 AC7 钉的就是它）。两处各判各的那一半，别在这里重写。
  {
    const { block, report } = runOne({ ref: 'our-team', shape: 123 });
    const named = (report.notes || []).filter(n => n.includes('"shape"') && n.includes('our-team'));
    if (block && Object.prototype.hasOwnProperty.call(block, 'shape')) {
      bad(`坏形状被放行了: block.shape = ${JSON.stringify(block.shape)}`);
    } else if (named.length !== 1) {
      bad(`坏形状没被点名（命中 ${named.length} 条）: ${JSON.stringify(report.notes)}`);
    } else ok(`坏形状 shape:123 被忽略并点名：${named[0]}`);
  }

  // 🔴 空字符串跟「没写」是同一个下场，但走的是**另一条**判断：`shapeForBlock` 判的是
  //    `typeof block.shape === 'string' && block.shape`，空串在那里是假值 ⟹ 落到第 ② 级。
  //    带一个空串过去不会改变结果，但会让页面 JSON 里那个键看起来「有人挑过」，所以一样不带。
  {
    const { block: b2, report: r2 } = runOne({ ref: 'our-team', shape: '' });
    const named2 = (r2.notes || []).filter(n => n.includes('"shape"') && n.includes('our-team'));
    if (b2 && Object.prototype.hasOwnProperty.call(b2, 'shape')) {
      bad(`空串被带过去了: ${JSON.stringify(b2.shape)}`);
    } else if (named2.length !== 1) {
      bad(`空串没被点名（命中 ${named2.length} 条）: ${JSON.stringify(r2.notes)}`);
    } else ok('空串 shape 不带过去、并且点名（跟没写的区别在于它被说了一句）');
  }

  // 🔴 坏形状不许连累别的字段：构建不中断、块照样解出来。
  {
    const { block } = runOne({ ref: 'our-team', shape: 123 });
    if (block && block.type === 'team' && block.data && block.data.headline === '团队') {
      ok('坏形状只丢掉 shape 这一个字段，块本身原样解出来（构建不中断）');
    } else bad(`坏形状把别的东西也弄坏了: ${JSON.stringify(block)}`);
  }
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
