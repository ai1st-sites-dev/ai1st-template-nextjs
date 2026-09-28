#!/usr/bin/env node
/**
 * header-knobs.test.js — #1462：预设 + 旋钮那两个纯函数（`scripts/lib/header-knobs.js`）。
 *
 * 跑法:  node scripts/lib/header-knobs.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 验收 3「编辑器那一次」就是这里：工具栏拧旋钮时调的是 `normalizeKnobs(…, { changed })`，跟 Section 渲染时
 * 同一个函数（Section 那一次在 `scripts/header-new-render.test.js` ③）。数据全从真 manifest 读。
 * #1468：logo 三档、menu 的 right 改叫 beside、topbar 从旋钮变成归预设管的布尔（验收 2 / 6 在这里）。
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
  { name: 'logo', values: ['left', 'center', 'right'] },
  { name: 'menu', values: ['beside', 'center', 'split', 'gathered', 'below'] },
]), '旋钮 = logo（left · center · right）· menu（beside · center · split · gathered · below），顺序即工具栏顺序', JSON.stringify(knobs));
check(!knobs.some((k) => k.name === 'topbar'), 'topbar 不再是旋钮');
check(eq(coupling, ['logo', 'menu']), 'knobCoupling = [logo, menu]');
check(h.knobsOf({ slots: { options: { shape: '{dark: bool, icons: bool}' } } }).length === 0, '只有布尔开关的块 ⟹ 0 个旋钮（开关不是旋钮）');
check(h.knobsOf({ slots: { options: { shape: '{logo: "left" | "center"}' } } }).length === 0, '枚举只写在 shape 串里不算旋钮（位置冻在 slots.options.knobs）');
check(h.couplingOf({}) === null && h.presetsOf({}).length === 0, '没声明 ⟹ 无耦合、无预设');
check(presets.every((p) => Object.keys(p).sort().join() === 'knobs,name,options,shape' && Object.keys(p.knobs).sort().join() === 'logo,menu'
  && Object.keys(p.options).join() === 'topbar' && typeof p.options.topbar === 'boolean'),
  '每条预设是 { name, shape, knobs:{logo,menu}, options:{topbar: bool} }');
check(eq(h.presetBooleansOf(presets), ['topbar']), '归预设管的布尔 = [topbar]（dark / icons 没有预设写）');
check(eq(presets.filter((p) => p.options.topbar).map((p) => p.name), ['topbar', 'topbar-stacked']), 'topbar 开的预设 = topbar · topbar-stacked');
// 写坏的项跳过、不抛；多出来的可选字段（hero 那边可能有 group）原样留着不碍事。
check(h.presetsOf({ presets: [{ name: 'A' }, { name: 'B', shape: 'b', knobs: { x: '1' }, group: 'g' }, null] }).map((p) => p.name).join() === 'B',
  '坏的预设项被跳过，带可选字段的照收');
check(h.knobsOf({ slots: { options: { knobs: [{ name: 'x' }, { name: 'y', values: ['1', '2'] }] } } }).map((k) => k.name).join() === 'y', '坏的旋钮项被跳过');
check(h.presetForShape(presets, 'topbar-stacked') && h.presetForShape(presets, 'topbar-stacked').name === 'topbar-stacked' && h.presetForShape(presets, 'nope') === null,
  'presetForShape 按目录名找预设');
check(eq(h.presetBooleans(presets, 'topbar'), { topbar: true }) && eq(h.presetBooleans(presets, 'logo-left'), { topbar: false }) && h.presetBooleans(presets, 'nope') === null,
  'presetBooleans：topbar ⟹ 开 · logo-left ⟹ 关 · 不认识 ⟹ null');

console.log('\n② 纠正（工具栏：拧了谁谁不让步 · 验收 6）');
const turn = (from, name, value) => h.normalizeKnobs({ ...from, [name]: value }, { ...ctx, changed: name, base: from });
const LB = { logo: 'left', menu: 'beside' };
check(eq(turn(LB, 'logo', 'center'), { logo: 'center', menu: 'split' }), '拧 logo=center（menu 原是 beside）⟹ menu 被纠正成 split');
check(eq(turn({ logo: 'center', menu: 'split' }, 'menu', 'below'), { logo: 'center', menu: 'below' }), '拧 menu=below（logo 已是 center）⟹ 不动');
check(eq(turn(LB, 'menu', 'below'), { logo: 'center', menu: 'below' }), '拧 menu=below（logo 原是 left）⟹ logo 变 center');
check(eq(turn({ logo: 'right', menu: 'center' }, 'menu', 'below'), { logo: 'center', menu: 'below' }), '拧 menu=below（logo 原是 right）⟹ logo 变 center');
check(eq(turn({ logo: 'center', menu: 'split' }, 'logo', 'right'), { logo: 'right', menu: 'beside' }), '拧 logo=right（menu 原是 split）⟹ menu 变 beside');
check(eq(turn({ logo: 'center', menu: 'below' }, 'logo', 'right'), { logo: 'right', menu: 'beside' }), '拧 logo=right（menu 原是 below）⟹ menu 变 beside');
check(eq(turn({ logo: 'left', menu: 'center' }, 'logo', 'right'), { logo: 'right', menu: 'center' }), '拧 logo=right（menu 原是 center）⟹ 成立，不动');
check(eq(turn(LB, 'logo', 'right'), { logo: 'right', menu: 'beside' }), '拧 logo=right（menu 原是 beside）⟹ 成立，不动');
check(eq(turn({ logo: 'center', menu: 'below' }, 'logo', 'left'), { logo: 'left', menu: 'beside' }), '拧 logo=left（menu 原是 below）⟹ beside');
check(eq(turn({ logo: 'center', menu: 'split' }, 'menu', 'beside').logo, 'left'), '拧 menu=beside（logo 原是 center）⟹ logo 让步成 left');
check(eq(h.normalizeKnobs({ logo: 'center', menu: 'beside' }, ctx).menu, 'split'), '不知道拧了谁（Section 渲染）⟹ logo 为准');
check(eq(h.normalizeKnobs({ logo: 'right', menu: 'gathered' }, ctx), { logo: 'right', menu: 'beside' }), '不知道拧了谁 + logo=right + gathered ⟹ beside（logo 为准）');
check(h.normalizeKnobs({ logo: 'nope', menu: 'x' }, { ...ctx, base: { logo: 'center', menu: 'below' } }).menu === 'below', '值域外的值落回 base');
// 穷举：两个旋钮所有组合 × 每一种「拧了谁」，结果都成立（logo=right 按 left 算），被拧的那个不被改。
{
  let n = 0; const broken = [];
  const okPair = (r) => (r.logo === 'center' ? ['split', 'gathered', 'below'] : ['beside', 'center']).includes(r.menu);
  for (const logo of knobs[0].values) for (const menu of knobs[1].values) {
    for (const changed of [undefined, 'logo', 'menu']) {
      const r = h.normalizeKnobs({ logo, menu }, { ...ctx, changed });
      n += 1;
      if (!okPair(r)) broken.push(`${logo}/${menu}/${changed} ⟹ ${r.logo}/${r.menu}`);
      if (changed && r[changed] !== { logo, menu }[changed]) broken.push(`${changed} 被改了`);
    }
  }
  check(n === 45 && broken.length === 0, `穷举 ${n} 种输入：纠正后 logo∈{left,right} 配 beside|center、logo=center 配 split|gathered|below，被拧的那个旋钮不被改`, broken.slice(0, 4).join(' · '));
}
// 反向对照 ①：不给耦合 ⟹ logo=center + menu=beside 原样留着（证明上面那几格靠的是 coupling，不是巧合）。
check(h.normalizeKnobs({ logo: 'center', menu: 'beside' }, { knobs, presets, coupling: null }).menu === 'beside', '反向对照：不给 knobCoupling ⟹ 不纠正');
// 反向对照 ②：「没有预设用过的取值按默认值算」这条是承重的 —— 把 logo 的默认挪成 center，logo=right 就按 center 配，
// 拧到 logo=right + beside 会被纠正成 split。
{
  const k2 = [{ name: 'logo', values: ['center', 'left', 'right'] }, knobs[1]];
  check(h.normalizeKnobs({ logo: 'right', menu: 'beside' }, { knobs: k2, presets, coupling, changed: 'logo' }).menu === 'split',
    '反向对照：logo 的默认换成 center ⟹ logo=right + beside 被纠正走（上面 logo=right 那几格靠的是这条规则）');
}

console.log('\n③ 认预设（旋钮 + topbar 一起比，dark / icons 不看）');
for (const p of presets) check(h.presetOf({ ...p.knobs, ...p.options }, ctx) === p.name, `${p.name} 的旋钮 + topbar ⟹ ${p.name}`);
check(h.presetOf({ logo: 'left', menu: 'beside' }, ctx) === 'logo-left', 'topbar 没写 = 关 ⟹ logo-left');
check(h.presetOf({ logo: 'left', menu: 'beside', topbar: true }, ctx) === 'topbar', 'logo-left 上打开 topbar ⟹ topbar（验收 5）');
check(h.presetOf({ logo: 'left', menu: 'beside', topbar: false, dark: true, icons: true }, ctx) === 'logo-left', '打开 dark / icons ⟹ 预设名不变（验收 5）');
check(h.presetOf({ logo: 'center', menu: 'split', topbar: true }, ctx) === 'custom', 'center/split + topbar ⟹ custom');
check(h.presetOf({ logo: 'right', menu: 'beside' }, ctx) === 'custom', 'logo=right ⟹ custom（没有预设在右）');
check(new Set(presets.map((p) => `${p.knobs.logo}|${p.knobs.menu}|${p.options.topbar}`)).size === presets.length, '7 个预设的组合（旋钮 + topbar）两两不同');
// 反向对照：认预设时不看 topbar ⟹ topbar 会被认成 logo-left（先声明的那个）。
{
  const blind = presets.map((p) => ({ ...p, options: undefined }));
  check(h.presetOf({ logo: 'left', menu: 'beside', topbar: true }, { knobs, presets: blind }) === 'logo-left',
    '反向对照：预设不带 options ⟹ logo-left + topbar 开被认成 logo-left（上面那格靠的是 topbar 参与比较）');
}

console.log('\n④ manifest 声明校验（block-knobs.js §knobDeclarationProblems · 验收 2）');
{
  const fs = require('fs');
  const bk = require('./block-knobs.js');
  const dir = path.join(__dirname, '..', '..', 'blocks', 'header-new');
  const withShapes = (mm) => ({ ...mm, shapes: fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ name: e.name })) });
  const clone = (v) => JSON.parse(JSON.stringify(v));
  check(eq(bk.knobDeclarationProblems(withShapes(m)), []), '真 manifest ⟹ 空数组');
  check(/topbar: bool/.test(m.slots.options.shape) && !/\breverse\b/.test(JSON.stringify(m)), 'options.shape 里 topbar 是 `: bool`，manifest 里没有 reverse');
  const m1 = clone(m); m1.presets.find((p) => p.name === 'topbar').options.topbar = false;
  const p1 = bk.knobDeclarationProblems(withShapes(m1));
  check(p1.some((x) => x.includes('"topbar"') && x.includes('"logo-left"') && x.includes('一模一样')), '对照：topbar 预设的 options.topbar 改成 false ⟹ 报它跟 logo-left 一模一样', JSON.stringify(p1));
  const m2 = clone(m); delete m2.presets.find((p) => p.name === 'stacked').options.topbar;
  const p2 = bk.knobDeclarationProblems(withShapes(m2));
  check(p2.some((x) => x.includes('"stacked"') && x.includes('没写 options.topbar')), '对照：删掉 stacked 的 options.topbar ⟹ 报它少写了', JSON.stringify(p2));
  const m3 = clone(m); m3.presets[0].options.topbar = 'yes'; m3.presets[1].options.nope = true;
  const p3 = bk.knobDeclarationProblems(withShapes(m3));
  check(p3.some((x) => x.includes('只能是 true / false')) && p3.some((x) => x.includes('"nope"') && x.includes('不是 slots.options.shape 里声明的布尔')),
    '对照：值不是布尔 / 键不是声明过的布尔 ⟹ 各报一条', JSON.stringify(p3));
  // block-knobs 那一侧的「实际值」与「是哪个预设」跟 header-knobs 同一口径。
  check(eq(bk.effectivePresetBooleans(m, 'topbar', {}), { topbar: true }) && eq(bk.effectivePresetBooleans(m, 'topbar', { topbar: false }), { topbar: false })
    && eq(bk.effectivePresetBooleans(m, 'nope', {}), { topbar: false }), 'effectivePresetBooleans：形态给底、options 写了就盖、形态不认识 ⟹ false');
  check(bk.presetNameFor(m, { logo: 'left', menu: 'beside', topbar: true }) === 'topbar' && bk.presetNameFor(m, { logo: 'left', menu: 'beside' }) === 'logo-left',
    'presetNameFor 连 topbar 一起比');
}

console.log(`\n${fail ? '🔴' : '✅'} header-knobs: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
