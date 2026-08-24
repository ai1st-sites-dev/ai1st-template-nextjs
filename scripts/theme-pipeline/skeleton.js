'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// skeleton.js — 一份主题表在某个块上画出的「骨架指纹」（#1174 抽出来的，实现来自 #1139）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ══ 这是什么 ═══════════════════════════════════════════════════════════════════════════════════
// 骨架指纹 = 一份表在一个块上**只留决定几何的那些声明**之后剩下的字符串。颜色、字体、圆角、间距
// 倍数全丢掉 —— 那正是 #1135 的立论：**字节不同不等于观感不同**。两份表在同一个块上指纹相同，
// 意思就是「这两套皮在这个块上摆出来的东西是同一副样子，差的只是颜色」。
//
// ══ 为什么它住在这里，而不是在用它的那张票里各写一份 ═══════════════════════════════════════════
// 🔴 这份实现**不是新写的**：它逐字来自 `sheet-recipes.test.js` 第 ⑫ 格（#1139 立的），那里原来是
//    三个模块级的私有量（`GEOM_PROPS` / `selectorOwnedBy` / `skeletonsOf`）。搬出来的直接起因是
//    #1174 要在扩池之后回答「有没有新增 hero 双胞胎」，当时判断那跟 ⑫ 问的是同一件事、必须用同一
//    把尺。🔴 **那个判断后来被自己推翻了**：⑫ 只留决定几何的声明，hero 的几何只有 8 种，用它答那个
//    问题会把「同一副画法、字号留白全不同」的二十几对报成撞车（理由整段写在 `hero-twins.js` 文件头，
//    它今天用的是另一把尺）。所以**今天 require 这一份的只有一处** —— `sheet-recipes.test.js` 第 ⑫ 格
//    自己（自己数一次：`git grep -c "require(.*skeleton\.js" -- templates/nextjs`）。搬这件事仍然是
//    对的（⑫ 从此读的是这一份，不再是它文件里的私有副本），错的只是「两处会共用它」那个预期。
//    搬的判据是**产物同一性**：搬完 `sheet-recipes.test.js` 仍然 59 过 0 失败，⑫ 那几行读数
//    （「只有一副骨架的块 27 → 21」、各族的种数）逐字不变。
//
// 🔴 别按这段注释重写一份。本仓为「同一个判据两份实现」付过多次账，而这一族的失败方向是静默的：
//    两份实现分叉时，两个读数各自都像是对的。#1174 立票时正文与 PM 的裁定就各带了一份散文版，
//    两份读出来的 hero 双胞胎对子数一致纯属运气。
//
// ══ 一条边界，写在这里而不是等人踩 ═════════════════════════════════════════════════════════════
// 🔴 指纹**含 `@media (min-width: 1024px)` 那一段**。理由：列数只写在那一段里（基础规则永远是
//    `grid-template-columns: 1fr`），而人审那把尺是在 1440×900 的浏览器里量的，那时它生效。
//    只读基础规则是**另一把尺**（下面 `base` 那个返回值），它对全池读到的「只有一副骨架的块」是
//    21 个而不是 desktop 口径下的数 —— 两个口径都对，但它们回答的不是同一个问题，别混用。

const postcss = require('postcss');

// 决定几何的那些属性。加一条要想清楚：加进来的东西会让「两套皮长得一样」这句话变严，
// 而变严的代价是把「只差颜色」的那些对子也算成不同。
const GEOM_PROPS = new Set([
  'display', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
  'order', 'align-items', 'align-content', 'align-self', 'justify-items', 'justify-content', 'justify-self',
  'text-align', 'flex-wrap', 'flex-direction', 'place-items',
  'max-width', 'width', 'height', 'aspect-ratio', 'object-fit', 'margin-left', 'margin-right',
]);

/** 一条选择器是不是在说这个块。 */
const selectorOwnedBy = (sel, block) => sel.split(',').some((one) => {
  const t = one.trim();
  return t === `.${block}` || t.startsWith(`.${block}__`) || t.startsWith(`.${block} `) || t.startsWith(`.${block}.`);
});

/**
 * 一份表里**每个块**的骨架指纹，一次解析算完。
 *
 * 🔴 一块一次地 `postcss.parse` 是 块数 × 套数 次解析，实测跑不完（#1139 第一版就是那样，跑过
 *    2 分钟还没出读数）。这里一份表只解析一次，把每条规则归到它那个块名下。
 *
 * 返回 `{ desktop: Map<block, 指纹>, base: Map<block, 指纹> }` —— `base` 只含非 `@media` 的规则。
 */
function skeletonsOf(css, blocks) {
  const desk = new Map(blocks.map((b) => [b, []]));
  const base = new Map(blocks.map((b) => [b, []]));
  postcss.parse(css).walkRules((rule) => {
    const decls = rule.nodes.filter((n) => n.type === 'decl' && GEOM_PROPS.has(n.prop))
      .map((d) => `${d.prop}:${d.value.trim()}`).sort();
    if (!decls.length) return;
    const inMedia = rule.parent && rule.parent.type === 'atrule';
    const at = inMedia ? `@${rule.parent.name} ${rule.parent.params} ` : '';
    const line = `${at}${rule.selector.trim()}{${decls.join(';')}}`;
    for (const b of blocks) {
      if (!selectorOwnedBy(rule.selector, b)) continue;
      desk.get(b).push(line);
      if (!inMedia) base.get(b).push(line);
      break;
    }
  });
  const fold = (m) => new Map([...m].map(([b, xs]) => [b, xs.sort().join('\n')]));
  return { desktop: fold(desk), base: fold(base) };
}

module.exports = { GEOM_PROPS, selectorOwnedBy, skeletonsOf };
