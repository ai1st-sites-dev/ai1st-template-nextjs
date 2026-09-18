// ══════════════════════════════════════════════════════════════════════════════════════════════════
// css-split.js — 把 `public/shapes.css` / `public/base.css` 按「哪个块、哪个形态」切开（#1387）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 这份文件只被两个地方用：一次性的搬家脚本（`scripts/block-migration/to-folders.js`）和它的测试。
// 生成器（`scripts/block-build/build-blocks.js`）不用它 —— 生成器读的是搬完之后的文件夹。
//
// 🔴 切的判据是**选择器**，不是注释里的分节线。分节线（`/* ══ hero ══ … */`）是人写给人看的，
//    它跟规则真正属于谁没有机器保证；实测 `shapes.css` 里 hero 名下有四条规则（`:3496` 起的
//    `.hero__band` 那组）根本不带 `[data-shape]`，而末尾那四条空媒体带规则分属四个不同的块、
//    却排在所有分节线之外。按注释切会把这些全部切错。
'use strict';

const postcss = require('postcss');

/** 选择器里点名的块（`[data-block="x"]`）；没有就按 BEM 类名前缀推（base.css 那一族）。 */
function blocksOfSelector(sel, knownBlocks) {
  const attr = [...sel.matchAll(/\[data-block="([^"]+)"\]/g)].map((m) => m[1]);
  if (attr.length) return [...new Set(attr)];
  const out = new Set();
  for (const m of sel.matchAll(/\.([a-z0-9-]+?)(?:__[a-z0-9-]+)?(?=[\s.:,[>+~]|$)/g)) {
    if (knownBlocks.includes(m[1])) out.add(m[1]);
  }
  return [...out];
}

function shapesOfSelector(sel) {
  return [...new Set([...sel.matchAll(/\[data-shape="([^"]+)"\]/g)].map((m) => m[1]))];
}

/**
 * 一个顶层节点归谁：
 *   { kind: 'shape', block, shape }  一条规则只讲一个块的一个形态
 *   { kind: 'block', block }         只讲一个块，但跨形态（或压根不带 data-shape）
 *   { kind: 'multi', blocks }        一条规则同时覆盖好几个块（base.css 有 47 条这样的）
 *   { kind: 'none' }                 认不出来（注释、@import 之类）
 */
function ownerOfNode(node, knownBlocks) {
  const rules = [];
  if (node.type === 'rule') rules.push(node);
  else if (node.type === 'atrule') node.walkRules((r) => rules.push(r));
  else return { kind: 'none' };
  if (!rules.length) return { kind: 'none' };

  const blocks = new Set();
  const shapes = new Set();
  let everySelectorHasShape = true;
  for (const r of rules) {
    for (const sel of r.selectors) {
      const bs = blocksOfSelector(sel, knownBlocks);
      bs.forEach((b) => blocks.add(b));
      const ss = shapesOfSelector(sel);
      ss.forEach((s) => shapes.add(s));
      if (!ss.length) everySelectorHasShape = false;
    }
  }
  if (blocks.size === 0) return { kind: 'none' };
  if (blocks.size > 1) return { kind: 'multi', blocks: [...blocks].sort() };
  const block = [...blocks][0];
  if (everySelectorHasShape && shapes.size === 1) {
    return { kind: 'shape', block, shape: [...shapes][0] };
  }
  return { kind: 'block', block };
}

/** 节点在原文里的字节区间（含它前面那段空白/换行，postcss 把它放在 raws.before）。 */
function nodeText(node) {
  return (node.raws.before || '') + node.toString();
}

/**
 * 把一份 CSS 切成有序的块段（chunk）。每段带 owner 与原文。
 * 注释自己不决定归属 —— 它跟着**后面第一个认得出主人的节点**走，这正是这些注释在文件里的写法
 * （先一段解释，再是它解释的那几条规则）。文件末尾剩下的注释归 `tail`。
 */
function splitCss(css, knownBlocks) {
  const root = postcss.parse(css);
  const nodes = root.nodes || [];
  const owners = nodes.map((n) => ownerOfNode(n, knownBlocks));

  // 注释（以及别的认不出的节点）跟后面第一个有主人的节点走。
  const resolved = owners.slice();
  let carry = { kind: 'tail' };
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (owners[i].kind === 'none') resolved[i] = carry;
    else carry = owners[i];
  }

  const key = (o) => {
    if (o.kind === 'shape') return `shape:${o.block}/${o.shape}`;
    if (o.kind === 'block') return `block:${o.block}`;
    if (o.kind === 'multi') return `multi:${o.blocks.join('+')}`;
    return o.kind; // 'tail'
  };

  const chunks = [];
  nodes.forEach((n, i) => {
    const o = resolved[i];
    const k = key(o);
    const last = chunks[chunks.length - 1];
    if (last && last.key === k) {
      last.nodes.push(n);
      last.text += nodeText(n);
    } else {
      chunks.push({ key: k, owner: o, nodes: [n], text: nodeText(n), index: chunks.length });
    }
  });
  // root.raws.after —— 文件最后那点空白，谁都不属于，丢掉（生成器自己收尾换行）。
  return chunks;
}

module.exports = { splitCss, ownerOfNode, blocksOfSelector, shapesOfSelector, nodeText };
