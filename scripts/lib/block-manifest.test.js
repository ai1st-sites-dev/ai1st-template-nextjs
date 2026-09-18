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
//    📌 #1372 把 `timeline` 这个块删了，下面那几格改用 `blog-preview`/`posts` —— 同样是
//    「槽名不叫 items」的块，这一条守的性质没变。
console.log('── ⑦ 槽名不叫 items 的块，槽级那条一样开火（#1154）');
for (const [type, slot] of [['blog-preview', 'posts'], ['process-steps', 'steps'], ['team-grid', 'members'], ['card-group', 'items']]) {
  const r = run(type, slot, 'not-an-array');
  const hit = r.problems.filter((p) => p.includes(`槽 "${slot}" 不是列表`));
  if (hit.length === 1) ok(`${type}(${slot}): ${hit[0]}`);
  else bad(`${type}(${slot}) 没报槽级那一句: ${JSON.stringify(r.problems)}`);
}
// 反向对照：同一个槽换成正常数组，一条 problem 都不该有
for (const [type, slot] of [['blog-preview', 'posts'], ['card-group', 'items']]) {
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
        { id: 't', type: 'blog-preview', region: 'content', weight: 10, data: { headline: 'H', posts: [{ title: 'y' }], subheadline: 'S' } },
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

// ── #1349 —— 每份 manifest 都有一个给用户看的名字 ───────────────────────────────────────────────
//
// 🔴 两臂，而且反臂是**真跑一次校验器**，不是读一遍字段。少一个 displayName 的失败方向是静默的：
//    点选检查器的面板会显示空白（或退化成 `hero` 这种内行黑话），而没有任何一格会红。
console.log('\n── #1349 每个块都有 displayName');
{
  const fsx = require('fs');
  const osx = require('os');
  const BLOCKS = path.join(NEXT, 'blocks');

  // ① 正臂：盘上这些全都有，而且是非空字符串、互不相同。
  //    🔴 数从 `all.length` 现取，别写死：#1353 把外壳区也变成块之后是 34 份，而写死的那个数
  //    只会让成功那行**印错**（判据在 dupes 上，不会红）—— 一个不会红的错读数比没有更坏。
  const all = [...loadManifests().entries()];
  const missingName = all.filter(([, m]) => typeof m.displayName !== 'string' || !m.displayName)
    .map(([t]) => t);
  if (missingName.length === 0) ok(`${all.length} 份 manifest 全都有非空的 displayName`);
  else bad(`这几份没有 displayName: ${missingName.join(' / ')}`);

  // 🔴 重名要当场红：面板上两个不同的块显示同一个名字，老板点了两下看不出自己点中了哪个 ——
  //    而那一格看起来就像「点选没生效」。
  const seen = new Map();
  const dupes = [];
  for (const [t, m] of all) {
    if (seen.has(m.displayName)) dupes.push(`${m.displayName} (${seen.get(m.displayName)} / ${t})`);
    else seen.set(m.displayName, t);
  }
  if (dupes.length === 0) ok(`${all.length} 个 displayName 互不相同`);
  else bad(`displayName 重名: ${dupes.join(' · ')}`);

  // 🔴 而且不许拿类型原文顶替（CLAUDE.md 的术语冻结：用户可见 UI 不出现内行黑话）。
  const jargon = all.filter(([t, m]) => m.displayName === t).map(([t]) => t);
  if (jargon.length === 0) ok('没有一份把 displayName 写成 type 原文');
  else bad(`这几份的 displayName 就是 type 原文: ${jargon.join(' / ')}`);

  // ② 反臂：把一份 manifest 的 displayName 删掉，`loadManifests()` 必须 throw，而且点名那个文件。
  //    夹具是**整个 blocks/ 的副本 + 配套的 public/shapes.css**（loadManifests 按 dir 的真路径推
  //    CSS 的位置，见它自己那段注释），不碰仓里的文件。
  const tmp = fsx.mkdtempSync(path.join(osx.tmpdir(), 'blk1349-'));
  try {
    // #1387 —— 一个块一个文件夹，整棵拷（逐文件拷会把形态子文件夹全丢掉）。
    fsx.cpSync(BLOCKS, path.join(tmp, 'blocks'), { recursive: true });

    const victim = path.join(tmp, 'blocks', 'hero', 'manifest.json');
    const m = JSON.parse(fsx.readFileSync(victim, 'utf-8'));
    delete m.displayName;
    fsx.writeFileSync(victim, JSON.stringify(m, null, 2));

    let threw = null;
    try { loadManifests(path.join(tmp, 'blocks')); } catch (e) { threw = e; }
    if (!threw) {
      bad('反臂: 删掉 hero 的 displayName 之后 loadManifests() 照样过了 —— 这道守卫不存在');
    } else if (!threw.message.includes('blocks/hero') || !threw.message.includes('displayName')) {
      bad(`反臂: 报了，但没同时点名文件和字段: ${threw.message}`);
    } else {
      ok(`反臂: 删掉 displayName ⟹ throw，且点名了 blocks/hero（${threw.message.slice(0, 60)}…）`);
    }
  } finally {
    fsx.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── #1352 校验器新增的三条：每一条弄坏一次，看它红不红 ──────────────────────────────────────────
//
// 🔴 三条都靠**在临时目录里造一份真的 blocks/**，然后跑真正的 `loadManifests` —— 不是直接调
//    `checkManifestShape`（它没导出，而且直接调等于绕开「这条路上真的会经过它吗」那一维）。
//    `loadManifests` 就是 create-site / sync-config 走的那个入口。
console.log('\n── ⑫ #1352 校验器新增的三条（每条弄坏一次，证明它会红）');
{
  const os = require('os');
  const fs = require('fs');
  const NEXTDIR = NEXT;

  // 造一棵最小的树：blocks/ 是真文件的整棵副本（#1387 起形态住在子文件夹里，所以要 recursive）。
  // 📌 不再软链 public/shapes.css —— `loadManifests` 不再读它（#1331 那道两向差集随 #1387 删了，
  //    形态清单就是子文件夹清单，两边按构造是同一份）。
  function sandbox(mutate) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-'));
    fs.cpSync(path.join(NEXTDIR, 'blocks'), path.join(root, 'blocks'), { recursive: true });
    if (mutate) mutate(root);
    return root;
  }
  const loadIn = (root) => {
    try {
      require(path.join(NEXTDIR, 'scripts', 'lib', 'block-manifest.js')).loadManifests(path.join(root, 'blocks'));
      return null;
    } catch (e) { return e.message; }
  };
  const editJson = (root, type, fn) => {
    const p = path.join(root, 'blocks', type, 'manifest.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
    fn(d);
    fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  };

  // 🔴 正臂先跑：没弄坏的那份必须过。少了它，下面三条红可能只是「这棵沙箱树本来就建不起来」。
  {
    const err = loadIn(sandbox(null));
    if (err) bad(`夹具不成立：没弄坏的那份就报了 —— ${err}`);
    else ok('正臂：原样复制一份 blocks/ ⟹ 校验通过（下面三条红才归因得到「是我弄坏的那一处」）');
  }

  const cases = [
    ['kind 写成词表外的值（url）',
     (root) => editJson(root, 'hero', (d) => { d.slots.headline.kind = 'url'; }),
     /kind 是 "url"/],
    ['editLabel 挂在 kind: image 上',
     (root) => editJson(root, 'hero', (d) => { d.slots.imageUrl.editLabel = 'Picture'; }),
     /不该有 editLabel/],
    ['新增一个 kind: text 的槽位，既没 editLabel 也不在例外名单',
     (root) => editJson(root, 'hero', (d) => {
       d.slots.brandNewTextSlot = { kind: 'text', required: false, promptOptional: true };
     }),
     /没有 editLabel/],
  ];
  for (const [what, mutate, want] of cases) {
    const err = loadIn(sandbox(mutate));
    if (!err) bad(`${what} ⟹ 没红`);
    else if (!want.test(err)) bad(`${what} ⟹ 红了，但报的不是这条：${err}`);
    else ok(`${what} ⟹ 红，并点名：${err.split('——')[0].trim()}`);
  }

  // 🔴 例外名单里写错一个名字也要红 —— 一个拼错的例外等于把那个槽位的检查**关掉**，
  //    而它看起来跟「已经豁免过了」一模一样（AC2 最后一句）。
  {
    const lib = path.join(NEXTDIR, 'scripts', 'lib', 'block-manifest.js');
    const src = fs.readFileSync(lib, 'utf-8');
    const marker = "'features-grid.columns',";
    if (!src.includes(marker)) {
      bad('夹具不成立：例外名单里找不到 features-grid.columns');
    } else {
      // 在内存里把名单改坏，用 Module 的编译钩子换掉那一份源码再重新 require。
      const broken = src.replace(marker, "'features-grid.colunms',");
      // 🔴 改坏的那份要放在**原文件旁边**，不能放 /tmp：这个模块里全是相对 require（`../blocks`），
      //    搬到别处它第一行就 `Cannot find module`，而那个红跟被测的那一维没有关系（试过了）。
      const tmp = path.join(path.dirname(lib), `.block-manifest-broken-${Date.now()}.js`);
      fs.writeFileSync(tmp, broken);
      let err = null;
      try {
        delete require.cache[tmp];
        require(tmp).loadManifests(path.join(NEXTDIR, 'blocks'));
      } catch (e) { err = e.message; }
      fs.rmSync(tmp, { force: true });
      // 🔴 这一格问的是「拼错了会不会静默放过」，**不问是哪一道检查开的火**。
      //    实测开火的是逐槽位那一条（`columns` 不再被豁免 ⟹ 它变成「kind: text 却没有 editLabel」），
      //    而不是我为名单本身加的那条 —— 因为逐槽位那条先抛。两条都红，但要说清是哪一条，
      //    不然下一个人会以为名单那条检查在这一格被验过了。
      if (err && /slots\.columns 是 kind: text 但没有 editLabel/.test(err)) {
        ok('例外名单里把 columns 拼成 colunms ⟹ 红（开火的是逐槽位那一条：columns 不再被豁免）');
      } else if (err) {
        bad(`拼错例外名单红了，但报的不是预期那条：${err}`);
      } else bad('把例外名单拼错了却没红 —— 那等于可以静默关掉任意一个槽位的检查');
    }
  }

  // 🔴 上面那一格开火的是逐槽位那条。**名单本身**那条（例外什么都没豁免）住在
  //    `nonEditableExceptionProblems` 里，它不挂在 `loadManifests` 上 —— 挂上去的话任何局部
  //    manifest 夹具一加载就抛（`block-catalog.test.js` 只造一份 alpha.json，实测被误伤 4 格）。
  //    所以它的家在这里，拿全套 blocks/ 喂它。
  {
    const { nonEditableExceptionProblems, NON_EDITABLE_TEXT_SLOTS } =
      require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
    const all = loadManifests(path.join(NEXT, 'blocks'));

    // 正臂：今天这份名单是干净的。
    const real = nonEditableExceptionProblems(all);
    if (real.length) bad(`今天的例外名单就有问题：${real.join(' / ')}`);
    else ok(`例外名单 ${NON_EDITABLE_TEXT_SLOTS.length} 项，每一项都在 blocks/ 里找得到同名槽位`);

    // 🔴 反臂两个方向，证明这条检查真会开火（不是一条从出生起就没响过的检查）。
    const ghostSlot = nonEditableExceptionProblems(all, ['hero.noSuchSlotAtAll']);
    const ghostBlock = nonEditableExceptionProblems(all, ['no-such-block.headline']);
    if (ghostSlot.length === 1 && /noSuchSlotAtAll/.test(ghostSlot[0])) {
      ok(`名单里写一个不存在的【槽位】⟹ 点名：${ghostSlot[0]}`);
    } else bad(`不存在的槽位没被点名：${JSON.stringify(ghostSlot)}`);
    if (ghostBlock.length === 1 && /no-such-block/.test(ghostBlock[0])) {
      ok(`名单里写一个不存在的【块】⟹ 点名：${ghostBlock[0]}`);
    } else bad(`不存在的块没被点名：${JSON.stringify(ghostBlock)}`);
  }
}

// ── ⑬ #1352 —— kind 词表跟 blocks/ 里实际在用的取值，两向差集都为空 ───────────────────────────
//
// 🔴 这一格治的是**常量表自己会过期**：本票第一版照票里手抄的六个写死，而 #1353 把顶栏页脚做成块
//    时带进了 `links` / `control`。过期的样子跟没过期一模一样，直到有人建站时撞上校验器当场拒。
console.log('\n── ⑬ #1352 kind 词表 ↔ blocks/ 实际在用的取值（两向）');
{
  const { slotKindVocabularyProblems, SLOT_KINDS } =
    require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  const all = loadManifests(path.join(NEXT, 'blocks'));

  // 正臂：今天对得上。顺带把分母说出来 —— 这一格要是在一份空 manifest 上跑，两向也都空。
  const counts = new Map();
  for (const [, m] of all) {
    for (const spec of Object.values(m.slots || {})) {
      if (spec && typeof spec.kind === 'string') counts.set(spec.kind, (counts.get(spec.kind) || 0) + 1);
    }
  }
  const real = slotKindVocabularyProblems(all);
  if (real.length) bad(`词表跟 blocks/ 对不上：${real.join(' / ')}`);
  else {
    ok(`词表 ${SLOT_KINDS.length} 个取值 ↔ ${all.size} 份 manifest 里实际在用的 ${counts.size} 个，两向差集都空`
      + `（${[...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}）`);
  }

  // 🔴 反臂一（AC 点名的那个）：词表里删掉 `links` ⟹ 红，并点名在用它的那三个槽位。
  const noLinks = slotKindVocabularyProblems(all, SLOT_KINDS.filter((k) => k !== 'links'));
  const named = ['footer.columns', 'footer.social', 'header.menu'];
  if (noLinks.length === 1 && named.every((n) => noLinks[0].includes(n))) {
    ok(`词表里删掉 links ⟹ 红，并点名：${noLinks[0]}`);
  } else bad(`删掉 links 之后没点名那三个槽位：${JSON.stringify(noLinks)}`);

  // 🔴 反臂二（另一向）：词表里多写一个谁都不用的取值 ⟹ 也要红。
  const ghost = slotKindVocabularyProblems(all, [...SLOT_KINDS, 'url']);
  if (ghost.length === 1 && /"url"/.test(ghost[0])) {
    ok(`词表里多写一个没人用的取值 ⟹ 红：${ghost[0]}`);
  } else bad(`多写一个没人用的取值没被点名：${JSON.stringify(ghost)}`);
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
