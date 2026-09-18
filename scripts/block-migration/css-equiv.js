#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// css-equiv.js — 「搬家前后这份 CSS 还是同一份吗」的两条判断（#1387）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 跑法:  node scripts/block-migration/css-equiv.js <改之前.css> <改之后.css>
//
// ① 等价：把每条规则按**单个选择器**摊开成「(媒体查询, 选择器) → 有序声明」，两边两向差集都要空。
//    字节相同做不到（理由在交付留言里：base.css 有 47 条规则的选择器同时覆盖好几个块，一块一份
//    floor.css 就必须把它们拆开），而这一条是「谁被写了什么」这件事有没有变。
// ② 顺序：同一个选择器出现在多条规则里时（base.css 259 个选择器里有 131 个这样），它们的先后
//    决定谁赢。这里逐个选择器比对它那串声明的**顺序**。
// ③ 层叠：相对顺序变了的规则两两配对，只留下「能命中同一个元素 且 写了同一个属性」的那些 ——
//    这一组必须是空的。不是断言，是把候选逐条列出来。
'use strict';

const fs = require('fs');
const postcss = require('postcss');

function flatten(css) {
  const root = postcss.parse(css);
  const rules = [];   // { at, sel, decls:[[prop,value]], idx }
  let idx = 0;
  const walk = (container, at) => {
    for (const node of container.nodes || []) {
      if (node.type === 'atrule') {
        walk(node, [...at, `@${node.name} ${node.params}`].join(' && '));
      } else if (node.type === 'rule') {
        const decls = node.nodes.filter((d) => d.type === 'decl')
          .map((d) => [d.prop, d.value + (d.important ? ' !important' : '')]);
        for (const sel of node.selectors) {
          rules.push({ at: at || '', sel: sel.trim().replace(/\s+/g, ' '), decls, idx });
        }
        idx += 1;
      }
    }
  };
  walk(root, '');
  return rules;
}

