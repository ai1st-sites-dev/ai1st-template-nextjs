#!/usr/bin/env node
/**
 * site-settings-contract.test.js — dashboard 试穿发往站的风格设定变量，名字集合只许增不许减（#1541 r2）。
 *
 *   node scripts/site-settings-contract.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * 站那侧判「平台把风格设定发全了吗」用的是**计数**（`src/app/layout.tsx` 的 `setFull=(scN>=SETN_N)`），
 * 而 `SETN` 是从**站自己构建时**那张表派生的、烤在站自己的仓里、不会自己升级。#1541 r1 把 density 的
 * 横向三个名字从翻译器里拿掉 ⟹ 发出去 12 个，而在野的每一个站都还在数 15 个 ⟹ 全部存量站试穿时
 * 静默不换画法（QA2 r1 真浏览器四格表的第 2 格：ok:false / 'settings incomplete'）。
 * 这条契约是**单向**的：多发的名字站会按名跳过，少发一个就整批作废。所以这里钉的是 ⊇，不是 =。
 *
 * 🔴 FROZEN 是一张【冻结】名单，不是派生出来的 —— 派生的话它会跟着表一起变窄，正好守不住这件事。
 *    来历：按 layout.tsx 的 SETN 派生式在 `6f59364ad`（#1541 之前）上算出来的 15 个；2026-10-04 PM 用
 *    `gh api` 现取 `ai1st-sites/ai1st-template-nextjs` 与 `ai1st-sites-test/ai1st-template-nextjs`
 *    两个模板仓，DENSITY 都还是 5 个键 ⟹ 同一批 15 个。
 *    什么时候能收窄它：见 `theme-settings.js` 的 `SITE_LEGACY_DENSITY_X` 上面那段摘除判据。
 *
 * 🔴 每一格都带反向对照（同一进程、单变量）：从载荷里拿掉任一个冻结名字 ⟹ 当场红。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const REPO = path.resolve(NEXT, '..', '..');
const GLOBALS = path.join(NEXT, 'src', 'app', 'globals.css');
const THEME_MODAL = path.join(REPO, 'dashboard', 'src', 'components', 'ThemeModal.tsx');

const FROZEN = [
  '--radius-DEFAULT', '--radius-md', '--radius-lg', '--radius-xl', '--radius-2xl',
  '--shadow-DEFAULT', '--shadow-sm', '--shadow-md', '--shadow-lg',
  '--section-y', '--section-x', '--section-xSm', '--section-yMd', '--section-xLg',
  '--radius-button',
];
// 横向那三个只有存量站认；它们的**真值**（`6f59364ad` 那张 DENSITY 表的三列 / 数值形状的三个系数）。
const LEGACY = ['--section-x', '--section-xSm', '--section-xLg'];
const LEGACY_ENUM_VALUES = {
  standard: { '--section-x': '1rem', '--section-xSm': '1.5rem', '--section-xLg': '2rem' },
  compact: { '--section-x': '1rem', '--section-xSm': '1.25rem', '--section-xLg': '1.5rem' },
  airy: { '--section-x': '1.5rem', '--section-xSm': '2rem', '--section-xLg': '3rem' },
};
const LEGACY_NUMERIC_MULT = { '--section-x': 1, '--section-xSm': 1.5, '--section-xLg': 2 };

// 两种形状各一份**完整的**风格设定（四组都写）—— 少写一组的话缺名字是设定本身缺，不是契约破。
const ENUM_CASES = ['standard', 'compact', 'airy'].map((d) => ({
  name: `枚举形状 density=${d}`, density: d,
  settings: { radius: 'round', shadow: 'soft', density: d, buttonShape: 'pill' },
}));
const NUMERIC_CASES = [0.85, 1, 1.2].map((d) => ({
  name: `数值形状 density=${d}`, density: d,
  settings: { radius: 6, shadowStrength: 0.1, density: d, buttonShape: 'rounded' },
}));

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const skip = (m) => { console.log(`  ⏭  ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

/** `--a: 1rem;` → Map(name → value)。 */
function decls(list) {
  const out = new Map();
  for (const d of list) {
    const m = /^\s*(--[A-Za-z0-9-]+)\s*:\s*(.+?);?\s*$/.exec(d);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

/** 冻结名单里哪些不在这份载荷里。 */
const missingFrozen = (payload) => FROZEN.filter((n) => !decls(payload).has(n));

/** 新模板的站自己派生出的 SETN —— 与 layout.tsx 那段派生式同算法（三张表的键 + --radius-button）。 */
function newSiteSetn(T) {
  const out = new Set();
  for (const [table, prefix] of [[T.RADIUS, '--radius-'], [T.SHADOW, '--shadow-'], [T.DENSITY, '--section-']]) {
    for (const tier of Object.values(table)) for (const k of Object.keys(tier)) out.add(prefix + k);
  }
  out.add('--radius-button');
  return out;
}

try {
  const T = require('./theme-settings.js');
  // 没有这个导出 = 发往站的那一跳只剩 settingsToCssVars —— 那正是 r1 的样子。拿它往下判（下面会红在
  // 「少了横向三个」上），而不是 exit 2：这是契约破了，不是仪器坏了。
  if (typeof T.settingsToSiteCssVars !== 'function') {
    bad('theme-settings.js 没有导出 settingsToSiteCssVars —— 下面按 settingsToCssVars 判');
    T.settingsToSiteCssVars = T.settingsToCssVars;
  }

  console.log('① 发往站的载荷 ⊇ 冻结的 15 个名字（两种形状各一格）');
  for (const [label, cases] of [['枚举形状', ENUM_CASES], ['数值形状', NUMERIC_CASES]]) {
    const problems = [];
    for (const c of cases) {
      const miss = missingFrozen(T.settingsToSiteCssVars(c.settings));
      if (miss.length) problems.push(`${c.name} 少了 ${miss.join(' ')}`);
    }
    if (!problems.length) ok(`${label}：${cases.length} 档都发全了 ${FROZEN.length} 个冻结名字`);
    else problems.forEach((p) => bad(`${p} —— 存量站会判 settings incomplete，试穿不换画法`));

    // 反向对照：从载荷里拿掉任一个冻结名字 ⟹ 必须红（逐个拿，15 个都要红）
    const payload = T.settingsToSiteCssVars(cases[0].settings);
    const blind = FROZEN.filter((n) => missingFrozen(payload.filter((d) => decls([d]).get(n) === undefined)).length === 0);
    if (!blind.length) ok(`${label} 反向对照：拿掉 ${FROZEN.length} 个名字里的任一个 ⟹ 都红`);
    else bad(`${label} 反向对照没红：拿掉 ${blind.join(' ')} 也判过 —— 这道检查是瞎的`);
  }

  console.log('② 横向三个发的是真值（老站真的拿它们画左右留白），不是占位');
  {
    const problems = [];
    for (const c of ENUM_CASES) {
      const got = decls(T.settingsToSiteCssVars(c.settings));
      for (const n of LEGACY) {
        if (got.get(n) !== LEGACY_ENUM_VALUES[c.density][n]) {
          problems.push(`${c.name} ${n}=${got.get(n)}，应为 ${LEGACY_ENUM_VALUES[c.density][n]}`);
        }
      }
    }
    for (const c of NUMERIC_CASES) {
      const got = decls(T.settingsToSiteCssVars(c.settings));
      for (const n of LEGACY) {
        const want = `${Math.round(LEGACY_NUMERIC_MULT[n] * c.density * 1000) / 1000}rem`;
        if (got.get(n) !== want) problems.push(`${c.name} ${n}=${got.get(n)}，应为 ${want}`);
      }
    }
    if (!problems.length) ok(`${ENUM_CASES.length} 档枚举 + ${NUMERIC_CASES.length} 个数值，横向三个都等于 #1541 之前的值`);
    else problems.forEach((p) => bad(p));
  }

  console.log('③ 新模板自己的站也补得齐（它派生出的 SETN ⊆ 发出去的名字）');
  {
    const setn = newSiteSetn(T);
    const problems = [];
    for (const c of [...ENUM_CASES, ...NUMERIC_CASES]) {
      const got = decls(T.settingsToSiteCssVars(c.settings));
      const miss = [...setn].filter((n) => !got.has(n));
      if (miss.length) problems.push(`${c.name} 少了 ${miss.join(' ')}`);
    }
    if (!problems.length) ok(`新站派生出 ${setn.size} 个，每一档都发全了`);
    else problems.forEach((p) => bad(`${p} —— 新站会判 settings incomplete`));
  }

  console.log('④ 反方向：横向三个不进新模板自己的 CSS（它们在那里没有消费者）');
  {
    const leaked = [];
    for (const c of [...ENUM_CASES, ...NUMERIC_CASES]) {
      const got = decls(T.settingsToCssVars(c.settings));
      const hit = LEGACY.filter((n) => got.has(n));
      if (hit.length) leaked.push(`${c.name}: ${hit.join(' ')}`);
    }
    if (!leaked.length) ok('settingsToCssVars()（theme.css / sync-config / Customize 用的那份）不含横向三个');
    else leaked.forEach((x) => bad(`settingsToCssVars 写出了 ${x} —— 新站的 theme.css 会多三条没人用的变量`));
    const css = fs.readFileSync(GLOBALS, 'utf8');
    const inGlobals = LEGACY.filter((n) => new RegExp(`${n}\\s*:`).test(css) || new RegExp(`var\\(${n}\\)`).test(css));
    if (!inGlobals.length) ok('globals.css 里横向三个 0 处定义、0 处使用');
    else bad(`globals.css 里还有 ${inGlobals.join(' ')} —— 新模板不消费它们`);
  }

  console.log('⑤ dashboard 试穿真的走的是 settingsToSiteCssVars');
  if (!fs.existsSync(THEME_MODAL)) {
    // 模板仓那份副本里没有 dashboard/；单仓（CI 跑的那一份）里它必然存在。
    if (fs.existsSync(path.join(REPO, 'dashboard', 'package.json'))) bad(`找不到 ${THEME_MODAL}`);
    else skip('不在单仓里（模板仓副本没有 dashboard/）—— 这一格只在单仓里有对象');
  } else {
    const modal = fs.readFileSync(THEME_MODAL, 'utf8');
    const site = (modal.match(/settingsCss:\s*themeSettings\.settingsToSiteCssVars\(/g) || []).length;
    const plain = (modal.match(/settingsCss:\s*themeSettings\.settingsToCssVars\(/g) || []).length;
    if (site === 2 && plain === 0) ok('ThemeModal.tsx 的两处 settingsCss（缩略图 · 点卡片）都用 settingsToSiteCssVars');
    else bad(`ThemeModal.tsx 的 settingsCss：settingsToSiteCssVars ${site} 处、settingsToCssVars ${plain} 处（应为 2 / 0）`);
  }
} catch (e) {
  die(e && e.stack ? e.stack : String(e));
}

console.log(`\n${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
