#!/usr/bin/env node
/**
 * toolbar-groups.test.js — 工具条按语义分组（#1532）的机械检查。
 *
 * 跑法:  node scripts/lib/toolbar-groups.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① §arrangeToolbar 自己：按声明排、这条工具条没有的控件跳过、空组去掉、没被声明的接在最后、不声明 = 一组
 *   ② AC2：17 个块按 manifest 的 `toolbarGroups` 排出来的序列，逐字等于票面那张表（admin 那条工具条，含 `count:*`）；
 *          单格页那一侧（不画数量控件，#1479 四审 1）= 同一行去掉 `count:*`，组被跳空就整组去掉
 *   ③ AC3：每块分组之后的控件集合 == 它工具条上全部控件的集合（只换位置、不增不删）
 *   ④ AC1：分组从 manifest 来 —— 改一处声明分界跟着变；删掉声明退回单排（就是没有声明时的原序），不报错
 *   ⑤ 声明校验（§knobDeclarationProblems）：17 份真 manifest 0 问题；写了不存在的控件 / 重复 / 形状不对 ⟹ 报
 *
 * 序列的写法 = e2e `barSequence()`：`presets` 恒为第一组，组间写 `|`，颜色槽写 `color:<槽>`（PM 2026-10-02 21:24 定）。
 * 浏览器那一半（三条工具条真按这个画、分界元素落在哪）在 `tests/e2e/specs/1532-toolbar-groups.spec.ts`。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const eq = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want) ? ok(m) : bad(`${m}\n       期望 ${JSON.stringify(want)}\n       读到 ${JSON.stringify(got)}`));
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let bk;
try {
  bk = require('./block-knobs.js');
} catch (e) {
  die(`读不到 block-knobs.js: ${e.message}`);
}
const { arrangeToolbar, toolbarControlsOf, toolbarGroupsOf, knobDeclarationProblems } = bk;
if (typeof arrangeToolbar !== 'function' || typeof toolbarControlsOf !== 'function' || typeof toolbarGroupsOf !== 'function') die('block-knobs.js 没导出 arrangeToolbar / toolbarControlsOf / toolbarGroupsOf');

const BLOCKS = path.resolve(__dirname, '..', '..', 'blocks');
// #1534 —— 盘上的 slots.bg 是 { ref: 'bg' }，走读入口展开（直接 JSON.parse 认不出 bg 是颜色槽，color:bg 那一组就对不上）。
const { readManifest } = require('./shared-slots');
const manifestOf = (b) => readManifest(path.join(BLOCKS, b, 'manifest.json'));
const seq = (groups) => ['presets', ...groups.flatMap((g, i) => (i === 0 ? ['|', ...g] : ['|', ...g]))].join(' ');

// ── ① ────────────────────────────────────────────────────────────────────────────────────────────
console.log('① arrangeToolbar');
eq(arrangeToolbar(['a', 'b', 'c', 'd'], [['c', 'a'], ['d']]), [['c', 'a'], ['d'], ['b']], '按声明排；没被声明的 b 接在最后一组');
eq(arrangeToolbar(['a', 'b'], [['a', 'x'], ['y'], ['b']]), [['a'], ['b']], '这条工具条没有的控件（x / y）跳过，被跳空的组去掉');
eq(arrangeToolbar(['a', 'b'], []), [['a', 'b']], '不声明 ⟹ 一组，原序');
eq(arrangeToolbar(['a', 'b'], undefined), [['a', 'b']], 'undefined 同不声明');
eq(arrangeToolbar(['a', 'b'], [['a', 'a', 'b'], ['b']]), [['a', 'b']], '同一个控件只排一次（先声明的那一处）');
eq(arrangeToolbar([], [['a']]), [], '工具条上一个控件都没有 ⟹ 没有组');

// ── ② AC2 ────────────────────────────────────────────────────────────────────────────────────────
// 票面 AC2 那张表（`origin/main 2ee8e85a` 现取），只把颜色槽写成 `color:<槽>`。
const AC2 = {
  blog: 'presets | introPosition introAlign choice:introEyebrow.style | itemsLayout itemsColumns | itemStyle itemImage | color:bg',
  contact: 'presets | introPosition introAlign choice:introEyebrow.style | sidePosition form formStyle | itemsLayout itemStyle itemAlign itemIcon | map | color:bg',
  content: 'presets | headlinePosition textAlign choice:introEyebrow.style | textStyle count:ctas | image | frame | color:bg',
  cta: 'presets | layout frame textAlign image form | choice:eyebrow.style count:ctas | color:bg',
  faq: 'presets | introPosition introAlign choice:introEyebrow.style part:help | itemsMode itemsColumns | itemStyle itemToggle | color:bg',
  features: 'presets | introPosition introAlign choice:introEyebrow.style count:introCtas introImage | itemsLayout itemsColumns itemsImage | itemStyle itemAlign itemIcon itemImage itemConnector | color:bg',
  footer: 'presets | layout brand cta | color:bg | form',
  gallery: 'presets | introPosition introAlign choice:introEyebrow.style | itemsLayout itemsColumns | itemShape itemCaption | color:bg',
  header: 'presets | logo menu bool:topbar | color:bg | bool:icons',
  hero: 'presets | textAlign image form | color:bg | part:proof part:stats part:logos part:band | choice:eyebrow.style',
  logos: 'presets | introPosition introAlign choice:introEyebrow.style introSize | itemsLayout itemsColumns | itemStyle logoColor | color:bg',
  milestones: 'presets | blockImage | introPosition introAlign choice:introEyebrow.style count:introCtas introImage | statsColumns statSize | statStyle statAlign bool:statIcon | color:bg',
  'page-header': 'presets | headlinePosition textAlign choice:introEyebrow.style | count:ctas | image | color:bg',
  pricing: 'presets | introPosition introAlign choice:introEyebrow.style part:highlights part:proof part:logos part:billing | plansColumns planFeatures | planStyle planAlign planCta featured color:featuredColor | color:bg',
  reviews: 'presets | introPosition introAlign total choice:introEyebrow.style | itemsLayout itemStyle itemAlign | color:bg',
  team: 'presets | introPosition introAlign choice:introEyebrow.style part:join | membersColumns | memberPhoto photoShape memberStyle memberAlign | color:bg',
  testimonials: 'presets | introPosition introAlign choice:introEyebrow.style | part:summary summaryStyle | itemsLayout itemsColumns | itemStyle quoteSize itemAlign | color:bg',
};
// 单格页那一侧：去掉 `count:*`，组被跳空就去掉那条分界（PM 三审 (a)）。
const cellSide = (line) => line.split(' | ').map((g) => g.split(' ').filter((t) => !t.startsWith('count:')).join(' ')).filter(Boolean).join(' | ');

console.log('② AC2 —— 17 个块的序列（admin 一侧含 count:*，单格页一侧不含）');
const blocks = fs.readdirSync(BLOCKS).filter((b) => fs.existsSync(path.join(BLOCKS, b, 'manifest.json'))).sort();
if (blocks.length === 0) die(`${BLOCKS} 下一个块都没有`);
eq(blocks, Object.keys(AC2).sort(), `块的集合 == AC2 表的 17 行（${blocks.length} 个）`);
for (const b of blocks) {
  const m = manifestOf(b);
  const all = toolbarControlsOf(m);
  const admin = seq(arrangeToolbar(all, toolbarGroupsOf(m)));
  eq(admin, AC2[b], `${b}：admin  ${admin}`);
  const cell = seq(arrangeToolbar(all.filter((t) => !t.startsWith('count:')), toolbarGroupsOf(m)));
  if (AC2[b]) eq(cell, cellSide(AC2[b]), `${b}：单格页 ${cell}`);
}
{
  // 那条唯一会少一条分界的（数量控件独占一组），点名验一次 —— 上面那格对「组被跳空」是不是真去掉了分界没有专门的话。
  const m = manifestOf('page-header');
  const cell = arrangeToolbar(toolbarControlsOf(m).filter((t) => !t.startsWith('count:')), toolbarGroupsOf(m));
  const admin = arrangeToolbar(toolbarControlsOf(m), toolbarGroupsOf(m));
  eq([admin.length, cell.length], [4, 3], 'page-header：admin 4 组、单格页 3 组（count:ctas 那一组被跳空，分界一起去掉）');
}

// ── ③ AC3 ────────────────────────────────────────────────────────────────────────────────────────
console.log('③ AC3 —— 控件集合不变');
for (const b of blocks) {
  const m = manifestOf(b);
  const all = toolbarControlsOf(m);
  const grouped = arrangeToolbar(all, toolbarGroupsOf(m)).flat();
  eq([...grouped].sort(), [...all].sort(), `${b}：分组后 ${grouped.length} 个控件 == 工具条上的 ${all.length} 个（不增不删）`);
}

// ── ④ AC1 ────────────────────────────────────────────────────────────────────────────────────────
console.log('④ AC1 —— 分组从 manifest 来');
{
  const m = manifestOf('features');
  const all = toolbarControlsOf(m);
  const before = seq(arrangeToolbar(all, toolbarGroupsOf(m)));
  const moved = JSON.parse(JSON.stringify(m));
  // 改一处：把 introImage 从 intro 组挪进 items 组。
  moved.toolbarGroups[0] = moved.toolbarGroups[0].filter((t) => t !== 'introImage');
  moved.toolbarGroups[1].unshift('introImage');
  const after = seq(arrangeToolbar(all, toolbarGroupsOf(moved)));
  if (after !== before && after.includes('count:introCtas | introImage itemsLayout')) ok(`改一处声明，分界跟着变：${after}`);
  else bad(`改了声明，序列没跟着变：${after}`);
  const dropped = JSON.parse(JSON.stringify(m));
  delete dropped.toolbarGroups;
  eq(arrangeToolbar(all, toolbarGroupsOf(dropped)), [all], '删掉声明 ⟹ 退回单排（一组，没有声明时的原序）');
  eq(knobDeclarationProblems(dropped).filter((p) => p.includes('toolbarGroups')), [], '删掉声明不报错');
}

// ── ⑤ 声明校验 ────────────────────────────────────────────────────────────────────────────────────
console.log('⑤ 声明校验');
for (const b of blocks) {
  const p = knobDeclarationProblems(manifestOf(b)).filter((x) => x.includes('toolbarGroups'));
  if (p.length) bad(`${b}：${p.join(' · ')}`);
}
ok(`${blocks.length} 份真 manifest 的 toolbarGroups 声明 0 问题`);
{
  const m = manifestOf('header');
  const cases = [
    [[['logo', 'menu', 'bool:nope']], 'bool:nope', '写了不存在的控件'],
    [[['logo'], ['logo']], '出现了两次', '同一个控件出现两次'],
    [[['logo'], []], '空组', '空组'],
    ['logo', '字符串数组的数组', '形状不对'],
  ];
  for (const [tg, needle, what] of cases) {
    const p = knobDeclarationProblems({ ...m, toolbarGroups: tg }).filter((x) => x.includes('toolbarGroups'));
    if (p.some((x) => x.includes(needle))) ok(`${what} ⟹ 报：${p[0]}`);
    else bad(`${what} 没报（读到 ${JSON.stringify(p)}）`);
  }
}

console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
