#!/usr/bin/env node
/**
 * variant-screen.js — #1031 判断表的原始读数：逐块、逐支列出
 *   · 这一支用到哪些 data.* 字段
 *   · 这一支有没有交互（onClick / useState / useRef / 表单事件）
 *   · 这一支是不是只画一部分数据（.slice(）
 *   · 这个组件有没有第二身份（asRegion）
 *
 * 分支怎么切：组件里每个 `if (variant === 'x')` 到它自己那对花括号闭合为止算一支；
 * 最后剩下的算 default 支；第一个分支之前那段算「四支共用的顶上声明」——
 * pricing-table 的 useState 就写在那儿，按支数会记成 0。
 *
 * 用法（在 templates/nextjs/ 下跑）:
 *   node scripts/block-migration/variant-screen.js src/components/sections/TestimonialsSection.tsx …
 *
 * 🔴 它自己的盲区，说在明处（#1031 量出来的）：
 *   · 只认 `data.X` 这种写法。今天 34 个组件**一个都没有**把 data 解构掉
 *     （`grep -cE '^\s*const \{[^}]*\} = data'` 全 0），所以今天它是全的；哪天有人写了解构，
 *     这把尺子会静默少读字段 —— 那是它的失败方向，不会报错。
 *   · 分支按 `if (variant === 'x')` 切。用 `includes` / 查表 / switch 写的分支它读不到，
 *     今天 13 块全是 if 链（`grep -c 'variant ==='` 与它数出来的支数对得上）。
 *   · 「顶上共用段」那一行是本票的重点之一：`pricing-table` 的 useState 写在四支之上，
 *     按支数会记成 0 —— #1029/#1030 的筛子就是这么漏掉它的。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SIGNALS = [
  ['useState', /\buseState\s*[(<]/g],
  ['useRef', /\buseRef\s*[(<]/g],
  ['onClick', /\bonClick=/g],
  ['onSubmit/onChange', /\bon(Submit|Change|Input)=/g],
  ['.slice(', /\.slice\(/g],
  ['asRegion', /\basRegion\b/g],
  ['return null', /return\s+null\s*;/g],
];

/** 从 `{` 开始做花括号配对，返回闭合的下标（忽略字符串/模板串里的括号，够用即可）。 */
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return src.length - 1;
}

function branchesOf(src) {
  const out = [];
  const re = /if\s*\(([^)]*variant\s*===[^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const openIdx = src.indexOf('{', m.index + m[0].length - 1);
    const close = matchBrace(src, openIdx);
    const names = [...m[1].matchAll(/variant\s*===\s*'([^']+)'/g)].map((x) => x[1]);
    out.push({ names, start: m.index, end: close, body: src.slice(m.index, close + 1) });
    re.lastIndex = close;
  }
  return out;
}

function fieldsIn(text) {
  return [...new Set([...text.matchAll(/\bdata\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((x) => x[1]))]
    .filter((f) => f !== 'variant').sort();
}

function signalsIn(text) {
  return SIGNALS.filter(([, re]) => { re.lastIndex = 0; return re.test(text); }).map(([n]) => n);
}

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const type = path.basename(file, '.tsx');
  const useClient = /^\s*['"]use client['"]/m.test(src.split('\n').slice(0, 3).join('\n'));
  const br = branchesOf(src);
  // 顶上共用段：文件开头到第一个分支（去掉 import 与 interface，留函数体开头那几行）
  const fnStart = src.indexOf('export default function');
  const sharedEnd = br.length ? br[0].start : src.length;
  const shared = fnStart >= 0 ? src.slice(fnStart, Math.max(fnStart, sharedEnd)) : '';
  // default 支：最后一个分支之后
  const tail = br.length ? src.slice(br[br.length - 1].end + 1) : src.slice(fnStart);

  console.log(`\n══ ${type}  (${src.split('\n').length} 行${useClient ? " · 'use client'" : ''})`);
  console.log(`   顶上共用段  字段 [${fieldsIn(shared).join(' ')}]  信号 [${signalsIn(shared).join(' ')}]`);
  for (const b of br) {
    console.log(`   ${b.names.join('|').padEnd(20)} 字段 [${fieldsIn(b.body).join(' ')}]  信号 [${signalsIn(b.body).join(' ')}]`);
  }
  console.log(`   ${'(default)'.padEnd(20)} 字段 [${fieldsIn(tail).join(' ')}]  信号 [${signalsIn(tail).join(' ')}]`);
  const all = new Set();
  [shared, ...br.map((b) => b.body), tail].forEach((t) => fieldsIn(t).forEach((f) => all.add(f)));
  const sets = new Set([...br.map((b) => fieldsIn(b.body).join(',')), fieldsIn(tail).join(',')]);
  console.log(`   → ${br.length + 1} 支 · ${sets.size} 种字段集 · 全块字段 ${all.size} 个`);
}
