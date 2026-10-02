#!/usr/bin/env node
/**
 * contact-facts.test.js — #1506 AC2 的单测那一半：电话 → `tel:`、邮箱 → `mailto:` 全站只有这一份
 * （`scripts/lib/contact-facts.js` §telHref / §mailtoHref；contact、footer、引用展开 `item-sources.js` 都用它）。
 * 「三处用的是同一个函数」那一半在 `scripts/contact-refs.test.js`（把这个模块换掉，三处一起变）。
 *
 * 跑法:  node scripts/lib/contact-facts.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */

'use strict';

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const eq = (got, want, m) => (got === want ? ok(`${m} ⟹ ${got}`) : bad(`${m} ⟹ ${got}（要 ${want}）`));

let lib;
try { lib = require('./contact-facts.js'); } catch (e) { console.error(`🔴 跑不起来: ${e.message}`); process.exit(2); }
const { telHref, mailtoHref } = lib;
if (typeof telHref !== 'function' || typeof mailtoHref !== 'function') {
  console.error('🔴 跑不起来: contact-facts.js 没有导出 telHref / mailtoHref');
  process.exit(2);
}

console.log('── telHref：只留数字和 +');
eq(telHref('(604) 555-0142'), 'tel:6045550142', '(604) 555-0142');
eq(telHref('+1 604-555-0142'), 'tel:+16045550142', '+1 604-555-0142');
eq(telHref('604.555.0142'), 'tel:6045550142', '604.555.0142');
eq(telHref('  (416) 555 0142  '), 'tel:4165550142', '前后有空格');
eq(telHref(undefined), 'tel:', '不是字符串 ⟹ 空号码（调用方先判有没有值）');
// 反向对照：老块那种「只去空格」的转法在第一格上给出不同的答案 ⟹ 上面那格能分清两种转法。
const oldBlockWay = (p) => `tel:${p.replace(/\s/g, '')}`;
oldBlockWay('(604) 555-0142') !== telHref('(604) 555-0142')
  ? ok(`反向对照：老块的转法（只去空格）给出 ${oldBlockWay('(604) 555-0142')}，跟它不同`)
  : bad('反向对照：老块的转法跟它给出同一个答案 —— 第一格分不清两种转法');

console.log('\n── mailtoHref');
eq(mailtoHref('service@northsideauto.ca'), 'mailto:service@northsideauto.ca', 'service@northsideauto.ca');
eq(mailtoHref('  a@b.co '), 'mailto:a@b.co', '前后有空格');

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
