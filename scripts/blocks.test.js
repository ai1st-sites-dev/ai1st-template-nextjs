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

// ── ① 每一行写齐 §2.1 那四件事 ──────────────────────────────────────────────────────────────────
for (const name of Object.keys(BLOCK_ALIASES)) {
  const row = BLOCK_ALIASES[name];
  const missing = ['type', 'role', 'block_layout', 'data', 'headingId', 'parts']
    .filter((k) => !Object.prototype.hasOwnProperty.call(row, k));
  if (missing.length) bad(`${name}: 别名表这一行缺 ${missing.join(' / ')}`);
  else if (row.block_layout !== null) {
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

// ── ⑤ 反向对照：把别名的「带老词汇」那一半拿掉，上面第 ③ 格必须红 ──────────────────────────
// 🔴 没有这一格，前面那些 ✅ 说明不了它们**分得开**两种实现。
{
  const rigged = { ...applyAlias({ type: 'values-grid', data: {} }) };
  delete rigged.__legacyType;
  const vocab = rigged.__legacyType || rigged.type;
  if (vocab === 'values-grid') bad('反向对照没生效 —— 拿掉 __legacyType 之后词汇还是老名字，说明上面那几格测的不是它');
  else ok(`反向对照: 拿掉 __legacyType 之后词汇变成 "${vocab}" ⟹ 老站会吐新类名 ⟹ 那一半是承重的`);
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
