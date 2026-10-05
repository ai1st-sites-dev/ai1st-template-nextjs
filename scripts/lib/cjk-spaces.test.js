#!/usr/bin/env node
/**
 * cjk-spaces.test.js — 去掉汉字 / 假名之间的空格（#1569 r3）。
 * 跑法: node scripts/lib/cjk-spaces.test.js（或 npm run test:scripts）· 退出码 0 全过 · 1 有失败
 */
'use strict';
const { collapseCjkSpaces } = require('./cjk-spaces');

let pass = 0; let fail = 0;
const eq = (got, want, name) => {
  if (got === want) { pass += 1; console.log(`  ✅ ${name}`); } else { fail += 1; console.log(`  ❌ ${name} —— 读到 ${JSON.stringify(got)}，要 ${JSON.stringify(want)}`); }
};

eq(collapseCjkSpaces('剪 发'), '剪发', '翻译种子「剪 发」→「剪发」（site-ea408218 的原样）');
eq(collapseCjkSpaces('剪 发 店'), '剪发店', '联想词「剪 发 店」→「剪发店」');
eq(collapseCjkSpaces('吹  发\t造型'), '吹发造型', '多个空格 / tab 一样去掉');
eq(collapseCjkSpaces('理发 店 near me'), '理发店 near me', '中英混排：汉字之间去掉，汉字与英文之间保留');
eq(collapseCjkSpaces('near me 理发店'), 'near me 理发店', '英文在前也保留');
eq(collapseCjkSpaces('haircut near me'), 'haircut near me', '纯英文原样');
eq(collapseCjkSpaces('ヘア カット'), 'ヘアカット', '日文假名之间也去');
eq(collapseCjkSpaces('미용실 추천'), '미용실 추천', '韩文用空格分词，不动');
eq(collapseCjkSpaces('剪发 2024'), '剪发 2024', '汉字与数字之间保留');
eq(collapseCjkSpaces(undefined), undefined, '不是字符串原样回');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
