#!/usr/bin/env node
/**
 * richtext.test.js — #1498 AC3 的解析器那一半：`scripts/lib/richtext.js` 逐字输出 + 两种报错。
 *
 * 跑法:  node scripts/richtext.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 每一格都是「输入 → 逐字的 HTML」。组件画出来的 DOM 那一半（同一棵树用 React 画）在 `content-render.test.js`。
 * 🔴 末尾有反向对照：把链接白名单放宽 / 不转义，对应的格子必须红。
 */

'use strict';

const path = require('path');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let rt;
try { rt = require(path.join(__dirname, 'lib', 'richtext.js')); } catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }

// [名字, 输入, 逐字期望]
const CASES = [
  ['AC3 原句：分段 + 列表 + 加粗 + 链接', '第一段\n\n- a\n- b\n\n**粗** 和 [链接](/about)',
    '<p>第一段</p><ul><li>a</li><li>b</li></ul><p><strong>粗</strong> 和 <a href="/about">链接</a></p>'],
  ['AC3：<script> 原样转义', '<script>x</script>', '<p>&lt;script&gt;x&lt;/script&gt;</p>'],
  ['AC3：javascript: 链接只剩文字（括号整段吃掉，不留 `)`）', '[x](javascript:alert(1))', '<p>x</p>'],
  ['有序列表', '1. one\n2. two\n10. ten', '<ol><li>one</li><li>two</li><li>ten</li></ol>'],
  ['段落里的单个换行 = 一个空格（软换行）', 'line one\nline two', '<p>line one line two</p>'],
  ['列表紧贴段落（中间没有空行）也分得开', 'Intro:\n- a\n- b\ntail', '<p>Intro:</p><ul><li>a</li><li>b</li></ul><p>tail</p>'],
  ['无序接有序：两张列表', '- a\n1. b', '<ul><li>a</li></ul><ol><li>b</li></ol>'],
  ['五种认的链接开头', '[a](https://x.example/p) [b](http://x.example) [c](/about) [d](#top) [e](mailto:a@b.c) [f](tel:+14165550142)',
    '<p><a href="https://x.example/p">a</a> <a href="http://x.example">b</a> <a href="/about">c</a> <a href="#top">d</a> <a href="mailto:a@b.c">e</a> <a href="tel:+14165550142">f</a></p>'],
  ['协议相对地址 //evil 不算站内链接', '[x](//evil.example)', '<p>x</p>'],
  ['反斜杠 /\\evil 同样不算站内链接（浏览器把 \\ 当 /）', '[x](/\\evil.example/x)', '<p>x</p>'],
  ['data: / vbscript: 不认', '[x](data:text/html,hi) [y](vbscript:msgbox)', '<p>x y</p>'],
  ['链接地址里带一层括号', '[w](https://en.wikipedia.org/wiki/Car_(disambiguation))', '<p><a href="https://en.wikipedia.org/wiki/Car_(disambiguation)">w</a></p>'],
  ['链接文字里的加粗', '[**Book** now](/quote)', '<p><a href="/quote"><strong>Book</strong> now</a></p>'],
  ['列表项里的加粗与链接', '- **Fast**: [call us](tel:+1416)', '<ul><li><strong>Fast</strong>: <a href="tel:+1416">call us</a></li></ul>'],
  ['引号、& 转义', 'Tom & Jerry say "hi" it\'s', '<p>Tom &amp; Jerry say &quot;hi&quot; it&#39;s</p>'],
  ['标题 / 图片 / 斜体不认，原样当文字', '# Title\n\n![alt](/a.jpg) *it*', '<p># Title</p><p>!<a href="/a.jpg">alt</a> *it*</p>'],
  ['多个空行、行尾空格、\\r\\n 都当一个分段', 'a  \r\n\r\n\r\n\r\nb', '<p>a</p><p>b</p>'],
  ['没配对的 ** 原样', 'a **b', '<p>a **b</p>'],
  ['空串 / 只有空白 ⟹ 什么都不画', '  \n\n ', ''],
];

console.log(`── richtextToHtml 逐字（${CASES.length} 种输入）`);
for (const [name, input, want] of CASES) {
  const got = rt.richtextToHtml(input);
  check(got === want, name, `得到 ${JSON.stringify(got)}`);
}
check(rt.richtextToHtml(undefined) === '' && rt.richtextToHtml(42) === '' && rt.parseRichtext(null).length === 0, '不是字符串 ⟹ 空（块里这一段不渲染）');

console.log('\n── richtextProblems（validateSite 报的两种）');
{
  const kinds = (s) => rt.richtextProblems(s).map((p) => p.kind).join(',');
  check(kinds('<script>x</script>') === 'html', '写了 <script> ⟹ html');
  check(kinds('a <br/> b') === 'html' && kinds('<p class="x">a</p>') === 'html', '写了 <br/> / 带属性的 <p> ⟹ html（一段报一次）');
  check(kinds('[x](javascript:alert(1))') === 'href', 'javascript: ⟹ href');
  check(kinds('[x](//evil.example) [y](data:x) [z](/\\evil.example)') === 'href,href,href', '每个坏链接各报一次（含 /\\ 开头）');
  check(kinds('1 < 2 and 3 > 2, a <b c') === '', '对照：比较号不是标签 ⟹ 不报');
  check(kinds('**b** [a](/x) [m](mailto:a@b.c)') === '', '对照：认的写法 ⟹ 不报');
}

// ── 反向对照：解析器的两道闸各拆掉一道，对应的格子必须红（同一进程、单变量）──────────────────────────
console.log('\n── 反向对照');
{
  const fs = require('fs');
  const os = require('os');
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'richtext.js'), 'utf-8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'richtext-'));
  const load = (edited) => {
    // 改写没命中 ⟹ 反向对照静默退化成原样代码，必须当场报出来
    if (edited === src) throw new Error('反向对照的改写没命中源码 —— 锚点那行变了，跟着改这里');
    const p = path.join(tmp, `r${Math.random().toString(36).slice(2)}.js`); fs.writeFileSync(p, edited); return require(p);
  };
  try {
    const open = load(src.replace("const SAFE_HREF = /^(https?:\\/\\/|\\/(?![\\/\\\\])|#|mailto:|tel:)/i;", 'const SAFE_HREF = /./;'));
    check(open.richtextToHtml('[x](javascript:alert(1))') !== '<p>x</p>', '链接白名单放成「什么都认」⟹ javascript: 那格会红（判据分得开）');
    const raw = load(src.replace("const esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ESC[c]);", 'const esc = (s) => String(s);'));
    check(raw.richtextToHtml('<script>x</script>').includes('<script>'), '不转义 ⟹ <script> 那格会红（判据分得开）');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
