#!/usr/bin/env node
/**
 * blocks.test.js — 老块名 → 通用块的别名，那几条承重性质（#1132）。
 *
 * 跑法:  node scripts/blocks.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这几条要有一个自动的调用方 ═════════════════════════════════════════════════════════════
 * 别名的失败方向全部是**静默**的 —— 站照样建得出来、构建照样是绿的，只是老站的产物变了：
 *   · 别名不把老词汇带过去   → 那一节的类名从 `.values-grid__title` 换成新名字，而 83 张主题表
 *                              全部 83 张都在选老名字 ⟹ **像素真的变**，没有任何一格会红
 *   · 忘了显式写 `role`      → `blockAttrs` 按新 type 名查表、查不到、落到兜底的 `essential`
 *   · 别名凭空造 `block_layout` → 产物上多一个属性
 *   · `values-grid` 那条路画出副标题 → 页面上凭空多一行（它的 manifest 从来没有这个槽位）
 *   · #1143：`checklist` 的 `[string]` 没升成 `[{title}]` → 组件读 `item.title` 读到 undefined，
 *     产物里每个条目变成一行空字；`service-highlights` 的 `highlights` 没映到 `items` → 整块的条目
 *     一个都不画。两种都不会让构建变红
 * 真正的读数是「重建前后逐字节相同」那套（映射文档 §2.6，交接留言里贴了四格）。这里守的是它下面
 * 那几条**性质** —— 那套要跑两次完整构建，不可能每次改动都跑。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let blocks; let roles; let hooks;
try {
  blocks = require(path.join(NEXT, 'scripts', 'blocks.js'));
  roles = require(path.join(NEXT, 'src', 'lib', 'sections', 'block-roles.json'));
  ({ HOOKS: hooks } = require(path.join(NEXT, 'scripts', 'theme-css-lint.js')));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

const { BLOCK_ALIASES, applyAlias, normalizeLocalePages } = blocks;

// 🔴 分母先说出来。这一格 #1162 **反过来了**：原来是「表里一条真别名都没有 ⟹ die，没东西可查」，
//    而别名层 2026-08-23 整层退役之后，**零条真别名正是要钉的性质**。所以判据换成两条：
//    ① 通用块自己那一行必须在（它是 CardGroupSection 每个类名的唯一出处，丢了是像素级回归）；
//    ② 真别名必须是 0（有的话说明别名被加回来了，而下面 ③ 那格枚举的四个老名字挡不住第五个）。
const legacy = Object.keys(BLOCK_ALIASES).filter((k) => BLOCK_ALIASES[k].type !== k);
const generic = Object.keys(BLOCK_ALIASES).filter((k) => BLOCK_ALIASES[k].type === k);
if (generic.length === 0) die('词汇表里连通用块自己那一行都没有 —— 没东西可查，这不是通过');
if (legacy.length !== 0) {
  bad(`词汇表里出现了 ${legacy.length} 条真别名（${legacy.join(' ')}）—— 别名层 #1162 已退役，`
    + '合并从此是干净改名。要加回来的话先回去读 #1162 正文与 block-merge-mapping.md §2 的退役横幅。');
} else {
  ok(`词汇表：通用块 ${generic.length} 行（${generic.join(' ')}）· 真别名 0 条（#1162 退役后应有的样子）`);
}
if (generic.length === 0) die('别名表里没有「键 == 它自己的 type」那种通用块自己的行');
console.log(`══ 别名表: ${legacy.length} 条老名字（${legacy.join(' ')}）· `
  + `${generic.length} 个通用块（${generic.join(' ')}）══`);

// `CardGroupSection` 里条目那三支各自的标签 —— 表里写别的值就没有对应的分支（#1143）。
const ITEM_TAGS = ['div', 'p', 'article'];

// ── ① 每一行写齐 §2.1 那四件事 ──────────────────────────────────────────────────────────────────
for (const name of Object.keys(BLOCK_ALIASES)) {
  const row = BLOCK_ALIASES[name];
  const missing = ['type', 'role', 'block_layout', 'data', 'itemTag', 'headingId', 'parts']
    .filter((k) => !Object.prototype.hasOwnProperty.call(row, k));
  if (missing.length) bad(`${name}: 别名表这一行缺 ${missing.join(' / ')}`);
  else if (!ITEM_TAGS.includes(row.itemTag)) {
    // #1143 —— `itemTag` 是产物 DOM 上看得见的字节（`<p>` / `<article>` / `<div>`）。写了个
    // `CardGroupSection` 没有分支的值，那一支会画成一个未知标签而构建照样是绿的。
    bad(`${name}: itemTag 写着 ${JSON.stringify(row.itemTag)}，而组件只有 ${ITEM_TAGS.join(' / ')} 三支`);
  } else if (row.block_layout !== null) {
    bad(`${name}: block_layout 写着 ${JSON.stringify(row.block_layout)} —— 别名不许造一个`
      + '（老站那条路上没有它，造了产物就多一个 data-block-layout 属性）');
  } else if (row.role !== roles[name]) {
    bad(`${name}: 别名写的 role 是 ${JSON.stringify(row.role)}，而 block-roles.json 里是 `
      + `${JSON.stringify(roles[name])} —— 两个不一样就等于老站的 data-role 变了`);
  } else ok(`${name}: 四件事齐了，role 跟 block-roles.json 对得上（${row.role}）`);
}

// ── ② 每个词汇的每个部件都得是契约里的钩子 ─────────────────────────────────────────────────────
// 反过来也要：契约里 `.<词汇>__x` 那些钩子，词汇的 parts 里都得有。少一边都是静默的 ——
// 多了钩子而 markup 不画它，`theme-css-invariants` 那格会红在「这个钩子没有任何页面画过」；
// 少了钩子而 markup 画了它，主题表就点不到那个部件，而页面照样打开。
for (const name of Object.keys(BLOCK_ALIASES)) {
  const parts = BLOCK_ALIASES[name].parts;
  const want = new Set([`.${name}`, ...parts.map((p) => `.${name}__${p}`)]);
  const notHooks = [...want].filter((h) => !hooks.has(h));
  const hookOnly = [...hooks].filter((h) => h.startsWith(`.${name}`) && !want.has(h));
  if (notHooks.length) bad(`${name}: 这些部件不在契约的钩子清单里: ${notHooks.join(' ')}`);
  else if (hookOnly.length) bad(`${name}: 契约里有这些钩子，而这个词汇的 parts 不画它们: ${hookOnly.join(' ')}`);
  else ok(`${name}: ${want.size} 个钩子与契约逐个对上（两向）`);
}

// ── ③ #1162：applyAlias 【不再改任何东西的名字】 ──────────────────────────────────────────────
// 🔴 这一格是从「换名字、留老名字、补 role、不动 data」改过来的。别名层 2026-08-23 整层退役
//    （Chris 裁定：合并从此是干净改名），所以要钉的性质**反过来**了：它不许再动 type、不许再往块上
//    挂任何记老名字的字段。留着这一格而不是删掉，是因为「不再发生」跟「从来没发生过」需要同一道闸 ——
//    哪天有人把别名加回来，这里会红。
{
  const own = applyAlias({ type: 'card-group', data: { headline: 'H', items: [{ title: 'a', description: 'b' }], style: 'icon' } });
  if (own.type !== 'card-group') bad(`applyAlias 动了通用块的 type（变成 ${own.type}）`);
  else if (Object.keys(own).some((k) => k.startsWith('__'))) {
    bad(`applyAlias 往块上挂了一个内部字段: ${Object.keys(own).filter((k) => k.startsWith('__')).join(' ')} —— 别名层已经退役，不该再有这种字段`);
  } else if (own.data.style !== 'icon') bad('「继续忽略」的字段被删掉了 —— verify-applied 会对不上账');
  else ok('applyAlias: 通用块的 type 没动 · 没挂任何 __ 字段 · data 一个字节没动');

  // 表里没有的块一个字节都不动（同一个对象引用）—— 这一条从别名时代原样保留
  const other = { type: 'hero', data: {} };
  if (applyAlias(other) !== other) bad('词汇表里没有的块被换掉了对象');
  else ok('词汇表里没有的块原样返回（同一个对象引用）');

  // 🔴 四个老 type 名**不许**再被任何一处认出来。逐处枚举，不抽样。
  const OLD = ['values-grid', 'benefits-list', 'checklist', 'service-highlights'];
  const reg = fs.readFileSync(path.join(NEXT, 'src/lib/sections/registry.ts'), 'utf8');
  const regKeys = new Set([...reg.matchAll(/^ {2}'([a-z0-9-]+)':/gm)].map((m) => m[1]));
  const roleKeys = new Set(Object.keys(require(path.join(NEXT, 'src/lib/sections/block-roles.json'))));
  const where = [];
  for (const n of OLD) {
    if (Object.prototype.hasOwnProperty.call(BLOCK_ALIASES, n)) where.push(`block-aliases.json:${n}`);
    if (regKeys.has(n)) where.push(`registry.ts:${n}`);
    if (roleKeys.has(n)) where.push(`block-roles.json:${n}`);
    if (fs.existsSync(path.join(NEXT, 'blocks', `${n}.json`))) where.push(`blocks/${n}.json`);
    // 还认得它 = 别名层没真的退役
    const round = applyAlias({ type: n, data: { headline: 'H' } });
    if (round.type !== n) where.push(`applyAlias 仍然把 ${n} 换成了 ${round.type}`);
  }
  if (where.length) bad(`这四个老 type 名还被认出来: ${where.join(' · ')}`);
  else ok(`四个老 type 名在四处（词汇表 / registry / block-roles / blocks manifest）都不在，applyAlias 也不再认它们`);
}

// ── ④ 真的接上了：走一遍 normalizeLocalePages（两种形状各一次）─────────────────────────────
// 🔴 抽出来的函数好使 ≠ 它被接线了。这一格问的是「构建那条路上真的会经过它吗」，两种页面形状
// （老站的 `sections` / 新站的 `blocks`）分别问一次。#1162 之后夹具写的是**现役** type 名 ——
// 用老名字写的话，下面那条断言问的就不是「接线了吗」而是「别名还在吗」。
for (const [shapeName, page] of [
  ['sections（老形状）', { slug: 'about', sections: [{ type: 'card-group', data: { headline: 'H', items: ['裸串'] } }] }],
  ['blocks（新形状）', { slug: 'about', blocks: [{ id: 'x', type: 'card-group', role: 'optional', data: { headline: 'H', items: ['裸串'] } }] }],
]) {
  let out;
  try {
    out = normalizeLocalePages([page], {}, 'en', {});
  } catch (e) {
    bad(`${shapeName}: normalizeLocalePages 抛了 ${e.message}`);
    continue;
  }
  const b = out[0].blocks[0];
  // 判据换成「归一化真的在这条路上发生过」：裸字符串被升成了对象。
  // 🔴 别拿 `type` 当判据 —— 今天没有改名了，`type` 两头都是 card-group，那样这一格会恒绿。
  if (b.type !== 'card-group') bad(`${shapeName}: type 被动过了（${b.type}）`);
  else if (JSON.stringify(b.data.items) !== JSON.stringify([{ title: '裸串' }])) {
    bad(`${shapeName}: 归一化没发生在这条路上（items=${JSON.stringify(b.data.items)}）⟹ 接线断了`);
  } else ok(`${shapeName}: 归一化真的在构建那条路上发生了（裸串 → [{title}]）`);
}

// ── ⑦ #1162：老 type 名走到底会怎样 —— 不改名、不静默接上别的槽位 ────────────────────────────
// 🔴 这一格是 AC5 的机械版。别名退役之后，磁盘上写着老 type 名的页面**不会**被改名；它一路走到
//    `SectionRenderer`，命中未知类型那一支（`console.warn` + `return null`），那个块在页面上不出现。
//    这里钉住「构建那一侧不许悄悄替它做点什么」：type 原样、`highlights` 这种老槽位名不许被改成
//    `items`（改了就等于把一块本来空着的地方接上内容，而没有人决定过这件事 —— 老 §2.5 坑三那一族）。
{
  const legacy = applyAlias({ type: 'service-highlights', data: { headline: 'H', highlights: [{ title: 't' }] } });
  if (legacy.type !== 'service-highlights') bad(`老 type 名被改名了（变成 ${legacy.type}）—— 别名层应该已经退役`);
  else if (Object.prototype.hasOwnProperty.call(legacy.data, 'items')) {
    bad('老槽位名 highlights 被改成了 items —— 那会让一块本来空着的地方凭空长出内容');
  } else ok('老 type 名原样留着、老槽位名不被改名 ⟹ 它走 SectionRenderer 的未知类型那一支（AC5）');

  const manifest = require(path.join(NEXT, 'blocks', 'card-group.json'));
  const slots = Object.keys(manifest.slots || {});
  const lists = slots.filter((k) => manifest.slots[k].kind === 'list');
  if (slots.includes('highlights')) bad('通用块的 manifest 上还有 highlights 这个槽位（AC4）');
  else if (lists.length !== 1) bad(`通用块的 manifest 上有 ${lists.length} 个列表槽位（${lists.join(' ')}）—— 只能有一种`);
  else ok(`通用块 manifest 的槽位是 {${slots.join(' ')}}，列表槽位只有 ${lists[0]}（AC3/AC4）`);
}

// ── ⑥ #1143 / #1162：`[string]` 升成 `[{title}]`（今天只剩通用块自己那一条路）────────────────
// 🔴 两条路里的一条没了：老站写 `type: "checklist"` 走别名进来那条随别名层退役。**剩下这条还在，
//    而且没有别的东西挡它**：新站直接写 `type: "card-group"`、`items` 里塞裸字符串时，建站期
//    `block-manifest.js` 的校验 ⑤ 只拦 `null` 和数组（**放行字符串**），`normalizeListSlots` 的
//    `drawableItem` 也把字符串算作可画 ⟹ 少了这一步，组件读 `item.title` 得到 undefined，
//    画出来是一个空标题。所以这一格留着。
{
  const direct = applyAlias({ type: 'card-group', data: { items: ['裸串'], variant: 'cards' } });
  if (JSON.stringify(direct.data.items) !== JSON.stringify([{ title: '裸串' }])) {
    bad(`通用块那条路上裸字符串没被规范化: ${JSON.stringify(direct.data.items)}`);
  } else if (direct.data.variant !== 'cards') {
    bad('「继续忽略」的 variant 在归一化时被删掉了');
  } else ok('通用块自己那条路上，裸字符串数组被规范化成 [{title}]，variant 原样留着');

  // 反向对照：本来就是对象的，一个字节都不动（同一个数组引用）
  const objs = [{ title: 'a', description: 'b' }];
  const untouched = applyAlias({ type: 'card-group', data: { items: objs } });
  if (untouched.data.items !== objs) {
    bad('items 本来就是对象时归一化仍然换掉了那个数组 —— 「正常的站走到这里是恒等的」会被这一步弄假');
  } else ok('反向对照: items 本来就是对象时，归一化是恒等的（同一个数组引用）');
}

// ── ⑤ 反向对照：把那一步归一化拿掉，上面第 ⑥ 格必须红 ──────────────────────────────────────
// 🔴 没有这一格，前面那些 ✅ 说明不了它们**分得开**两种实现。原来这一格拿掉的是别名的
//    「带老词汇」那一半（`__legacy…`）；那一半随别名层退役，所以对照换成拿掉「裸字符串升格」——
//    它是这个函数今天唯一还会动东西的地方。
{
  const raw = { type: 'card-group', data: { items: ['裸串'] } };
  // 不经过 applyAlias 的那一臂：组件会读 item.title，而它是 undefined
  const skipped = raw.data.items;
  if (typeof skipped[0] !== 'string') bad('反向对照的输入本身就不是裸字符串 —— 这一格测不到东西');
  else if (skipped[0].title !== undefined) bad('反向对照没生效');
  else ok(`反向对照: 不经过归一化时条目仍是字符串（item.title === undefined ⟹ 组件画出空标题）⟹ 第 ⑥ 格那一步是承重的`);
}


// ── ⑧ #1152：条目列表里混进 `null`（或别的画不出来的元素）⟹ 归一化把它滤掉 ────────────────────
// 🔴 为什么这一格非有不可：`CardGroupSection` 三支（`:90` / `:96` / `:110`）都直接读 `item.title`，
//    没有一处可选链。一个 `null` 穿过归一化，`next build` 在预渲染那一页当场炸
//    `Cannot read properties of null (reading 'title')`，**整个站建不出来** —— 五个归到
//    `card-group` 的 type 逐个实测过，改之前全是 rc=1。这条不像别名那几条是「静默变样」，
//    它是硬失败；但**发现它的路只有真跑一次构建**，所以这里把判据钉在归一化的输出上。
{
  const kinds = [
    ['null', null], ['数字', 7], ['布尔', true], ['嵌套数组', ['x']],
  ];
  for (const [name, el] of kinds) {
    const out = applyAlias({ type: 'card-group', data: { headline: 'H', items: ['甲', el, '乙'] } });
    const got = JSON.stringify(out.data.items);
    const want = JSON.stringify([{ title: '甲' }, { title: '乙' }]);
    if (got !== want) bad(`items 里混进 ${name} 之后没被滤掉: ${got}`);
    else ok(`items 里混进 ${name} ⟹ 滤掉，剩下的照旧升成 ${want}`);
  }

  // 全是画不出来的元素 ⟹ 空数组。组件画一个空的组，构建不炸（这一支走的是「没有一个字符串」那条
  // 提前返回的老路径，所以它是**另一条**分支，不许只测上面那一种）。
  const allBad = applyAlias({ type: 'card-group', data: { headline: 'H', items: [null, null] } });
  if (JSON.stringify(allBad.data.items) !== '[]') {
    bad(`全是 null 时没被滤空: ${JSON.stringify(allBad.data.items)}`);
  } else ok('items 全是 null ⟹ 变成 []（这一支不经过「有字符串」那个判断，是另一条分支）');

  // 🔴 反向对照之一：良构的纯对象数组仍然是**同一个数组引用**。加过滤最容易弄丢的就是它 ——
  //    无条件 `filter().map()` 每次都造新数组，#1143 的「老站重建逐字节不变」当场没。
  const objs = [{ title: 'a', description: 'b' }];
  const untouched = applyAlias({ type: 'card-group', data: { headline: 'H', items: objs } });
  if (untouched.data.items !== objs) {
    bad('良构的纯对象数组被过滤那一步换掉了引用 —— #1143 的逐字节不变会被这一步弄假');
  } else ok('反向对照: 良构的纯对象数组仍是同一个数组引用（过滤没把恒等那条路弄丢）');

  // 🔴 反向对照之二：**这个函数保护的每一个 type 都要逐个喂一次**，不许抽一个代表。
  //    #1162：这一格原来的分母是「归到 card-group 的 type ≥5」（通用块自己 + 四个老名字别名）；
  //    别名退役之后那个数按构造是 1，据它判红只会天天红一次。而这一格真正问的是
  //    「`normalizeGenericItems` 的射程里每一个 type 都被保护吗」，它的射程就是 `GENERIC_TYPES`
  //    （从词汇表的 `type` 值现算），所以分母换成它 —— 明天多一个通用块，这一格自己跟着变宽。
  //    📌 分母是 1 不再是「尺子坏了」：#1154 的 `normalizeListSlots` 才是管全部块的那一层，
  //    它自己那一格在 ⑨，两层各测各的射程（这一层只管 GENERIC_TYPES 的 `items`）。
  const generics = [...new Set(Object.values(BLOCK_ALIASES).map((r) => r.type))];
  if (generics.length === 0) bad('GENERIC_TYPES 是空的 —— 这一格什么都没查');
  else {
    const leaked = generics.filter((t) => {
      const r = applyAlias({ type: t, data: { headline: 'H', items: ['甲', null] } });
      return (r.data.items || []).some((x) => x === null);
    });
    if (leaked.length) bad(`这些 type 上 null 还是穿过去了: ${leaked.join(' ')}`);
    else ok(`normalizeGenericItems 的射程共 ${generics.length} 个 type（${generics.join(' ')}）逐个喂 null，一个都没漏过`);
  }
}

// ── ⑨ #1154：所有块的列表槽兜底（不只是卡片组，也不只是叫 items 的槽）────────────────────────
//
// 🔴 上面第 ⑧ 格守的是 `normalizeGenericItems`，它头一行就是 `GENERIC_TYPES.has(block.type)`
//    ⟹ 按构造只管 `card-group` 一家、只看 `items` 一个槽。同一个坏数据换个块照样让构建当场死。
//    这一格守的是 `normalizeListSlots`：判据按 manifest 的 `kind: "list"`。
console.log('── ⑨ #1154 所有块的列表槽兜底');
{
  const { normalizeListSlots } = blocks;
  if (typeof normalizeListSlots !== 'function') die('blocks.js 没导出 normalizeListSlots');

  // 分母先说出来：本仓今天有多少个块带列表槽、其中多少个**不是**通用块。
  // 后者是 0 的话下面每一格都是「全过」，而那什么都没查。
  const manifests = blocks.loadBlockManifests(NEXT);
  const listSlots = Object.entries(manifests)
    .map(([t, m]) => [t, Object.entries((m && m.slots) || {}).filter(([, sp]) => sp && sp.kind === 'list').map(([k]) => k)])
    .filter(([, slots]) => slots.length);
  const nonGeneric = listSlots.filter(([t]) => !blocks.GENERIC_TYPES.has(t) && !BLOCK_ALIASES[t]);
  console.log(`     带列表槽的块 ${listSlots.length} 个，其中不归通用块管的 ${nonGeneric.length} 个`);
  if (nonGeneric.length < 3) {
    bad(`不归通用块管、又带列表槽的块只数出 ${nonGeneric.length} 个 —— 分母不对，下面的读数不作数`);
  }

  // 逐个喂一个 null，一个都不许漏过去（不抽代表）
  const leaked = [];
  for (const [t, slots] of nonGeneric) {
    for (const slot of slots) {
      const out = normalizeListSlots({ type: t, data: { [slot]: [{ title: 'a' }, null] } });
      if ((out.data[slot] || []).some((x) => x === null)) leaked.push(`${t}.${slot}`);
    }
  }
  if (leaked.length) bad(`这些槽上 null 还是穿过去了: ${leaked.join(' ')}`);
  else ok(`不归通用块管的 ${nonGeneric.length} 个块、逐个槽喂 null，一个都没漏过`);

  // 票里点名的那五个，逐个把报错那句对上（`npm run build` 那一张表在票上，这里守的是同一条性质）
  for (const [t, slot] of [['timeline', 'events'], ['testimonials', 'items'], ['process-steps', 'steps'], ['team-grid', 'members'], ['faq-accordion', 'items']]) {
    const out = normalizeListSlots({ type: t, data: { [slot]: [{ x: 1 }, null] } });
    if (JSON.stringify(out.data[slot]) === '[{"x":1}]') ok(`${t}.${slot}: null 被滤掉`);
    else bad(`${t}.${slot}: ${JSON.stringify(out.data[slot])}`);
  }

  // 槽的值整个不是数组 ⟹ 换成空数组（组件 map 出零个条目，不炸）
  for (const [t, slot, v] of [['timeline', 'events', 'abc'], ['card-group', 'items', 'abc'], ['team-grid', 'members', {}]]) {
    const out = normalizeListSlots({ type: t, data: { [slot]: v } });
    if (JSON.stringify(out.data[slot]) === '[]') ok(`${t}.${slot} = ${JSON.stringify(v)} ⟹ []`);
    else bad(`${t}.${slot} 没被换成 []: ${JSON.stringify(out.data[slot])}`);
  }

  // 🔴 反向对照一：良构 ⟹ **同一个 block、同一个数组**。AC4 的「逐字节不变」立足在这上面；
  //    无条件 `filter()` 每次都造新数组，这一格当场红。
  const objs = [{ year: '2020', title: 't' }];
  const good = { type: 'timeline', data: { headline: 'H', events: objs } };
  const same = normalizeListSlots(good);
  if (same === good && same.data.events === objs) ok('反向对照: 良构时返回同一个 block、同一个数组（没有重建对象）');
  else bad(`良构时对象被换掉了: same===good ${same === good} · 数组同一个 ${same.data.events === objs}`);

  // 🔴 反向对照二：没写的选填列表槽不许被无中生有塞一个 []（那会给每个块的 data 多出一堆键）
  const bare = { type: 'timeline', data: { headline: 'H' } };
  const afterBare = normalizeListSlots(bare);
  if (afterBare === bare && !Object.prototype.hasOwnProperty.call(afterBare.data, 'events')) {
    ok('反向对照: 没写的列表槽不会被塞一个空数组');
  } else bad(`没写的槽被动过了: ${JSON.stringify(afterBare.data)}`);

  // 🔴 反向对照三：跟 validateSite 第 ⑤ 条同一条判据 —— 字符串和普通对象都留着（AC5 的 "" 和 {}）
  const keep = normalizeListSlots({ type: 'timeline', data: { events: ['', {}, { year: 'y' }] } });
  if (JSON.stringify(keep.data.events) === '["",{},{"year":"y"}]') ok('反向对照: "" 和 {} 是合法条目，一个都没被误杀');
  else bad(`"" / {} 被误杀了: ${JSON.stringify(keep.data.events)}`);

  // 🔴 两步串起来还对吗（`blocks.js` 那个循环写的就是 `normalizeListSlots(applyAlias(x))`）。
  //    #1162：这一格原来测的是「`service-highlights` 先被别名改成 `card-group` + `items`，再按新
  //    type 查列表槽」—— 改名那一步随别名层退役，所以顺序的**理由**变了（不再是「后一步要等新 type
  //    才查得到槽」）。今天两步各自还在做事，串起来的性质是：**裸字符串被升成对象，而画不出来的
  //    条目被滤掉，两件事都发生**。这一格问的就是这个，不是问顺序谁先谁后（实测两种顺序等价 ——
  //    `drawableItem` 把字符串也算可画，理由写在 `blocks.js` 那个循环上面）。
  const chained = normalizeListSlots(applyAlias({ type: 'card-group', data: { headline: 'H', items: ['甲', null, { title: 't' }] } }));
  if (chained.type === 'card-group' && JSON.stringify(chained.data.items) === '[{"title":"甲"},{"title":"t"}]') {
    ok('两步串起来: 裸字符串升成 {title} · null 被滤掉 · type 没被动过');
  } else bad(`两步串起来的结果不对: ${JSON.stringify(chained)}`);
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
