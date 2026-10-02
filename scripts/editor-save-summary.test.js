#!/usr/bin/env node
/**
 * editor-save-summary.test.js — #1454：编辑器每次 Save 在 AI chat 里留的那句人话（`editor-convert.js` §describeSave）。
 *
 *   node scripts/editor-save-summary.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * schema 用这个模板**自己的**区块库现算（`editor-schema.js` §editorSchema），不手写块名 / 字段名：记录里的字
 * 必须是老板在编辑器面板上看到的那几个，而那几个只住在 manifest 里。外壳三样（#1425 T3 起）的字段名从 `EditorApp.tsx` 的
 * §ROOT_FIELD_LABELS 读（面板用的就是那一份）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const eq = (got, want, m) => (got === want ? ok(`${m} → ${JSON.stringify(got)}`) : bad(`${m} —— got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let describeSave; let schema; let rootLabels;
try {
  ({ describeSave } = require('./lib/editor-convert.js'));
  schema = require('./lib/editor-schema.js').editorSchema({});
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/components/editor/EditorApp.tsx'), 'utf8');
  const m = src.match(/const ROOT_FIELD_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
  if (!m) die('EditorApp.tsx 里找不到 ROOT_FIELD_LABELS —— 外壳四样的字段名没法对上面板');
  rootLabels = Object.fromEntries([...m[1].matchAll(/(\w+):\s*'([^']*)'/g)].map((x) => [x[1], x[2]]));
} catch (e) { die(`起不来：${e.message}`); }
if (typeof describeSave !== 'function') die('editor-convert.js 没有导出 describeSave');
// #1425（T3）：公告条文字 topbarMessage 随公告条那个区退役，外壳只剩 layout / headerShape / footerShape。
for (const f of ['layout', 'headerShape', 'footerShape']) if (!rootLabels[f]) die(`ROOT_FIELD_LABELS 里没有 ${f}`);

const label = (type) => { const c = schema.components.find((x) => x.type === type); if (!c) die(`区块库里没有 ${type}`); return c; };
const hero = label('hero');
const bar = label('cta'); // #1425（T3）：原来是 announcement-bar（随旧库删了），换成同样只有一句短字段的 cta
const fieldLabel = (c, slot) => { const f = c.fields.find((x) => x.slot === slot); if (!f) die(`${c.type} 没有字段 ${slot}`); return f.label; };

const saved = {
  blocks: [
    { id: 'home-cta-0', type: 'cta', data: { body: 'Spring sale' } },
    { id: 'home-hero-1', type: 'hero', data: { headline: 'Old headline', subheadline: 'Old sub' } },
  ],
};
const edit = (fn) => { const j = JSON.parse(JSON.stringify(saved)); fn(j); return j; };
const run = (a) => describeSave({ saved, json: null, root: null, shared: null, schema, rootLabels, shapeLabel: 'Layout', ...a });

console.log('① 一个块一个字段');
eq(run({ json: edit((j) => { j.blocks[0].data.body = '123🎉'; }) }), `${bar.label} · ${fieldLabel(bar, 'body')}`, '改 CTA 的 Body');

console.log('② 一个块两个字段（照 schema 的字段顺序）');
eq(run({ json: edit((j) => { j.blocks[1].data.subheadline = 'b'; j.blocks[1].data.headline = 'a'; }) }),
  `${hero.label} · ${fieldLabel(hero, 'headline')}, ${fieldLabel(hero, 'subheadline')}`, '改 Hero 的两个字段');

console.log('③ 一次 Save 改了两个块 → 两个都列');
eq(run({ json: edit((j) => { j.blocks[0].data.body = 'x'; j.blocks[1].data.headline = 'y'; }) }),
  `${bar.label} · ${fieldLabel(bar, 'body')}; ${hero.label} · ${fieldLabel(hero, 'headline')}`, '两个块');

console.log('④ 外壳：选一项的字段带上新值');
// 📌 #1425（T3）—— 这里原来还测「公告条文字只说字段名」（topbarMessage）；公告条那个区随旧库删了，今天外壳三样全是选一项。
eq(run({ root: { layout: 'standard' } }), `${rootLabels.layout} → standard`, '改 Page layout');
eq(run({ root: { headerShape: 'topbar' } }), `${rootLabels.headerShape} → topbar`, '改 Header style');
eq(run({ root: { footerShape: '' } }), `${rootLabels.footerShape} → (default)`, '把 Footer style 改回默认');
eq(run({ json: edit((j) => { j.blocks[0].data.body = 'x'; }), root: { layout: 'standard' } }),
  `${bar.label} · ${fieldLabel(bar, 'body')}; ${rootLabels.layout} → standard`, '页面 + 外壳同一笔');

console.log('⑤ 增 / 删 / 只挪位置 / 换形态');
eq(run({ json: edit((j) => { j.blocks.push({ id: 'home-hero-2', type: 'hero', data: {} }); }) }), `${hero.label} (added)`, '加一块');
eq(run({ json: edit((j) => { j.blocks.splice(0, 1); }) }), `${bar.label} (removed)`, '删一块');
eq(run({ json: edit((j) => { j.blocks.reverse(); j.blocks[0].weight = 0; j.blocks[1].weight = 10; }) }), 'Section order', '只挪了位置');
eq(run({ json: edit((j) => { j.blocks[1].shape = 'split'; }) }), `${hero.label} · Layout`, '换了形态');

console.log('⑥ 共用块：按块库里那一块的类型取名');
eq(run({ shared: { 'site-bar': { data: { body: 'x' }, was: {} } }, siteBlocks: { 'site-bar': { type: 'cta', data: {} } } }),
  `${bar.label} · ${fieldLabel(bar, 'body')}`, '改共用块的字');
eq(run({ shared: { 'site-bar': { unlist: true } }, siteBlocks: { 'site-bar': { type: 'cta', data: {} } } }),
  `${bar.label} (removed from this page)`, '从这一页拿掉共用块');

console.log('⑦ 反向：比的底是「上一次存下去的那份」，不是打开时那份');
// 第一笔改了 body 并存下（saved 变成那一份），第二笔只改 headline：第二条记录不许把 body 再说一遍。
const afterFirst = edit((j) => { j.blocks[0].data.body = 'first save'; });
const second = JSON.parse(JSON.stringify(afterFirst)); second.blocks[1].data.headline = 'second save';
eq(describeSave({ saved: afterFirst, json: second, root: null, shared: null, schema, rootLabels }),
  `${hero.label} · ${fieldLabel(hero, 'headline')}`, '连存两笔，第二笔只说它自己');
eq(describeSave({ saved, json: second, root: null, shared: null, schema, rootLabels }),
  `${bar.label} · ${fieldLabel(bar, 'body')}; ${hero.label} · ${fieldLabel(hero, 'headline')}`,
  '（对照）拿打开时那份当底，就会把第一笔又说一遍 —— 所以调用方必须传 saved');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
