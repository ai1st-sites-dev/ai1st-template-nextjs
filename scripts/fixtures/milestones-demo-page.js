// #1482 —— 往 site/en/pages/ 写一页 milestones-1482.json，放几块 milestones（4 条 stat 的 auto / 1 / 2 / 3 / 4 列、渐变、坏图标名），
// 给 e2e「真站产物」那几格用。跑法：cd templates/nextjs && node scripts/fixtures/milestones-demo-page.js（要先有一个 site/），然后 npm run build。
'use strict';
const fs = require('fs');
const path = require('path');
const { DEMO_CONTENT } = require('../lib/demo-content');

const clone = (v) => JSON.parse(JSON.stringify(v));
const lean = (d) => { const x = clone(d); delete x.blockImage; delete x.introImage; delete x.bg; return x; };
const DEMO = DEMO_CONTENT.milestones;
// 正文做什么 9 点名的那四条（AC3 量的是「4 条」）。
const four = (cols) => { const x = lean(DEMO); x.stats = x.stats.slice(0, 4); x.options = { statsColumns: cols }; return x; };
const bad = lean(DEMO); bad.stats[1].icon = 'no-such-icon-xyz';
const blocks = [
  ...['auto', '1', '2', '3', '4'].map((c) => [`ms-four-${c}`, 'divided-row', four(c)]),
  ['ms-gradient', 'divided-row', { ...lean(DEMO), bg: { stops: ['#7d52f4', '#f7b733'], angle: 135 } }],
  ['ms-bad-icon', 'divided-row', bad],
].map(([id, shape, data], i) => ({ id, type: 'milestones', shape, role: 'optional', region: 'content', weight: i * 10, data }));
const page = { slug: 'milestones-1482', title: 'Milestones 1482', description: 'milestones fixture', changeFrequency: 'monthly', priority: 0.1, blocks };
const out = path.join(__dirname, '..', '..', 'site', 'en', 'pages', 'milestones-1482.json');
fs.writeFileSync(out, JSON.stringify(page, null, 2));
console.log(`wrote ${out} (${blocks.length} blocks)`);
