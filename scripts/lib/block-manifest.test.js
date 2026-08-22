#!/usr/bin/env node
/**
 * block-manifest.test.js — `validateSite` 的第 ⑤ 条：列表槽里的条目只能是字符串或对象（#1152）。
 *
 * 跑法:  node scripts/lib/block-manifest.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么要有这份文件 ═══════════════════════════════════════════════════════════════════════════
 * `validateSite` 有六条检查，在 #1152 之前**一个测试文件都没提到过它**
 * （`grep -rln validateSite scripts/**\/*.test.js` = 0）。而它的失败方向是硬的：
 * 一个 `null` 混进条目列表，建站期放行、构建期在预渲染那一页当场炸
 * `Cannot read properties of null (reading 'title')`，整个站建不出来。
 *
 * ══ 🔴 夹具的两个坑（都是取这份读数时真踩过的，别再踩）═══════════════════════════════════════════
 * 判据是「带 null 那一臂被拒、良构那一臂放行」。**两臂读到同一个值就说明尺子坏了**，而下面这两件事
 * 各自都能让两臂一起变成「拒了」，跟 null 一点关系都没有：
 *   ① 页面里没有 `contact-info` ⟹ 第 ④ 条「整个站里没有它」对两臂都开火。
 *   ② 给 `contact-info` 写 `role: 'optional'` ⟹ 第 ② 条「只能加不能降」对两臂都开火
 *      （它的 roleDefault 是 essential）。**不写 role** 才走默认、那条不开火。
 * 所以下面的夹具带一个不写 `role` 的 `contact-info`，而且最后一格专门核「两臂真的分得开」。
 */

'use strict';

const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let validateSite; let aliases;
try {
  ({ validateSite } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js')));
  aliases = require(path.join(NEXT, 'src', 'lib', 'sections', 'block-aliases.json'));
} catch (e) {
  die(`require 失败: ${e.message}`);
}

/** 一张只为这个判据存在的页面。`dir` 不传 —— create-site.js 也不传，走同一个默认。 */
function pageWith(type, slot, items) {
  return {
    slug: 'probe',
    blocks: [
      { id: 'p', type, role: 'optional', region: 'content', weight: 10, data: { headline: 'H', [slot]: items } },
      // 🔴 不写 role（见文件头坑 ②），只为让第 ④ 条闭嘴（坑 ①）
      { id: 'c', type: 'contact-info', region: 'content', weight: 20, data: { headline: 'Contact' } },
    ],
  };
}
const run = (type, slot, items) => validateSite({ pages: [pageWith(type, slot, items)], industry: 'auto repair' });
const slotOf = (t) => (t === 'service-highlights' ? 'highlights' : 'items');

// ── ① 分母先说出来：归到 card-group 的有几个 type ────────────────────────────────────────────────
// 表空了 / 只剩一个的话，下面每一格都会「全过」，而那是什么都没查。
const generics = Object.keys(aliases).filter((k) => aliases[k].type === 'card-group');
if (generics.length < 5) {
  bad(`归到 card-group 的 type 只数出 ${generics.length} 个（${generics.join(' ')}）—— 分母不对，下面的读数不作数`);
} else {
  ok(`归到 card-group 的 type 有 ${generics.length} 个：${generics.join(' ')}`);
}

// ── ② 带 null 的那一臂：逐个 type 都要被拒，而且报文要指名槽位和第几个 ────────────────────────
console.log('── ② 条目里混进 null ⟹ 拒，报文指名槽位 + 第几个（#1152 AC1）');
for (const t of generics) {
  const slot = slotOf(t);
  const r = run(t, slot, ['甲', null, '乙']);
  const hit = r.problems.filter((p) => p.includes(`槽 "${slot}"`) && p.includes('第 2 个条目是 null'));
  if (hit.length === 1) ok(`${t}: ${hit[0]}`);
  else bad(`${t}: 期望正好一条指名「槽 "${slot}" 的第 2 个条目是 null」的 problem，实际 ${r.problems.length} 条: ${JSON.stringify(r.problems)}`);
}

// ── ③ 别的画不出来的元素也要被拒，而且要把它是什么说出来 ─────────────────────────────────────
console.log('── ③ null 之外的几种（报文要说出它是什么，不是一句「不合法」）');
for (const [name, el, want] of [['数字', 7, '一个 number'], ['布尔', true, '一个 boolean'], ['嵌套数组', ['x'], '一个数组']]) {
  const r = run('card-group', 'items', ['甲', el]);
  const hit = r.problems.filter((p) => p.includes(`第 2 个条目是 ${want}`));
  if (hit.length === 1) ok(`${name} ⟹ ${hit[0]}`);
  else bad(`${name}: 没有一条报文说它是「${want}」，实际: ${JSON.stringify(r.problems)}`);
}

// ── ④ 反向对照：良构那一臂必须放行 ─────────────────────────────────────────────────────────────
// 🔴 这一格是整份文件的判别力来源。少了它，一个「无论什么都拒」的实现也能让 ② ③ 全绿。
console.log('── ④ 反向对照：良构的两种形状都要放行');
for (const t of generics) {
  const slot = slotOf(t);
  const strs = run(t, slot, ['甲', '乙']);
  const objs = run(t, slot, [{ title: 'a', description: 'b' }]);
  if (strs.problems.length === 0 && objs.problems.length === 0) {
    ok(`${t}: 裸字符串数组、纯对象数组 两种都放行（0 条 problem）`);
  } else {
    bad(`${t}: 良构却被拒 —— 字符串臂 ${JSON.stringify(strs.problems)} / 对象臂 ${JSON.stringify(objs.problems)}`);
  }
}

// ── ⑤ 这条检查按【槽的 kind】走，不按块的名字 ─────────────────────────────────────────────────
// 明天多一个带 list 槽的块，它默认就在保护里。判据：拿一个**不在别名表里**的块试一次。
console.log('── ⑤ 射程按 kind:list，不按块名');
{
  const other = validateSite({
    pages: [{
      slug: 'probe',
      blocks: [
        { id: 'f', type: 'faq-accordion', region: 'content', weight: 10, data: { headline: 'H', items: ['问答', null] } },
        { id: 'c', type: 'contact-info', region: 'content', weight: 20, data: { headline: 'Contact' } },
      ],
    }],
    industry: 'auto repair',
  });
  const hit = other.problems.filter((p) => p.includes('第 2 个条目是 null'));
  if (hit.length === 1) ok(`别名表外的块（faq-accordion）也被查了: ${hit[0]}`);
  else bad(`faq-accordion 的 list 槽没被查 —— 这条检查被写成按块名了。实际: ${JSON.stringify(other.problems)}`);
}

// ── ⑥ 不是数组的槽不许被这条检查碰（它有自己的检查，别抢） ────────────────────────────────────
console.log('── ⑥ 槽里不是数组时，这条检查什么都不说');
{
  const r = run('card-group', 'items', 'not-an-array');
  const mine = r.problems.filter((p) => p.includes('条目是'));
  if (mine.length === 0) ok(`items 是个字符串时，第 ⑤ 条一声不出（它交给别的检查；本条产出 ${r.problems.length} 条别的 problem）`);
  else bad(`items 不是数组时第 ⑤ 条也开火了: ${JSON.stringify(mine)}`);
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