function bySelector(rules) {
  const m = new Map();
  for (const r of rules) {
    const k = `${r.at}|${r.sel}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r.decls.map(([p, v]) => `${p}:${v}`).join(';'));
  }
  return m;
}

/** 两条规则有没有可能命中同一个元素：类名 / data-block / data-shape 三种词的交集。 */
function couldShareElement(a, b) {
  const words = (s) => new Set([...s.matchAll(/\.[a-z0-9_-]+|\[[a-z-]+="[^"]*"\]/gi)].map((m) => m[0]));
  const wa = words(a); const wb = words(b);
  // 末端简单选择器（最后一个空格之后那一段）才是被写样式的那个元素。
  const tail = (s) => s.split(/\s+|>|\+|~/).filter(Boolean).pop() || s;
  const ta = words(tail(a)); const tb = words(tail(b));
  if (![...ta].some((w) => tb.has(w))) return false;
  // 两边都点名了 data-shape 且不同 ⟹ 命不中同一个元素。
  const shape = (s) => [...s.matchAll(/\[data-shape="([^"]+)"\]/g)].map((m) => m[1]);
  const sa = shape(a); const sb = shape(b);
  if (sa.length && sb.length && !sa.some((x) => sb.includes(x))) return false;
  const blk = (s) => [...s.matchAll(/\[data-block="([^"]+)"\]/g)].map((m) => m[1]);
  const ba = blk(a); const bb = blk(b);
  if (ba.length && bb.length && !ba.some((x) => bb.includes(x))) return false;
  return wa.size > 0 && wb.size > 0;
}

function main() {
  const [beforeFile, afterFile] = process.argv.slice(2);
  if (!beforeFile || !afterFile) { console.error('用法: css-equiv.js <改之前.css> <改之后.css>'); return 2; }
  const A = flatten(fs.readFileSync(beforeFile, 'utf-8'));
  const B = flatten(fs.readFileSync(afterFile, 'utf-8'));
  console.log(`改之前 ${A.length} 条 (媒体查询, 选择器) · 改之后 ${B.length} 条`);

  const ma = bySelector(A); const mb = bySelector(B);
  let bad = 0;
  const onlyA = [...ma.keys()].filter((k) => !mb.has(k));
  const onlyB = [...mb.keys()].filter((k) => !ma.has(k));
  console.log(`① 只在改之前有的 (媒体查询, 选择器): ${onlyA.length}`);
  onlyA.slice(0, 15).forEach((k) => console.log(`     ${k}`));
  console.log(`   只在改之后有的: ${onlyB.length}`);
  onlyB.slice(0, 15).forEach((k) => console.log(`     ${k}`));
  bad += onlyA.length + onlyB.length;

  let diffDecls = 0;
  for (const [k, v] of ma) {
    if (!mb.has(k)) continue;
    const w = mb.get(k);
    if (JSON.stringify(v) !== JSON.stringify(w)) {
      diffDecls += 1;
      if (diffDecls <= 10) console.log(`   ❌ ${k}\n      前: ${JSON.stringify(v)}\n      后: ${JSON.stringify(w)}`);
    }
  }
  console.log(`② 同一个选择器上「声明的内容或顺序」变了的: ${diffDecls}`);
  bad += diffDecls;

  // ③ 层叠：相对顺序变了、又可能撞同一个元素同一个属性的规则对
  const posA = new Map(); A.forEach((r, i) => posA.set(`${r.at}|${r.sel}|${r.idx}`, i));
  const keyOf = (r) => `${r.at}|${r.sel}`;
  const orderA = new Map(); A.forEach((r, i) => { if (!orderA.has(keyOf(r))) orderA.set(keyOf(r), []); orderA.get(keyOf(r)).push(i); });
  const orderB = new Map(); B.forEach((r, i) => { if (!orderB.has(keyOf(r))) orderB.set(keyOf(r), []); orderB.get(keyOf(r)).push(i); });

  const rankA = new Map(); A.forEach((r, i) => rankA.set(i, keyOf(r)));
  const flipped = [];
  // 只比「同一个媒体查询上下文」里的对 —— 不同上下文之间的先后不决定胜负（媒体查询不改变特异度，
  // 但两条在不同 @media 里的规则要同时生效才谈得上先后，这里保守地也一起比）。
  const idxA = new Map(); A.forEach((r, i) => idxA.set(keyOf(r) + '#' + r.idx, i));
  const listA = A.map((r, i) => ({ ...r, pos: i }));
  const listB = B.map((r, i) => ({ ...r, pos: i }));
  const findB = (r) => listB.find((x) => x.at === r.at && x.sel === r.sel
    && JSON.stringify(x.decls) === JSON.stringify(r.decls));
  for (let i = 0; i < listA.length; i += 1) {
    for (let j = i + 1; j < listA.length; j += 1) {
      const a = listA[i]; const b = listA[j];
      if (a.sel === b.sel && a.at === b.at) continue;
      const ba = findB(a); const bb = findB(b);
      if (!ba || !bb) continue;
      if (ba.pos < bb.pos) continue;               // 顺序没变
      if (!couldShareElement(a.sel, b.sel)) continue;
      const pa = new Set(a.decls.map(([p]) => p));
      const shared = b.decls.map(([p]) => p).filter((p) => pa.has(p));
      if (!shared.length) continue;
      flipped.push(`${a.at}|${a.sel}  ↔  ${b.at}|${b.sel}   同属性: ${shared.join(',')}`);
    }
  }
  console.log(`③ 顺序对调了、又可能撞同一个元素同一个属性的规则对: ${flipped.length}`);
  flipped.slice(0, 40).forEach((x) => console.log(`     ${x}`));
  bad += flipped.length;

  console.log(bad === 0 ? '\n✅ 三条都空' : `\n🔴 一共 ${bad} 处`);
  return bad === 0 ? 0 : 1;
}

process.exit(main());
