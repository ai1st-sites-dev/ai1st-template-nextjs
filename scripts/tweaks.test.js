#!/usr/bin/env node
/**
 * tweaks.test.js — #1118 的两个新函数：`rootShapeDefaults()` 和 `baseVarsForSite()`。
 *
 *   node scripts/tweaks.test.js        （`npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么这两个函数值得一份测试 ────────────────────────────────────────────────────────────────
 * 它们是 #1118 从 `sync-config.js` 搬出来的，搬的目的就是**让构建和浏览器调同一份**：Customize 面板
 * 现在要为「没换过装的站」现算基准，而那组基准原来只有构建算得出。搬家本身的判据是「产物逐字节没变」
 * （交付留言里有那组 md5），这份测试守的是搬完之后的性质：
 *
 *   · 有风格设定 ⟹ 用它，**不许**再把 globals.css 的默认值混进去（混进去 = 老站的圆角被悄悄改掉）
 *   · 没有风格设定 ⟹ 落回 globals.css，且**按名字去重**（不去重 = custom.css 里每个名字写两遍）
 *   · 三个块常量不计进 `shapeCount`（有两处按这个数分支，算进去会让两处一起改判）
 *
 * 🔴 每一格都带一个反向对照：把实现换成「看起来也对」的那个写法，这一格必须变红。没有这半边的话，
 *    一格绿证明不了它在判事 —— 本仓已经为「合成夹具全绿而检测器是死的」付过账。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const tweaks = require('./tweaks.js');
const { settingsToCssVars } = require('./theme-settings.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

for (const name of ['rootShapeDefaults', 'baseVarsForSite', 'baseVarsFrom', 'buildCustomCss']) {
  if (typeof tweaks[name] !== 'function') die(`tweaks.js 没导出 ${name}`);
}

const GLOBALS = path.join(__dirname, '..', 'src', 'app', 'globals.css');
if (!fs.existsSync(GLOBALS)) die(`读不到 ${GLOBALS} —— 下面每一格都会空过`);
const globalsCss = fs.readFileSync(GLOBALS, 'utf-8');

// 一个真站的调色板（`site-baaf9c14` 的 brand.json，2026-08-19 dev 上取的）。用真站的原因：
// 合成的 `{primary:{500:'#000'}}` 走不到「10 档 + 7 档」那个形状，而档数正是下面几格数的东西。
const COLORS = {
  primary: {
    50: '#fdf4fa', 100: '#fbe8f5', 200: '#f6cae8', 300: '#eea1d6', 400: '#e26bbd',
    500: '#ab2f7e', 600: '#8d2568', 700: '#711e53', 800: '#55163e', 900: '#380f29',
  },
  accent: { 50: '#fff6ed', 100: '#ffe9d5', 200: '#fed0aa', 300: '#fdb174', 400: '#fb8a3c', 500: '#f26a0f', 600: '#cc520a' },
};
// 同一个站的风格设定 —— #1003 的**数值**形状。AI 建的站写的是这一种，**手写的那 30 套**主题写的是
// 档位词。🔴 语料（#1140，来源 #1083）：那 30 套 == `themes.js` 的 `retiredThemes`；今天注册表 110 套，
// 其中 30 枚举 / 80 数值（本轮按 `typeof settings.radius` 现数）。这一行不是在说注册表只有 30 套。
const NUMERIC_SETTINGS = { radius: 16, density: 1.05, shadowStrength: 0.22, buttonShape: 'pill' };

const names = (base) => base.vars.map(([n]) => n);
const valueOf = (base, name) => (base.vars.find(([n]) => n === name) || [])[1];

// ── ① rootShapeDefaults：解出来的就是 globals.css `:root` 里那几行 ──────────────────────────────
{
  const got = tweaks.rootShapeDefaults(globalsCss);
  // 分母就地算，不写死：这个数会随 globals.css 长（写死的数会过期，而过期了的样子跟没过期一样）。
  const rootBlock = globalsCss.slice(globalsCss.indexOf(':root {'), globalsCss.indexOf('}', globalsCss.indexOf(':root {')));
  const expect = [...rootBlock.matchAll(/(--(?:radius|section)-[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]);
  if (expect.length === 0) {
    bad('globals.css 的 `:root` 里一个 `--radius-*` / `--section-*` 都没解出来 —— 这一节量不到东西');
  } else if (got.length === expect.length && got.every(([n], i) => n === expect[i])) {
    ok(`rootShapeDefaults 解出 ${got.length} 个名字，与 :root 里那几行逐个同名同序（${expect.slice(0, 3).join(' ')} …）`);
  } else {
    bad(`rootShapeDefaults 解出 ${got.length} 个，:root 里有 ${expect.length} 个：${names({ vars: got }).join(' ')}`);
  }
  // 值也要真解出来，不是只解名字。
  const withValues = got.filter(([, v]) => typeof v === 'string' && v.length > 0);
  if (withValues.length === got.length) ok(`${got.length} 个名字都带上了值（例如 ${got[0][0]}=${got[0][1]}）`);
  else bad(`${got.length - withValues.length} 个名字解出来没有值`);

  // 反向对照：`:root` 之外的同名声明不许被收进来（把选择器改一个字，块就不该被认出）。
  const shifted = tweaks.rootShapeDefaults(globalsCss.replace(':root {', ':roots {'));
  if (shifted.length === 0) ok('反向对照：把 `:root {` 改成 `:roots {` ⟹ 解出 0 个（它认的是那个块，不是满文件抓正则）');
  else bad(`反向对照：改掉选择器之后还解出 ${shifted.length} 个 —— 它其实在满文件抓，`
    + '那么别的选择器里的同名声明也会被当成默认值');

  // 读不到文件那一支：不许抛，答空。
  if (tweaks.rootShapeDefaults('').length === 0 && tweaks.rootShapeDefaults(undefined).length === 0) {
    ok('空内容 / undefined ⟹ 答空数组，不抛（调用方按「拿不到默认值」处理，不是崩在半路）');
  } else {
    bad('空内容或 undefined 没有答空数组');
  }
}

// ── ② baseVarsForSite：有风格设定就用它，且不掺 globals.css 的默认值 ────────────────────────────
{
  const decls = settingsToCssVars(NUMERIC_SETTINGS);
  const base = tweaks.baseVarsForSite(COLORS, decls, tweaks.rootShapeDefaults(globalsCss));
  if (!base.fromSettings) {
    bad('这个站写了风格设定，却走了落回 globals.css 那一支 —— 它的圆角会被换成模板默认值');
  } else {
    ok(`写了风格设定 ⟹ fromSettings=true，shapeCount=${base.shapeCount}`);
  }
  // 🔴 承重的一格：`--radius-DEFAULT` 必须是这个站自己算出来的（radius:16 ⟹ 16px），
  // 不是 globals.css 的 0.25rem。两个值长得完全不一样，所以这一格分得开。
  const mine = valueOf(base, '--radius-DEFAULT');
  const theirs = (tweaks.rootShapeDefaults(globalsCss).find(([n]) => n === '--radius-DEFAULT') || [])[1];
  if (mine && mine !== theirs) ok(`--radius-DEFAULT = ${mine}（这个站自己的），不是 globals.css 的 ${theirs}`);
  else bad(`--radius-DEFAULT = ${mine}，而 globals.css 那份是 ${theirs} —— 默认值掺进来了`);
  // 阴影不在微扰会碰的范围里（`baseVarsFrom` 只收 --radius-* / --section-*），设定里有它也不该出现。
  const shadows = names(base).filter((n) => n.startsWith('--shadow-'));
  if (decls.some((d) => d.startsWith('--shadow-')) && shadows.length === 0) {
    ok('风格设定里有 --shadow-*，基准里没有（微扰不碰阴影，收窄口径没被搬坏）');
  } else if (shadows.length) {
    bad(`基准里出现了 ${shadows.length} 个 --shadow-* —— 微扰会去缩放阴影`);
  }
  // 名字不许重复：重复会让 buildCustomCss 为同一个名字写两行。
  const dup = names(base).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length === 0) ok(`基准里 ${base.vars.length} 个名字互不重复`);
  else bad(`重复的名字：${[...new Set(dup)].join(' ')}`);
}

// ── ③ 没有风格设定 ⟹ 落回 globals.css，并按名字去重 ────────────────────────────────────────────
{
  const rootDefaults = tweaks.rootShapeDefaults(globalsCss);
  const base = tweaks.baseVarsForSite(COLORS, [], rootDefaults);
  if (base.fromSettings) {
    bad('没有风格设定却答 fromSettings=true');
  } else if (base.shapeCount !== 0) {
    bad(`没有风格设定却 shapeCount=${base.shapeCount} —— 有两处按这个数分支，它们会一起改判`);
  } else {
    ok('没有风格设定 ⟹ fromSettings=false，shapeCount=0');
  }
  // globals.css 的每一个名字都要在里面（少一个 = 那一维滑块拖不动它）。
  const missing = rootDefaults.map(([n]) => n).filter((n) => !names(base).includes(n));
  if (missing.length === 0) ok(`globals.css 的 ${rootDefaults.length} 个名字全在基准里`);
  else bad(`缺了 ${missing.join(' ')} —— custom.css 不会为它们写覆盖行，滑块拖到头也纹丝不动`);
  // 🔴 去重：三个块常量 `baseVarsFrom` 自带一份、globals.css 里也有一份。
  const dup = names(base).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length === 0) ok('三个块常量在两边都有，去重之后每个名字只出现一次');
  else bad(`没去重：${[...new Set(dup)].join(' ')} 各出现了两次（custom.css 里会写两遍）`);
  // 反向对照：不传默认值 ⟹ 只剩 baseVarsFrom 自带的那三个块常量。
  // 这一格证明上面那圈绿真是「默认值被接上了」，不是「baseVarsFrom 本来就带着它们」。
  const without = tweaks.baseVarsForSite(COLORS, [], []);
  const shapeNames = (b) => names(b).filter((n) => /^--(radius|section)-/.test(n));
  if (shapeNames(without).length < shapeNames(base).length) {
    ok(`反向对照：不传 globals.css 的默认值 ⟹ 形状名字从 ${shapeNames(base).length} 掉到 `
      + `${shapeNames(without).length}（剩下的是 baseVarsFrom 自带的块常量）`);
  } else {
    bad(`反向对照：不传默认值时形状名字还是 ${shapeNames(without).length} 个 —— `
      + '那么上面那一格证明不了默认值真的被接上了');
  }
}

// ── ④ 两支产出的字节真的不同（否则前两节的绿是空的）────────────────────────────────────────────
{
  const rootDefaults = tweaks.rootShapeDefaults(globalsCss);
  const t = { hueShift: 0, radiusScale: 1, densityScale: 1.15 };
  const withSettings = tweaks.buildCustomCss(
    tweaks.baseVarsForSite(COLORS, settingsToCssVars(NUMERIC_SETTINGS), rootDefaults).vars, t, null,
  );
  const withDefaults = tweaks.buildCustomCss(
    tweaks.baseVarsForSite(COLORS, [], rootDefaults).vars, t, null,
  );
  if (!withSettings || !withDefaults) {
    bad('有一支产出了空字符串 —— 这一格分不出两支');
  } else if (withSettings !== withDefaults) {
    ok(`两支产出的 custom.css 不同（${withSettings.length} vs ${withDefaults.length} 字节）`
      + ' —— 所以「走错分支」这件事是量得出来的');
  } else {
    bad('两支产出逐字节相同 —— 那么「有没有风格设定」这个分支在产物上看不出来，'
      + '上面每一格都可能在判一件不存在的事');
  }
}

console.log(`\n${fail ? '❌' : '✅'} tweaks.test.js — ${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
