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

// 🔴 分母先说出来。表空了的话下面每一格都会「全过」，而那是什么都没查。
const legacy = Object.keys(BLOCK_ALIASES).filter((k) => BLOCK_ALIASES[k].type !== k);
const generic = Object.keys(BLOCK_ALIASES).filter((k) => BLOCK_ALIASES[k].type === k);
if (legacy.length === 0) die('别名表里一条真别名都没有 —— 没东西可查，这不是通过');
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

// ── ③ applyAlias 的行为：换名字、留老名字、补 role、不动 data ────────────────────────────────
{
  const before = { type: 'values-grid', data: { headline: 'H', items: [{ title: 'a', description: 'b' }], style: 'icon' } };
  const after = applyAlias(before);
  if (after.type !== 'card-group') bad(`applyAlias 没换 type（还是 ${after.type}）`);
  else if (after.__legacyType !== 'values-grid') bad('applyAlias 没把老名字放进 __legacyType');
  else if (after.role !== 'optional') bad(`applyAlias 没补 role（是 ${after.role}）`);
  else if (after.block_layout !== undefined) bad('applyAlias 造了一个 block_layout');
  else if (JSON.stringify(after.data) !== JSON.stringify(before.data)) {
    bad(`applyAlias 动了 data: ${JSON.stringify(after.data)}`);
  } else if (after.data.style !== 'icon') bad('「继续忽略」的字段被删掉了 —— verify-applied 会对不上账');
  else ok('applyAlias: type 换了 · 老名字留在 __legacyType · role 补上 · data 一个字节没动');

  // 显式写了 role 的块（新形状带 role）：显式的赢
  const kept = applyAlias({ type: 'values-grid', role: 'essential', data: {} });
  if (kept.role !== 'essential') bad(`块自己写的 role 被别名盖掉了（变成 ${kept.role}）`);
  else ok('块自己写了 role 时别名不覆盖它');

  // 通用块自己那一行不是别名
  const own = applyAlias({ type: 'card-group', data: {} });
  if (own.__legacyType !== undefined) bad('通用块自己被当成别名处理了 —— 它会带上一个假的 __legacyType');
  else ok('「键 == 它自己的 type」那一行不当别名用');

  // 表里没有的块一个字节都不动（同一个对象引用）
  const other = { type: 'hero', data: {} };
  if (applyAlias(other) !== other) bad('别名表里没有的块被换掉了对象');
  else ok('别名表里没有的块原样返回');
}

// ── ④ 真的接上了：走一遍 normalizeLocalePages（两种形状各一次）─────────────────────────────
// 🔴 抽出来的函数好使 ≠ 它被接线了。这一格问的是「构建那条路上真的会经过它吗」，两种页面形状
// （老站的 `sections` / 新站的 `blocks`）分别问一次。
for (const [shapeName, page] of [
  ['sections（老站）', { slug: 'about', sections: [{ type: 'values-grid', data: { headline: 'H' } }] }],
  ['blocks（新站）', { slug: 'about', blocks: [{ id: 'x', type: 'benefits-list', role: 'optional', data: { headline: 'H' } }] }],
]) {
  let out;
  try {
    out = normalizeLocalePages([page], {}, 'en', {});
  } catch (e) {
    bad(`${shapeName}: normalizeLocalePages 抛了 ${e.message}`);
    continue;
  }
  const b = out[0].blocks[0];
  if (b.type !== 'card-group' || !b.__legacyType) {
    bad(`${shapeName}: 归一化之后没走别名（type=${b.type} __legacyType=${b.__legacyType}）`);
  } else ok(`${shapeName}: 归一化之后 type=${b.type} · __legacyType=${b.__legacyType} · role=${b.role}`);
}

