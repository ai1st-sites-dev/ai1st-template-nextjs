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

let validateSite; let loadManifests; let aliases;
try {
  ({ validateSite, loadManifests } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js')));
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
// 槽名从 manifest 取，不写死映射 —— #1162 把 `service-highlights` 删了（它的槽叫 highlights），
// 而这里原来是一张写死的两分支表。今天仍有 timeline(events) / process-steps(steps) /
// team-grid(members) 这些槽名不叫 items 的块，所以判据换成「问 manifest」，加块也不用回来改这行。
const slotOf = (t) => {
  const m = loadManifests().get(t);
  const lists = Object.keys((m && m.slots) || {}).filter((k) => m.slots[k].kind === 'list');
  return lists[0] || 'items';
};

// ── ① 分母先说出来 ────────────────────────────────────────────────────────────────────────────
// 🔴 #1162 换了这一格的分母。原来数的是「归到 card-group 的 type 有几个」并要求 ≥5（那 5 个是
//    通用块自己 + 四个老名字别名）。别名层退役之后那个数按构造是 1，据它判红只会天天红一次。
//    真正该防的还是同一件事 —— **下面那些格子有没有东西可查** —— 而今天的分母是「有列表槽的块有几种」
//    （⑦ 那几格逐种问它们的槽级检查会不会开火）。它今天远大于 1，而且加块会自己长。
const listyBlocks = [...loadManifests().entries()]
  .filter(([, m]) => Object.values(m.slots || {}).some((sl) => sl.kind === 'list'))
  .map(([t]) => t);
if (listyBlocks.length < 5) {
  bad(`带列表槽的块只数出 ${listyBlocks.length} 种（${listyBlocks.join(' ')}）—— 分母不对，下面的读数不作数`);
} else {
  ok(`带列表槽的块有 ${listyBlocks.length} 种（⑦ 那几格的分母）· 归到 card-group 的词汇 ${Object.keys(aliases).length} 行`);
}

// ②④ 那两格的射程：归到通用块 card-group 的 type。
// 🔴 **这个数 #1162 从 5 掉到 1，而那是本票有意的收窄，写在这里而不是让它静默发生**：
//    别名层退役之前它是「通用块自己 + `values-grid` / `benefits-list` / `checklist` /
//    `service-highlights` 四个别名」= 5 个；四个老 type 名删掉之后只剩通用块自己。
//    ⟹ ②④ 现在各测 1 个 type（原来 5 个）。**槽名不叫 items 的那一维没有跟着变窄** ——
//    它在 ⑦，射程是 timeline(events) / process-steps(steps) / team-grid(members) / card-group(items)。
const generics = Object.keys(aliases).filter((k) => aliases[k].type === 'card-group');
if (generics.length === 0) bad('归到 card-group 的 type 是 0 个 —— ②④ 什么都没查');

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

// ── ⑥ 槽的值整个不是数组 —— #1154 改了这一格的答案 ────────────────────────────────────────────
//
// 🔴 这一格 #1152 写的是「第 ⑤ 条一声不出，它交给别的检查」。而 #1154 量到的是：**没有别的检查**。
//    ① 那条只问「这个槽是不是空的」，`items: "甲、乙"` 在它眼里是有值的 ⟹ 两条都放行，
//    构建期当场炸 `a.items?.map is not a function`。所以现在由这同一条检查自己报，
//    报的是**槽级**的那句（"不是列表"），条目级那句（"条目是…"）仍然不许出现 —— 没有条目可数。
console.log('── ⑥ 槽的值整个不是数组 ⟹ 报槽级那一句，不报条目级那一句（#1154）');
{
  const r = run('card-group', 'items', 'not-an-array');
  const slotLevel = r.problems.filter((p) => p.includes('不是列表'));
  const itemLevel = r.problems.filter((p) => p.includes('条目是'));
  if (slotLevel.length === 1) ok(`items 是个字符串 ⟹ ${slotLevel[0]}`);
  else bad(`槽级那一句没出现（或出现多次）: ${JSON.stringify(r.problems)}`);
  if (itemLevel.length === 0) ok('条目级那一句没出现（一个条目都没有，数它是无中生有）');
  else bad(`条目级那一句也开火了: ${JSON.stringify(itemLevel)}`);
}

// ── ⑦ #1154：槽级那条也按 kind:list 走，槽名不叫 items 的一样管 ───────────────────────────────
// 🔴 PM 在 #1154 立票留言里记过一次作废的读数：他拿 `timeline` 配了槽名 `items`，而它的列表槽叫
//    `events` ⟹ 报的是「缺必填槽 events」，看起来像「这个块没问题」。槽名要从 manifest 取。
console.log('── ⑦ 槽名不叫 items 的块，槽级那条一样开火（#1154）');
for (const [type, slot] of [['timeline', 'events'], ['process-steps', 'steps'], ['team-grid', 'members'], ['card-group', 'items']]) {
  const r = run(type, slot, 'not-an-array');
  const hit = r.problems.filter((p) => p.includes(`槽 "${slot}" 不是列表`));
  if (hit.length === 1) ok(`${type}(${slot}): ${hit[0]}`);
  else bad(`${type}(${slot}) 没报槽级那一句: ${JSON.stringify(r.problems)}`);
}
// 反向对照：同一个槽换成正常数组，一条 problem 都不该有
for (const [type, slot] of [['timeline', 'events'], ['card-group', 'items']]) {
  const r = run(type, slot, [{ title: 'a' }]);
  if (r.problems.length === 0) ok(`反向对照 ${type}(${slot}): 正常数组放行（0 条 problem）`);
  else bad(`反向对照 ${type}(${slot}) 被误伤: ${JSON.stringify(r.problems)}`);
}
// `undefined` / `null` 仍然归 ① 管 —— 槽级这条不许抢它的活（选填槽没填不是错）
{
  const r = validateSite({
    pages: [{
      slug: 'probe',
      blocks: [
        { id: 't', type: 'timeline', region: 'content', weight: 10, data: { headline: 'H', events: [{ year: 'y' }], subheadline: 'S' } },
        { id: 'c', type: 'contact-info', region: 'content', weight: 20, data: { headline: 'Contact' } },
      ],
    }],
    industry: 'auto repair',
  });
  const mine = r.problems.filter((p) => p.includes('不是列表'));
  if (mine.length === 0) ok('没写的选填列表槽不会被槽级那条碰（它归第 ① 条管）');
  else bad(`没写的槽也被报了: ${JSON.stringify(mine)}`);
}

// ── ⑧ #1154：`blocks` 数组里那一格根本不是块 ⟹ 报 problem，不许抛异常 ─────────────────────────
//
// 🔴 判据是**不抛**，不只是「有 problem」。抛出去的话它冒到 `create-site.js` **顶层**（不在任何函数里）那句
//    `main().catch(err => {`（`create-site.js` 末尾那三行）—— 建站直接死，连重试都走不到。
//    📌 #1157（来源 #1154）更正：这里原来的落点是 `§generateContent` 里那句 `debug('[blocks] 第一次输出有 …')`，
//    而它只是打日志；开出重试的是 `if (issues.length || skinIssues.length)`，真正发调用的是它下面那次
//    `callAIWithRetry({ … })`。本文件下面第 ⑨ / ⑩ 节指的也是这同一个决定点，三句原来对不上。
//    🔴 这里按**内容**指、不按行号指：改这段注释本身就会把行号挤走（#1239 条 40 把本文件指向
//    `create-site.js` 的行号引用全部换成了函数名 / 代码片段，这一句是最后残留的那几处之一）。
console.log('── ⑧ blocks 数组里混进不是块的东西（#1154）');
for (const [what, entry] of [['null', null], ['一个字符串', 'x'], ['一个数组', [1]], ['一个数字', 7]]) {
  let r = null; let threw = null;
  try {
    r = validateSite({
      pages: [{
        slug: 'probe',
        blocks: [entry, { id: 'c', type: 'contact-info', region: 'content', weight: 20, data: { headline: 'Contact' } }],
      }],
      industry: 'auto repair',
    });
  } catch (e) { threw = e; }
  if (threw) { bad(`${what}: 抛了 ${threw.constructor.name}: ${threw.message} —— 建站会死在顶层 catch`); continue; }
  const hit = r.problems.filter((p) => p.includes('不是一个块'));
  if (hit.length === 1) ok(`${what} ⟹ ${hit[0]}`);
  else bad(`${what}: 没报「不是一个块」: ${JSON.stringify(r.problems)}`);
}
// 反向对照：两格都是正经块 ⟹ 这条一声不出
{
  const r = validateSite({
    pages: [{
      slug: 'probe',
      blocks: [
        { id: 't', type: 'text-block', region: 'content', weight: 10, data: { headline: 'H', body: 'B' } },
        { id: 'c', type: 'contact-info', region: 'content', weight: 20, data: { headline: 'Contact' } },
      ],
    }],
    industry: 'auto repair',
  });
  const mine = r.problems.filter((p) => p.includes('不是一个块'));
  if (mine.length === 0) ok('反向对照: 两格都是正经块时，第 ⑧ 条一声不出');
  else bad(`良构也被报了: ${JSON.stringify(mine)}`);
}

// ── ⑨ #1155：合法的 `{ "ref": … }` 条目不许被报成「没有这种块」──────────────────────────────────
//
// 🔴 为什么这条要有测试而不只是一次读数：假问题的代价不是「日志里多一行」。
//    `create-site.js §generateContent` 拿 `problems.length` 决定要不要让模型重写一遍，而重写之后这条问题
//    **还在**（它跟模型写得对不对无关）⟹ `switch (afterRetry({ … }))` 读到「第一次 1 条、重试后还是
//    1 条」判成 `fatal`：一个合法的 ref 条目让整次建站死掉。取这份读数时两臂实测过
//    （改之前 problems=1 / 模型调用 1 次 / 然后 fatal，改之后 problems=0 / 模型调用 0 次）。
//
// 🔴 三格反向对照缺一不可 —— 它们各自守着一个「顺手写宽了」的方向：
//    `{ ref: 7 }` 守「ref 必须是字符串」· `{ ref, type }` 守「构建期 blocks.js:387-389 会 throw
//    的那个自相矛盾形状不许在建站期被放行」· `{ type: 没有的块名 }` 守这条检查本身还活着。
console.log('── ⑨ 合法的 ref 条目不许被误报（#1155）');
{
  const GOOD = { id: 'c', type: 'contact-info', region: 'content', weight: 20, data: { headline: 'Contact' } };
  const noSuch = (r) => r.problems.filter((p) => p.includes('没有这种块'));
  const probe = (entry) => validateSite({
    pages: [{ slug: 'probe', blocks: [entry, GOOD] }],
    industry: 'auto repair',
  });

  for (const [what, entry] of [
    ['{ ref: "our-team" }', { ref: 'our-team' }],
    ['ref 条目上还写了 data / weight / role', { ref: 'our-team', data: { headline: 'z' }, weight: 5, role: 'optional' }],
  ]) {
    const r = probe(entry);
    if (r.problems.length === 0) ok(`${what} ⟹ 0 条 problem`);
    else bad(`${what} 被误报了: ${JSON.stringify(r.problems)}`);
  }

  for (const [what, entry] of [
    ['{ ref: 7 }（ref 不是字符串）', { ref: 7 }],
    ['{ ref: "x", type: "不存在的块名" }（构建期 blocks.js 会 throw 的形状）', { ref: 'x', type: '不存在的块名' }],
    ['{ type: "不存在的块名" }（这条检查本身还活着）', { type: '不存在的块名' }],
  ]) {
    const hit = noSuch(probe(entry));
    if (hit.length === 1) ok(`反向对照 ${what} ⟹ ${hit[0]}`);
    else bad(`反向对照 ${what} 没照旧报: ${JSON.stringify(hit)}`);
  }
}

// ── ⑩ 第 ④ 条：站级块提供的块也算「整个站里有」（#1156）────────────────────────────────────────
//
// 🔴 为什么这条要有测试：第 ④ 条问的是**整个站**，而它此前只数页面自己写下的块。
//    `{ "ref": "<id>" }` 没有 `type`，在 `!m` 那一支就 continue 走了 ⟹ 一个 `contact-info` 只由
//    站级块提供的站会被报「整个站里没有 contact-info」，而那个块在产物里是有的。代价跟 ⑨ 同一族：
//    `create-site.js §generateContent` 拿 problems 决定要不要让模型重写，而这条修不掉 ⟹ `afterRetry` 判
//    `fatal`，整次建站死（#1155 QA1 圈外发现 ①，#1155 交付之后实测仍复现）。
//
// 🔴 三格反向对照缺一不可，各守一个「顺手写宽了」的方向：
//    「站里真的没有」守这条检查还活着 ·「ref 指不到 id」守别把指不到的 ref 也算成有
//    （构建期是 note 一句 + 跳过，页面上不会有这一块）·`{ ref: 7 }` 守「ref 必须是字符串」。
console.log('── ⑩ 站级块提供的块，第 ④ 条也要看得见（#1156）');
{
  const HERO = { type: 'hero', data: {
    headline: 'h', subheadline: 's',
    ctaPrimary: { label: 'a', href: '/a' }, ctaSecondary: { label: 'b', href: '/b' } } };
  const LIB = { 'shared-contact': { type: 'contact-info', data: { headline: 'Contact' } } };
  const VIS = { 'shared-contact': { type: 'contact-info', visibility: ['*'], data: { headline: 'Contact' } } };
  const missing = (entry, siteBlocks) => validateSite({
    pages: [{ slug: 'home', blocks: entry ? [entry, HERO] : [HERO] }],
    industry: 'auto repair',
    siteBlocks,
  }).problems.filter((p) => p.includes('整个站里没有 "contact-info"'));

  for (const [what, entry, lib] of [
    ['contact-info 只由站级 ref 提供', { ref: 'shared-contact' }, LIB],
    ['contact-info 只由站级块的 visibility:["*"] 提供', null, VIS],
  ]) {
    const hit = missing(entry, lib);
    if (hit.length === 0) ok(`${what} ⟹ 不再报「整个站里没有 contact-info」`);
    else bad(`${what} 仍被误报: ${JSON.stringify(hit)}`);
  }

  for (const [what, entry, lib] of [
    ['站里真的没有 contact-info（这条检查本身还活着）', null, {}],
    ['ref 指向的 id 在块库里不存在', { ref: 'no-such-id' }, LIB],
    ['{ ref: 7 }（ref 不是字符串）', { ref: 7 }, LIB],
    ['站级块的 visibility 不命中这一页', null, { x: { type: 'contact-info', visibility: ['about'] } }],
  ]) {
    const hit = missing(entry, lib);
    if (hit.length === 1) ok(`反向对照 ${what} ⟹ 照旧报`);
    else bad(`反向对照 ${what} 没照旧报: ${JSON.stringify(hit)}`);
  }
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
