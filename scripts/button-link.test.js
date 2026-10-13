#!/usr/bin/env node
/**
 * button-link.test.js — #1755：按钮的 Link Type ⇄ `href`（`lib/button-link.js`），以及「哪几列是按钮列表」（`editor-schema.js` 的 `button: true`）。
 *
 *   node scripts/button-link.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 浏览器里那一半（点按钮开弹窗、Done / Cancel、Page section 跳过去、Content 页同一套）在 e2e `tests/e2e/specs/1755-button-dialog.spec.ts`。
 */

'use strict';

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (got, want, m) => (same(got, want) ? ok(m) : bad(`${m} —— 得到 ${JSON.stringify(got)}，要 ${JSON.stringify(want)}`));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let lib; let schemaLib;
try {
  lib = require('./lib/button-link.js');
  schemaLib = require('./lib/editor-schema.js');
} catch (e) {
  die(`加载不了被测模块: ${e.message}`);
}
const { linkTypeOf, hrefFor, externalUrl, withButton, LINK_TYPES } = lib;

console.log('① 存着的 href → 选中哪一类（票正文做什么 3 那张表，逐行）');
check(LINK_TYPES, ['page', 'external', 'email', 'phone', 'section'], '五类、顺序同弹窗那一排');
check(linkTypeOf({ source: 'phone' }), { type: 'phone', business: true, value: '' }, '{source:"phone"} → Phone · Business phone');
check(linkTypeOf({ source: 'phone', location: 2 }), { type: 'phone', business: true, value: '' }, '带门店的引用 → 照样是 Business phone');
check(linkTypeOf('tel:+14165550100'), { type: 'phone', business: false, value: '+14165550100' }, 'tel: → Phone · Other number（框里是号码）');
check(linkTypeOf({ source: 'email' }), { type: 'email', business: true, value: '' }, '{source:"email"} → Email · Business email');
check(linkTypeOf('mailto:a@b.co'), { type: 'email', business: false, value: 'a@b.co' }, 'mailto: → Email · Other email');
check(linkTypeOf('#home-services-2'), { type: 'section', value: 'home-services-2' }, '# 开头 → Page section（块的 id）');
check(linkTypeOf('/about'), { type: 'page', value: '/about' }, '/ 开头 → Page link');
check(linkTypeOf('https://example.com'), { type: 'external', value: 'https://example.com' }, 'http 开头 → External link');
check(linkTypeOf(''), { type: 'page', value: '' }, '空串 → Page link，什么都不选');
check(linkTypeOf('#'), { type: 'page', value: '' }, '只有 # → Page link，什么都不选');
check(linkTypeOf(undefined), { type: 'page', value: '' }, '没写 → Page link，什么都不选');
check(linkTypeOf('TEL:123'), { type: 'phone', business: false, value: '123' }, '协议大小写不敏感');

console.log('② 所选那一类 + 那一格 → 存进去的 href（票正文做什么 2）');
check(hrefFor('page', { value: '/about' }), '/about', 'Page link → 站内地址');
check(hrefFor('external', { value: 'https://example.com' }), 'https://example.com', 'External link → 原样');
check(hrefFor('external', { value: ' example.com ' }), 'https://example.com', 'External link 没写协议 → 补 https://');
check(hrefFor('email', { business: true }), { source: 'email' }, 'Email 默认 → {source:"email"}');
check(hrefFor('email', { business: false, value: ' a@b.co ' }), 'mailto:a@b.co', 'Other email → mailto:');
check(hrefFor('phone', {}), { source: 'phone' }, 'Phone 默认（没说 business）→ {source:"phone"}');
check(hrefFor('phone', { business: true, location: 1 }), { source: 'phone', location: 1 }, '多门店第二家 → 带 location');
check(hrefFor('phone', { business: true, location: 0 }), { source: 'phone' }, '多门店第一家 → 不写 location（同 §LinkHrefControl）');
check(hrefFor('phone', { business: false, value: '+1 416 555 0100' }), 'tel:+14165550100', 'Other number → tel:，去空白');
check(hrefFor('section', { value: 'home-services-2' }), '#home-services-2', 'Page section → #<块 id>');
check(hrefFor('section', { value: '' }), '', 'Page section 没选 → 空');
check(externalUrl('mailto:x@y.z'), 'mailto:x@y.z', '带协议的不补');

console.log('③ 往返：每一类存进去再推回来，选中的还是它');
for (const [type, o] of [['page', { value: '/about' }], ['external', { value: 'https://example.com' }], ['email', { business: true }], ['email', { business: false, value: 'a@b.co' }],
  ['phone', { business: true }], ['phone', { business: false, value: '+14165550100' }], ['section', { value: 'home-hero-0' }]]) {
  const back = linkTypeOf(hrefFor(type, o));
  check([back.type, back.business === undefined ? null : back.business], [type, type === 'email' || type === 'phone' ? o.business !== false : null], `${type} ${JSON.stringify(o)} 往返`);
}

console.log('④ 一颗按钮改完：label / href 之外的键原样（票正文做什么 6）');
const before = { label: 'See what we charge', href: '/pricing', style: 'link', arrow: true, icon: 'star', size: 'sm', future: { x: 1 } };
const after = withButton(before, { label: 'Prices', href: { source: 'phone' } });
check(Object.keys(after).sort(), Object.keys(before).sort(), '键一个不少、一个不多');
check([after.style, after.arrow, after.icon, after.size, after.future], ['link', true, 'star', 'sm', { x: 1 }], 'style / arrow / icon / size / 以后加的 逐个相同');
check([after.label, after.href], ['Prices', { source: 'phone' }], 'label / href 换成新的');

console.log('⑤ 哪几列是按钮列表（schema `button: true`，按形状派生）');
const lists = [];
for (const c of schemaLib.editorSchema({}).components) for (const f of c.fields) if (f.button) lists.push(`${c.type}.${f.slot}`);
check(lists.sort(), ['content.ctas', 'cta.ctas', 'features.introCtas', 'hero.ctas', 'milestones.introCtas', 'page-header.ctas'], '恰好是票正文「范围」那六列');

console.log(`\n${fail ? '❌' : '✅'} ${pass} 过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);