// ── ⑥ #1143：`[string]` 升成 `[{title}]`，两条路各问一次 ────────────────────────────────────
// 🔴 两条路是**不同的**代码分支：`checklist` 走别名的改名分支；直接写通用块名字的那条在
//    applyAlias 里提前返回（「键 == 它自己的 type」），归一化必须在它之后也发生。
//    AC3 的反向那一半就是第二条：喂裸字符串数组给新 type 名，读数要么被拒、要么被规范化。
{
  const viaAlias = applyAlias({ type: 'checklist', data: { headline: 'H', items: ['甲', '乙'], variant: 'cards' } });
  const want = JSON.stringify([{ title: '甲' }, { title: '乙' }]);
  if (JSON.stringify(viaAlias.data.items) !== want) {
    bad(`checklist 的 [string] 没升成 [{title}]: ${JSON.stringify(viaAlias.data.items)}`);
  } else if (viaAlias.data.variant !== 'cards') {
    bad('「继续忽略」的 variant 在归一化时被删掉了');
  } else ok(`checklist: items 升成 ${want} · variant 原样留着`);

  const direct = applyAlias({ type: 'card-group', data: { items: ['裸串'] } });
  if (JSON.stringify(direct.data.items) !== JSON.stringify([{ title: '裸串' }])) {
    bad(`直接写通用块名字时裸字符串没被规范化: ${JSON.stringify(direct.data.items)}`);
  } else ok('通用块自己那条路上，裸字符串数组也被规范化成 [{title}]（AC3 反向那一半）');

  // 反向对照：本来就是对象的，一个字节都不动（同一个数组引用）—— 批 1 那两条路要靠这一条
  const objs = [{ title: 'a', description: 'b' }];
  const untouched = applyAlias({ type: 'values-grid', data: { items: objs } });
  if (untouched.data.items !== objs) {
    bad('items 本来就是对象时归一化仍然换掉了那个数组 —— 批 1 的「逐字节不变」会被这一步弄假');
  } else ok('反向对照: items 本来就是对象时，归一化是恒等的（同一个数组引用）');
}

// ── ⑦ #1143：`highlights` 这个槽位名映到 `items`，而且通用块上没有它 ──────────────────────────
{
  const out = applyAlias({ type: 'service-highlights', data: { headline: 'H', highlights: [{ title: 't', description: 'd', features: ['f'] }] } });
  if (Object.prototype.hasOwnProperty.call(out.data, 'highlights')) {
    bad('service-highlights 的 highlights 槽位没被改名 —— 通用块读 data.items，条目一个都画不出来');
  } else if (!Array.isArray(out.data.items) || out.data.items[0].title !== 't') {
    bad(`highlights → items 改名之后内容不对: ${JSON.stringify(out.data)}`);
  } else if (out.data.items[0].features[0] !== 'f') {
    bad('子项的 features 字段在改名时丢了');
  } else ok('service-highlights: highlights → items（子项的 features 原样跟过来）');

  // 🔴 §2.5 坑三那一族：磁盘上写着改名的**目标**名字、而**源**名字没有。那个键老组件从来没读过
  //    （本票删掉的 `ServiceHighlightsSection` 读 `data.highlights`），所以那一块今天在页面上是空的；
  //    别名把 `items` 变成通用块真会读的槽位之后，不删它 = 线上凭空长出内容，而没人决定过。
  const misKeyed = applyAlias({ type: 'service-highlights', data: { headline: 'H', items: [{ title: '老组件从没读过的内容' }], variant: 'tabs' } });
  if (Object.prototype.hasOwnProperty.call(misKeyed.data, 'items')) {
    bad(`磁盘写成 items(而没有 highlights)时，那个键被接上了: ${JSON.stringify(misKeyed.data.items)} —— 线上会凭空多出内容`);
  } else if (misKeyed.data.variant !== 'tabs' || misKeyed.data.headline !== 'H') {
    bad(`删 items 时把别的字段也带走了: ${JSON.stringify(misKeyed.data)}`);
  } else ok('磁盘写成 items 而没有 highlights ⟹ 那个键被丢掉，这一块仍然是空的（§2.5 坑三）');

  // 反向对照：两个都写了，`highlights` 赢 —— 老组件读的就是它
  const both = applyAlias({ type: 'service-highlights', data: { highlights: [{ title: '真内容' }], items: [{ title: '看不见的' }] } });
  if (both.data.items[0].title !== '真内容') {
    bad(`两个键都在时赢的不是 highlights: ${JSON.stringify(both.data.items)}`);
  } else ok('反向对照: 两个键都写了时 highlights 赢（老组件读的就是它）');

  const manifest = require(path.join(NEXT, 'blocks', 'card-group.json'));
  const slots = Object.keys(manifest.slots || {});
  const lists = slots.filter((k) => manifest.slots[k].kind === 'list');
  if (slots.includes('highlights')) bad('通用块的 manifest 上还有 highlights 这个槽位（AC4）');
  else if (lists.length !== 1) bad(`通用块的 manifest 上有 ${lists.length} 个列表槽位（${lists.join(' ')}）—— 只能有一种`);
  else ok(`通用块 manifest 的槽位是 {${slots.join(' ')}}，列表槽位只有 ${lists[0]}（AC3/AC4）`);
}

