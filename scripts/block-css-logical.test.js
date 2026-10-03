#!/usr/bin/env node
/**
 * block-css-logical.test.js — 块的 CSS 只用逻辑属性（#1473 做什么 5）。
 *
 * 跑法:  node scripts/block-css-logical.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * RTL 站只有 `site.css` 过 RTLCSS；块的 CSS（`public/shapes.css`）不过 ⟹ 块里写死的左右在 RTL 下不会镜像。
 * 判据（四维 + 剔注释）只在 `scripts/lib/css-physical-direction.js` 一处。这里管两件事：
 *   ① 判据自己：四维各一个阳性对照、逻辑属性写法各一个阴性对照、注释（含多行注释的续行）不报红
 *   ② 射程：`blocks/<块>/block.css` + `blocks/<块>/<形态>/shape.css` 全部 0 命中；命中就点名 文件:行 · 维 · 原文 · 该改成什么
 */
'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const BLOCKS = path.join(NEXT, 'blocks');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let lib;
try {
  lib = require('./lib/css-physical-direction.js');
} catch (e) {
  die(`读不到 lib/css-physical-direction.js: ${e.message}`);
}
const { DIMENSIONS, findPhysicalDirection } = lib;

// ── ① 判据 ────────────────────────────────────────────────────────────────────────────────────────
console.log('① 判据：四维各自认得出、逻辑属性不误报、注释不算');
const POSITIVE = {
  A: ['  margin-left: 1rem;', '  padding-right: 0;', '  text-align: left;', '  text-align:right;', '  float: left;'],
  B: ['  left: 1rem;', 'right: 0;', '  left : 50%;'],
  C: ['  border-left: 1px solid red;', '  border-right-color: #fff;', '.x{border-left:0}'],
  D: ['  margin: 0 1rem 0 2rem;', '  padding: 1px 2px 3px 4px !important;', '  margin: 0 0 2.5rem 0;'],
};
for (const [dim, lines] of Object.entries(POSITIVE)) {
  for (const ln of lines) {
    const got = findPhysicalDirection(`.a {\n${ln}\n}\n`).filter((h) => h.dim === dim);
    if (got.length === 1 && got[0].line === 2) ok(`维 ${dim} 认得 ${JSON.stringify(ln.trim())}（第 2 行）`);
    else bad(`维 ${dim} 没认出 ${JSON.stringify(ln.trim())}：${JSON.stringify(got)}`);
  }
}
const NEGATIVE = [
  'margin-inline-start: 1rem;', 'padding-inline-end: 0;', 'text-align: start;', 'text-align: center;', 'float: inline-end;',
  'inset-inline-start: 0;', 'border-inline-start: 1px solid red;', 'margin: 0 auto;', 'margin: 0 1rem 2rem;', 'padding: 1rem;',
  'margin-block-end: 2.5rem;', 'transform: translateX(-50%);', 'scroll-margin-top: 4rem;', '--left: 1rem;',
];
for (const ln of NEGATIVE) {
  const got = findPhysicalDirection(`.a {\n  ${ln}\n}\n`);
  if (got.length === 0) ok(`不报 ${JSON.stringify(ln)}`);
  else bad(`误报 ${JSON.stringify(ln)}：${JSON.stringify(got)}`);
}
{
  // 跨行注释：续行不以 `/*` 开头。四维各藏一行，一条都不许报；注释后面那行真声明要报，且行号对得上源文件。
  const css = '.a {\n  /* 别写 margin-left，\n     border-right: 1px 也别写，\n     left: 0;\n     margin: 0 1rem 0 2rem; */\n  margin-left: 1rem;\n}\n';
  const got = findPhysicalDirection(css);
  if (got.length === 1 && got[0].line === 6 && got[0].dim === 'A') ok('多行注释里的四维全剔掉，注释后那行真声明照报（第 6 行）');
  else bad(`注释没剔对：${JSON.stringify(got)}`);
}
if (DIMENSIONS.map((d) => d.id).join('') === 'ABCD') ok('四维齐：A B C D');
else bad(`维度表变了：${DIMENSIONS.map((d) => d.id).join('')}`);

// ── ② 射程 ────────────────────────────────────────────────────────────────────────────────────────
console.log('② 射程：blocks/<块>/block.css + blocks/<块>/<形态>/shape.css');
if (!fs.existsSync(BLOCKS)) die(`没有 ${BLOCKS}`);
const files = [];
for (const b of fs.readdirSync(BLOCKS, { withFileTypes: true })) {
  if (!b.isDirectory()) continue;
  const dir = path.join(BLOCKS, b.name);
  if (fs.existsSync(path.join(dir, 'block.css'))) files.push(path.join(dir, 'block.css'));
  for (const s of fs.readdirSync(dir, { withFileTypes: true })) {
    if (s.isDirectory() && fs.existsSync(path.join(dir, s.name, 'shape.css'))) files.push(path.join(dir, s.name, 'shape.css'));
  }
}
const nBlock = files.filter((f) => f.endsWith('block.css')).length;
const nShape = files.length - nBlock;
// 读数的分母要不是 0：射程空了，「0 命中」就是一句空话。
if (nBlock === 0 || nShape === 0) die(`射程是空的（block.css ${nBlock} 个 · shape.css ${nShape} 个）`);
const fixOf = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d.fix]));
let hitLines = 0;
const hitFiles = [];
for (const f of files) {
  const hits = findPhysicalDirection(fs.readFileSync(f, 'utf8'));
  if (!hits.length) continue;
  const rel = path.relative(NEXT, f);
  hitFiles.push(rel);
  hitLines += new Set(hits.map((h) => h.line)).size;
  for (const h of hits) bad(`${rel}:${h.line} · 维 ${h.dim} · ${h.text}  → 改成 ${fixOf[h.dim]}`);
}
if (hitLines === 0) ok(`${nBlock} 个 block.css + ${nShape} 个 shape.css，四维 0 命中`);
else console.log(`  🔴 ${hitFiles.length} 个文件 · ${hitLines} 行写死了左右 —— 块的 CSS 不过 RTLCSS，RTL 站上它们不会镜像（#1473）`);

console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
