#!/usr/bin/env node
/**
 * header-knobs.test.js — #1462：预设 + 旋钮那两个纯函数（`scripts/lib/header-knobs.js`）。
 *
 * 跑法:  node scripts/lib/header-knobs.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 验收 3「编辑器那一次」就是这里：工具栏拧旋钮时调的是 `normalizeKnobs(…, { changed })`，跟 Section 渲染时
 * 同一个函数（Section 那一次在 `scripts/header-new-render.test.js` ③）。数据全从真 manifest 读。
 */

'use strict';

const path = require('path');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let h; let m;
try {
  h = require('./header-knobs.js');
  m = require(path.join(__dirname, '..', '..', 'blocks', 'header-new', 'manifest.json'));
} catch (e) { die(e.message); }
const knobs = h.knobsOf(m);
const presets = h.presetsOf(m);
const coupling = h.couplingOf(m);
if (!knobs.length || !presets.length) die('header-new 的 manifest 里读不到旋钮或预设 —— 分母塌了');
const ctx = { knobs, presets, coupling };

console.log('① 从 manifest 读出来的东西');
check(eq(knobs, [
  { name: 'logo', values: ['left', 'center'] },
  { name: 'menu', values: ['right', 'center', 'split', 'gathered', 'below'] },
  { name: 'topbar', values: ['none', 'contact'] },
]), '旋钮 = logo · menu · topbar，值域与定稿第 2 版相同、顺序即工具栏顺序', JSON.stringify(knobs));
check(eq(coupling, ['logo', 'menu']), 'knobCoupling = [logo, menu]');
check(h.knobsOf({ slots: { options: { shape: '{dark: bool, icons: bool}' } } }).length === 0, '只有布尔开关的块 ⟹ 0 个旋钮（开关不是旋钮）');
check(h.knobsOf({ slots: { options: { shape: '{logo: "left" | "center"}' } } }).length === 0, '枚举只写在 shape 串里不算旋钮（位置冻在 slots.options.knobs）');
check(h.couplingOf({}) === null && h.presetsOf({}).length === 0, '没声明 ⟹ 无耦合、无预设');
check(presets.every((p) => typeof p.name === 'string' && typeof p.shape === 'string' && p.knobs && Object.keys(p.knobs).sort().join() === 'logo,menu,topbar'),
  '每条预设是 { name, shape, knobs:{logo,menu,topbar} }（PM 19:01 冻结的形状）');
// 写坏的项跳过、不抛；多出来的可选字段（hero 那边可能有 group）原样留着不碍事。
check(h.presetsOf({ presets: [{ name: 'A' }, { name: 'B', shape: 'b', knobs: { x: '1' }, group: 'g' }, null] }).map((p) => p.name).join() === 'B',
  '坏的预设项被跳过，带可选字段的照收');
check(h.knobsOf({ slots: { options: { knobs: [{ name: 'x' }, { name: 'y', values: ['1', '2'] }] } } }).map((k) => k.name).join() === 'y', '坏的旋钮项被跳过');
check(h.presetForShape(presets, 'topbar-stacked') && h.presetForShape(presets, 'topbar-stacked').name === 'topbar-stacked' && h.presetForShape(presets, 'nope') === null,
  'presetForShape 按目录名找预设');

console.log('\n② 纠正（工具栏：拧了谁谁不让步）');
const turn = (from, name, value) => h.normalizeKnobs({ ...from, [name]: value }, { ...ctx, changed: name, base: from });
const LL = { logo: 'left', menu: 'right', topbar: 'none' };
check(eq(turn(LL, 'logo', 'center'), { logo: 'center', menu: 'split', topbar: 'none' }), '拧 logo=center（menu 原是 right）⟹ menu 被纠正成 split（验收 3）');
check(eq(turn({ ...LL, menu: 'center' }, 'logo', 'center').menu, 'split'), '拧 logo=center（menu 原是 center）⟹ split');
check(eq(turn({ logo: 'center', menu: 'below', topbar: 'contact' }, 'logo', 'left'), { logo: 'left', menu: 'right', topbar: 'contact' }), '拧 logo=left（menu 原是 below）⟹ right，topbar 不动');
check(eq(turn(LL, 'menu', 'gathered'), { logo: 'center', menu: 'gathered', topbar: 'none' }), '拧 menu=gathered（logo 原是 left）⟹ logo 让步成 center');
check(eq(turn({ logo: 'center', menu: 'split', topbar: 'none' }, 'menu', 'right').logo, 'left'), '拧 menu=right（logo 原是 center）⟹ logo 让步成 left');
check(eq(turn(LL, 'topbar', 'contact'), { logo: 'left', menu: 'right', topbar: 'contact' }), 'topbar 不参与耦合');
check(eq(h.normalizeKnobs({ logo: 'center', menu: 'right' }, ctx).menu, 'split'), '不知道拧了谁（Section 渲染）⟹ logo 为准');
check(h.normalizeKnobs({ logo: 'nope', menu: 'x', topbar: 'y' }, { ...ctx, base: { logo: 'center', menu: 'below', topbar: 'contact' } }).menu === 'below', '值域外的值落回 base');
// 穷举：3 个旋钮所有组合 × 每一种「拧了谁」，结果都成立。
{
  let n = 0; const broken = [];
  for (const logo of knobs[0].values) for (const menu of knobs[1].values) for (const topbar of knobs[2].values) {
    for (const changed of [undefined, 'logo', 'menu', 'topbar']) {
      const r = h.normalizeKnobs({ logo, menu, topbar }, { ...ctx, changed });
      n += 1;
      if (!presets.some((p) => p.knobs.logo === r.logo && p.knobs.menu === r.menu)) broken.push(`${logo}/${menu}/${changed}`);
      if (changed && changed !== 'topbar' && r[changed] !== { logo, menu, topbar }[changed]) broken.push(`${changed} 被改了`);
    }
  }
  check(broken.length === 0, `穷举 ${n} 种输入：纠正后 logo×menu 都成立，被拧的那个旋钮不被改`, broken.slice(0, 4).join(' · '));
}
// 反向对照：不给耦合 ⟹ logo=center + menu=right 原样留着（证明上面那几格靠的是 coupling，不是巧合）。
check(h.normalizeKnobs({ logo: 'center', menu: 'right', topbar: 'none' }, { knobs, presets, coupling: null }).menu === 'right', '反向对照：不给 knobCoupling ⟹ 不纠正');

console.log('\n③ 认预设');
for (const p of presets) check(h.presetOf(p.knobs, ctx) === p.name, `${p.name} 的旋钮值 ⟹ ${p.name}`);
check(h.presetOf({ logo: 'center', menu: 'split', topbar: 'contact' }, ctx) === 'custom', 'center/split/contact ⟹ custom');
check(h.presetOf({ logo: 'left', menu: 'center', topbar: 'contact' }, ctx) === 'custom', 'left/center/contact ⟹ custom');
check(new Set(presets.map((p) => `${p.knobs.logo}|${p.knobs.menu}|${p.knobs.topbar}`)).size === presets.length, '7 个预设的旋钮组合两两不同（否则 presetOf 认不全）');

console.log(`\n${fail ? '🔴' : '✅'} header-knobs: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
