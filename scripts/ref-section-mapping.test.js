#!/usr/bin/env node
/**
 * ref-section-mapping.test.js — #1425：参考网站的版式 → 我们的块类型，每个值都必须是 `blocks/` 里真有的块。
 *
 *   node scripts/ref-section-mapping.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么要它：老板建站勾了「Layout & sections」之后，`parseRefSections` 吐出的那串块名原样进提示词
 * （`create-site.js` 的 REFERENCE SITE LAYOUT —— 「必须正好是这几个」），值指向不存在的块 ⟹ AI 照做、
 * 校验报「没有这种块」、重试后 fatal，这个站建不出来。T3 删旧库时这张表 92 条里 81 条就是这么断的，而
 * 当时全仓没有一份测试看着它（QA1 r1 打回）。
 *
 * 判据取自 `blocks/` 目录本身（有 manifest.json 的那些），不抄一份块名清单 —— 抄的清单会跟着这张表一起过期。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const BLOCKS_DIR = path.join(NEXT, 'blocks');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${JSON.stringify(detail)}`));

let m;
let blocks;
try {
  m = require('./ref-section-mapping');
  blocks = new Set(fs.readdirSync(BLOCKS_DIR).filter((d) => fs.existsSync(path.join(BLOCKS_DIR, d, 'manifest.json'))));
} catch (e) {
  console.log(`🔴 跑不起来: ${e.message}`);
  process.exit(2);
}
if (blocks.size === 0) {
  console.log(`🔴 跑不起来: ${BLOCKS_DIR} 下一个带 manifest.json 的块都没有 —— 这把尺没有东西可比`);
  process.exit(2);
}

console.log(`\n① 每个值都是 blocks/ 里真有的块（${blocks.size} 个块）`);
const entries = Object.entries(m.REF_SECTION_MAPPING);
check(entries.length > 0, `表不是空的（${entries.length} 条）`);
const dangling = entries.filter(([, v]) => v !== null && !blocks.has(v));
check(dangling.length === 0, '没有一条指向不存在的块', dangling);
check(entries.every(([, v]) => v === null || typeof v === 'string'), '值只有两种：块名或 null（跳过）');

console.log('\n② 兜底也是真有的块');
check(blocks.has(m.FALLBACK_SECTION), `FALLBACK_SECTION = ${JSON.stringify(m.FALLBACK_SECTION)} 在 blocks/ 里`);
check(m.mapRefSection('some-name-nobody-wrote') === m.FALLBACK_SECTION, '表里没有的名字落到 FALLBACK_SECTION');

console.log('\n③ 真实形状的输入：输出里每一项都是真有的块');
const samples = [
  // scrape.go 给 Gemini 的那个例子（QA1 r1 读数用的就是它）
  'hero, trusted-brands, features-grid, testimonials, cta-banner',
  'hero, services, about, testimonials, faq, contact, footer',
  'Hero (full-width image, headline on left), Services List (two-column with prices, image on right), Stats, Newsletter, Footer',
];
for (const s of samples) {
  const out = m.parseRefSections(s);
  check(out.length > 0 && out.every((t) => blocks.has(t)), `parseRefSections(${JSON.stringify(s.slice(0, 50))}…)`, out);
}
check(JSON.stringify(m.parseRefSections('header, newsletter, announcement-bar, footer')) === '[]',
  '页面区块之外的东西（header / footer / 订阅框 / 公告条）全部跳过', m.parseRefSections('header, newsletter, announcement-bar, footer'));

console.log('\n④ 这把尺会红（判别力）');
// 往一份拷贝里塞一条指向已删块的值，同一个谓词必须抓到它。
const mutated = { ...m.REF_SECTION_MAPPING, 'services': 'services-list' };
const caught = Object.entries(mutated).filter(([, v]) => v !== null && !blocks.has(v));
check(caught.length === 1 && caught[0][0] === 'services', '指向已删的 services-list 的那一条被谓词抓到', caught);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
