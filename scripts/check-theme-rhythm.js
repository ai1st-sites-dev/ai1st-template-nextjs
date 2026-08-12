#!/usr/bin/env node
// #983 — 把「Block 排布够不够多样」变成一个数得出来的读数。
//
// 用法(从 templates/nextjs 跑):  node scripts/check-theme-rhythm.js
// 退出码:0 = 四条断言全过 · 1 = 有断言不成立(逐条打出实际读数和反例)
//
// 为什么这四条:Chris 2026-08-12 换 assurance-teal 时页面骨架纹丝不动,分不清「设计如此」还是「坏了」。
// 「每套都有排布」治的是"有没有",而"有"不等于"看得出来" —— 30 套各写一份**一模一样**的排布同样满足
// 「30/30 都有」,而换装照旧看不出差别。所以还要量它们**互不相同**。
//
// 🔴 这四条里只有第 1 条同时是构建闸(在 sync-config.js 里,每次构建都跑);另外三条**只在这里**。
//    那是有意的:「这 30 套彼此够不够不一样」是注册表的设计性质,不是某一次建站的性质 —— 把它做成构建闸
//    会让一次正当的注册表改动因为跟被建的那个站毫无关系的理由而失败。
//
// 🔴 第 2/3/4 条的门槛(30/30 · ≥28 · ≥28)是 PM 在 #983 r1 代定、作者采纳的,依据是既有 15 套的实测
//    (组合 15/15 全不同 · hide 14/15 · order 14/15),等比放到 30 套即 30/30 与 28。②③ 因此各留了
//    一对重复的余量 —— 今天用掉的就是那一对(ocean-blue / coastal-teal 的 hide、midnight / sage-minimal
//    的 order),它们是 #962 就在的,本票没有动。
const { themes } = require('./themes');

const ids = Object.keys(themes);
const N = ids.length;
let fails = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => { console.log(`  ❌ ${msg}`); fails += 1; };

// hide 是一个**集合**(藏哪些,先后无意义) ⟹ 比之前先排序。order 是一个**序列**(顺序就是内容) ⟹ 不排序。
// 这两种口径不许混:拿排过序的 order 去去重会把「同一组 block 的两种排法」算成重复,而那正是本票要的多样性。
const hideKey = (id) => JSON.stringify([...(themes[id].rhythm ? themes[id].rhythm.hide || [] : [])].sort());
const orderKey = (id) => JSON.stringify(themes[id].rhythm ? themes[id].rhythm.order || [] : []);
const comboKey = (id) => `${hideKey(id)}|${orderKey(id)}`;

// 把重复的分组打出来 —— 只报一个数的话,修的人不知道该动哪一套。
function groups(keyOf) {
  const m = new Map();
  for (const id of ids) {
    const k = keyOf(id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(id);
  }
  return m;
}
const report = (m) => [...m.values()].filter(g => g.length > 1).map(g => g.join(' / ')).join(' · ');

console.log(`── #983 Block 排布:${N} 套`);

// ① 每套都有(这一条同时是构建闸,见文件头)
const missing = ids.filter(id => !themes[id].rhythm);
if (missing.length === 0) ok(`${N}/${N} 套逐套有 rhythm`);
else bad(`${missing.length} 套没有 rhythm:${missing.join(' ')}`);

// ② 组合(藏哪些 + 排哪个顺序)两两不同
const gc = groups(comboKey);
if (gc.size === N) ok(`组合(hide + order)去重 ${gc.size}/${N} —— 两两不同`);
else bad(`组合去重只有 ${gc.size}/${N},要求 ${N}/${N}。撞在一起的:${report(gc)}`);

// ③ 单看藏的那一组
const gh = groups(hideKey);
if (gh.size >= N - 2) ok(`hide 集合去重 ${gh.size}/${N}(门槛 ≥${N - 2})${report(gh) ? ' · 重复的:' + report(gh) : ''}`);
else bad(`hide 集合去重 ${gh.size}/${N},低于门槛 ${N - 2}。重复的:${report(gh)}`);

// ④ 单看顺序那一串
const go = groups(orderKey);
if (go.size >= N - 2) ok(`order 序列去重 ${go.size}/${N}(门槛 ≥${N - 2})${report(go) ? ' · 重复的:' + report(go) : ''}`);
else bad(`order 序列去重 ${go.size}/${N},低于门槛 ${N - 2}。重复的:${report(go)}`);

// 不是断言,是给人看的分布 —— 一个数达标但全靠某一种 block 撐着的话,这里看得出来。
const tally = (pick) => {
  const c = {};
  for (const id of ids) for (const t of pick(id)) c[t] = (c[t] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ');
};
console.log(`  ℹ️  被藏过的类型:${tally(id => (themes[id].rhythm || {}).hide || [])}`);
console.log(`  ℹ️  被排过的类型:${tally(id => (themes[id].rhythm || {}).order || [])}`);

if (fails === 0) { console.log(`✅ #983 rhythm: 四条全过`); process.exit(0); }
console.log(`❌ #983 rhythm: ${fails} 条断言不成立`);
process.exit(1);
