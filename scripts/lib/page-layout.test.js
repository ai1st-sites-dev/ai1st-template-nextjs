#!/usr/bin/env node
/**
 * page-layout.test.js — 布局钉死的区形态（`repeatVariants`）原样进产物，两个消费者读同一张表。
 *
 * 跑法:  node scripts/lib/page-layout.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 📌 #1384 时这一格守的是「布局里钉的候选形态构建时落回」；#1579 删掉了候选形态，那几臂随之删掉，
 *    留下与候选无关的三格：
 *
 * ① `resolveRepeatVariants` 回的是布局钉的那份（逐字），notes 空
 * ② `validateLayout` 看得见「钉了一个清单里没有的形态」（这把尺没坏）
 * ③ 两个消费者读的是同一张表：`footerVariantsFor` 与 `derive-site.js`（#1666 之前在 `sync-config.js`）都调 `resolveRepeatVariants`
 *    （产物走后者、AI 编辑器的 notes 走前者，分叉 = 告诉编辑器这个站戴着一个它并没戴的形态）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const lib = require('./page-layout.js');

// #1387 —— 形态清单 = blocks/footer/ 下的子文件夹，顺序由 region-layout 自己那份读法定。
const FOOTER_SHAPES = require(path.join(NEXT, 'scripts', 'region-layout.js')).shapesOf('footer');
// 📌 #1425（T3）—— 原来读盘上的 `page-layouts/tri-footer.json`；它随公告条 / 旧页脚一起删了（布局库只剩
//    `standard`）。而 `repeatVariants` 这条线今天仍接着（`SiteShell.tsx` 的 footer 支、`sync-config.js`
//    §resolveRepeatVariants），所以改用一份**同形的合成布局**：三个 footer 区，各钉一种【今天】footer
//    manifest 里真有的形态（不写死名字，从 FOOTER_SHAPES 取）。
const pickShape = (pref) => (FOOTER_SHAPES.includes(pref) ? pref : null);
const triFooter = {
  id: 'tri-footer-fixture',
  description: '#1425（T3）合成：三支页脚',
  regions: ['header', 'content', 'footer-a', 'footer-b', 'footer-c'],
  repeatVariants: {
    'footer-a': pickShape('stacked') || FOOTER_SHAPES[1],
    'footer-b': pickShape('columns') || FOOTER_SHAPES[FOOTER_SHAPES.length - 1],
    'footer-c': pickShape('slim-row') || FOOTER_SHAPES[0],
  },
};
if (new Set(Object.values(triFooter.repeatVariants)).size !== 3) die(`合成布局的三个页脚形态有重复（${JSON.stringify(triFooter.repeatVariants)}）—— footer 形态不够三个`);
const DECLARED = triFooter.repeatVariants || {};

console.log('── ① repeatVariants 原样通过 ──');
{
  const { variants, notes } = lib.resolveRepeatVariants(triFooter);
  if (JSON.stringify(variants) === JSON.stringify(DECLARED) && notes.length === 0) {
    ok(`三个区逐字等于布局钉的那份（${Object.entries(DECLARED).map(([k, v]) => `${k}=${v}`).join(' · ')}），notes 空`);
  } else {
    bad(`对不上：variants=${JSON.stringify(variants)} notes=${JSON.stringify(notes)}`);
  }
}

console.log('── ② validateLayout 看得见清单里没有的形态 ──');
{
  const clean = lib.validateLayout(triFooter);
  if (clean.length === 0) ok('合成布局 validateLayout 0 problems');
  else bad(`合成布局报了 ${clean.length} 条：${JSON.stringify(clean)}`);
  const broken = { ...triFooter, repeatVariants: { ...DECLARED, 'footer-c': 'zz-not-a-shape' } };
  const got = lib.validateLayout(broken);
  if (got.some((x) => x.includes('zz-not-a-shape'))) ok('写一个清单里没有的名字，它照样报 —— 这把尺没坏');
  else bad(`写了一个不存在的形态却 0 problems（${JSON.stringify(got)}）`);
}

console.log('── ③ 两个消费者读的是同一张表 ──');
{
  // `footerVariantsFor` 走 themes / site_meta 那一串，副本树里立不起来；这一格改为读**源码**：
  // 🔴 它问的是「site-regions.js 里那个函数有没有自己再算一遍」，而那正是两处分叉的形状。
  // 🔴 **先剥掉整行注释再量**：这个函数上面那段注释里就写着 `resolveRepeatVariants` 这个名字，
  //    不剥的话「有没有调它」这一问永远是 true —— 实测过：把那一行调用删掉、注释留着，这一格照绿
  //    （而下面那条「有没有自己再读一次」是红的）。剥的是【整行】注释，不是行尾的 `//`：后者会咬进
  //    字符串字面量。
  const stripComments = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const src = stripComments(fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'site-regions.js'), 'utf-8'));
  // #1425（T3）—— 原来切到 `function hasTopbarRegion` 为止；那个函数删了，改为切到下一个顶层 `function`。
  const start = src.indexOf('function footerVariantsFor');
  if (start < 0) die('site-regions.js 里找不到 function footerVariantsFor —— ③ 没有对象');
  const nextFn = src.indexOf('\nfunction ', start + 1);
  const body = src.slice(start, nextFn < 0 ? undefined : nextFn);
  if (body.includes('resolveRepeatVariants')) {
    ok('footerVariantsFor 调的是 pageLayoutLib.resolveRepeatVariants（不是自己读 layout.repeatVariants）');
  } else {
    bad('footerVariantsFor 没走 resolveRepeatVariants —— 两边会分叉');
  }
  if (!/repeatVariants\s*\)\s*\|\|\s*\{\}/.test(body) && !body.includes('picked.layout.repeatVariants')) {
    ok('它也没有自己再读一次 layout.repeatVariants');
  } else {
    bad(`footerVariantsFor 里仍有直接读 layout.repeatVariants 的地方：${body.trim().slice(0, 200)}…`);
  }
  // #1666 —— 拼 pageLayout 那段跟着派生搬进了 derive-site.js（sync-config.js 拿它的结果写 config-data.ts）。
  const sync = stripComments(fs.readFileSync(path.join(NEXT, 'scripts', 'derive-site.js'), 'utf-8'));
  if (/resolveRepeatVariants\(picked\.layout,\s*regions\)/.test(sync)) {
    ok('derive-site.js 交给产物的也是同一个函数的产出');
  } else {
    bad('derive-site.js 没走 resolveRepeatVariants —— 产物里会是布局原样那份');
  }
}

console.log(`\n══ page-layout.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