// ── ⑤ 反向对照：把别名的「带老词汇」那一半拿掉，上面第 ③ 格必须红 ──────────────────────────
// 🔴 没有这一格，前面那些 ✅ 说明不了它们**分得开**两种实现。
{
  const rigged = { ...applyAlias({ type: 'values-grid', data: {} }) };
  delete rigged.__legacyType;
  const vocab = rigged.__legacyType || rigged.type;
  if (vocab === 'values-grid') bad('反向对照没生效 —— 拿掉 __legacyType 之后词汇还是老名字，说明上面那几格测的不是它');
  else ok(`反向对照: 拿掉 __legacyType 之后词汇变成 "${vocab}" ⟹ 老站会吐新类名 ⟹ 那一半是承重的`);
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
    const out = applyAlias({ type: 'checklist', data: { headline: 'H', items: ['甲', el, '乙'] } });
    const got = JSON.stringify(out.data.items);
    const want = JSON.stringify([{ title: '甲' }, { title: '乙' }]);
    if (got !== want) bad(`items 里混进 ${name} 之后没被滤掉: ${got}`);
    else ok(`items 里混进 ${name} ⟹ 滤掉，剩下的照旧升成 ${want}`);
  }

  // 全是画不出来的元素 ⟹ 空数组。组件画一个空的组，构建不炸（这一支走的是「没有一个字符串」那条
  // 提前返回的老路径，所以它是**另一条**分支，不许只测上面那一种）。
  const allBad = applyAlias({ type: 'values-grid', data: { headline: 'H', items: [null, null] } });
  if (JSON.stringify(allBad.data.items) !== '[]') {
    bad(`全是 null 时没被滤空: ${JSON.stringify(allBad.data.items)}`);
  } else ok('items 全是 null ⟹ 变成 []（这一支不经过「有字符串」那个判断，是另一条分支）');

  // 🔴 反向对照之一：良构的纯对象数组仍然是**同一个数组引用**。加过滤最容易弄丢的就是它 ——
  //    无条件 `filter().map()` 每次都造新数组，#1143 的「老站重建逐字节不变」当场没。
  const objs = [{ title: 'a', description: 'b' }];
  const untouched = applyAlias({ type: 'benefits-list', data: { headline: 'H', items: objs } });
  if (untouched.data.items !== objs) {
    bad('良构的纯对象数组被过滤那一步换掉了引用 —— #1143 的逐字节不变会被这一步弄假');
  } else ok('反向对照: 良构的纯对象数组仍是同一个数组引用（过滤没把恒等那条路弄丢）');

  // 🔴 反向对照之二：五个归到 card-group 的 type **逐个**都要被保护，不许抽一个代表。
  //    判据从别名表现算，不写死名字：明天多一个块，这一格自己跟着变宽。
  const generics = Object.keys(BLOCK_ALIASES).filter((k) => BLOCK_ALIASES[k].type === 'card-group');
  if (generics.length < 5) bad(`归到 card-group 的 type 只数出 ${generics.length} 个（${generics.join(' ')}）—— 分母不对，下面那一格说明不了「每个都保护」`);
  else {
    const leaked = generics.filter((t) => {
      const slot = t === 'service-highlights' ? 'highlights' : 'items';
      const r = applyAlias({ type: t, data: { headline: 'H', [slot]: ['甲', null] } });
      return (r.data.items || []).some((x) => x === null);
    });
    if (leaked.length) bad(`这些 type 上 null 还是穿过去了: ${leaked.join(' ')}`);
    else ok(`归到 card-group 的 ${generics.length} 个 type（${generics.join(' ')}）逐个喂 null，一个都没漏过`);
  }
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
