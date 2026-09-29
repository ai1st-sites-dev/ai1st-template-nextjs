// #1475 —— 往 site/en/pages/ 写一页 features-1475.json，放五块 features-new（带编号的 grid / list、没编号、渐变、坏图标名），
// 给 e2e「真站产物」那几格用。跑法：cd templates/nextjs && node scripts/fixtures/features-new-demo-page.js（要先有一个 site/），然后 npm run build。
'use strict';
const fs = require('fs');
const path = require('path');
const { DEMO_CONTENT, FEATURES_NEW_STEPS } = require('../lib/demo-content');

const clone = (v) => JSON.parse(JSON.stringify(v));
const lean = (d) => { const x = clone(d); delete x.introImage; delete x.itemsImage; delete x.bg; return x; };
const DEMO = DEMO_CONTENT['features-new'];
const noNum = lean(DEMO); noNum.options = { itemConnector: 'line' };
const bad = lean(DEMO); bad.items[1].icon = 'no-such-icon-xyz';
const blocks = [
  ['fx-steps-grid', 'grid', { ...lean(FEATURES_NEW_STEPS), options: { itemConnector: 'line' } }],
  ['fx-steps-list', 'grid', { ...lean(FEATURES_NEW_STEPS), options: { itemConnector: 'line', itemsLayout: 'list', itemIcon: 'left' } }],
  ['fx-no-number', 'grid', noNum],
  ['fx-gradient', 'cards', { ...lean(DEMO), bg: { stops: ['#7d52f4', '#f7b733'], angle: 135 } }],
  ['fx-bad-icon', 'grid', bad],
].map(([id, shape, data], i) => ({ id, type: 'features-new', shape, role: 'essential', region: 'content', weight: i * 10, data }));
const page = { slug: 'features-1475', title: 'Features 1475', description: 'features-new fixture', changeFrequency: 'monthly', priority: 0.1, blocks };
const out = path.join(__dirname, '..', '..', 'site', 'en', 'pages', 'features-1475.json');
fs.writeFileSync(out, JSON.stringify(page, null, 2));
console.log(`wrote ${out} (${blocks.length} blocks)`);
