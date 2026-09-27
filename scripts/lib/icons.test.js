#!/usr/bin/env node
/**
 * icons.test.js — #1462：图标名 → 内联 SVG（`scripts/lib/icons.js`）。
 *
 * 跑法:  node scripts/lib/icons.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

const NEXT = path.resolve(__dirname, '..', '..');
let icons; let DEMO;
try {
  icons = require('./icons.js');
  DEMO = require('./demo-content').DEMO_CONTENT;
} catch (e) { die(e.message); }
if (!fs.existsSync(icons.ICON_DIR)) die(`${icons.ICON_DIR} 不在 —— bootstrap-icons 没装`);

console.log('① 读一个图标');
{
  const warns = [];
  const warn = (m) => warns.push(m);
  const t = icons.readIcon('telephone', { warn });
  check(t && t.viewBox === '0 0 16 16' && /^<path /.test(t.body) && !t.body.includes('<svg'), 'telephone ⟹ viewBox + 里面的 path（不带 <svg> 外壳）');
  check(icons.readIcon('no-such-icon-xyz', { warn }) === null && warns.length === 1 && warns[0].includes('no-such-icon-xyz'), '不存在的名字 ⟹ null + 一行日志');
  check(icons.readIcon('../package', { warn }) === null && warns.length === 2, '名字里有路径字符 ⟹ 拒（不去读文件）');
}

console.log('\n② 表：数据里的名字 + 块自己点名的名字');
{
  for (const block of Object.keys(icons.BLOCK_ICONS)) {
    const warns = [];
    const table = icons.iconTableFor(block, DEMO[block], { warn: (m) => warns.push(m) });
    const want = new Set([...icons.BLOCK_ICONS[block], ...icons.iconNamesIn(DEMO[block])]);
    check(want.size > 0 && [...want].every((n) => table[n]), `${block}：演示数据 + 组件点名的 ${want.size} 个图标都查到了`, [...want].filter((n) => !table[n]).join(' · '));
    check(warns.length === 0, `${block}：没有一行「查不到」`, warns.join(' | '));
  }
  // 组件源码里写死的图标名（`icon('x')` / `name="x"` / `: 'x'`）必须都在 BLOCK_ICONS 里 —— 漏一个就是那个图标静默不画。
  for (const block of Object.keys(icons.BLOCK_ICONS)) {
    const src = fs.readFileSync(path.join(NEXT, 'blocks', block, 'Section.tsx'), 'utf-8');
    const lit = new Set([
      ...[...src.matchAll(/icon\('([a-z0-9-]+)'\)/g)].map((m) => m[1]),
      ...[...src.matchAll(/icon\(open \? '([a-z0-9-]+)' : '([a-z0-9-]+)'\)/g)].flatMap((m) => [m[1], m[2]]),
      ...[...src.matchAll(/<InlineIcon name="([a-z0-9-]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/icon: '([a-z0-9-]+)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/: '(link-45deg)'/g)].map((m) => m[1]),
    ]);
    const missing = [...lit].filter((n) => !icons.BLOCK_ICONS[block].includes(n));
    check(lit.size > 0 && missing.length === 0, `${block}：组件里写死的 ${lit.size} 个图标名都在 BLOCK_ICONS 里`, `漏了 ${missing.join(' · ')}`);
  }
}

console.log('\n③ 字体那条路真没了（验收 10）');
{
  const src = fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'site-css.js'), 'utf-8');
  const hits = src.split('\n').filter((l) => /bootstrap-icons|ICON_FONT|demoIconClasses|iconClassesIn/.test(l));
  check(hits.length === 0, 'site-css.js 里 bootstrap-icons / ICON_FONT / demoIconClasses / iconClassesIn 0 命中', hits.join(' | '));
  check(/purgeSiteCss/.test(src), '对照：同一份文件里 purgeSiteCss 读得到（尺子没坏）');
  const scss = require('./site-css.js').siteScss('#123456');
  check(scss.includes('@webpixels/css/all') && !scss.includes('bootstrap-icons'), '编出来的 scss 只 import Webpixels，不再 import 图标字体');
}

console.log(`\n${fail ? '🔴' : '✅'} icons: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
