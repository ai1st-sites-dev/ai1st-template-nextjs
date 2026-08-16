#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// ink-contrast.js — 一份候选主题表自己画的字，压在它自己画的底上，读不读得出来（#1051 r4）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
//   node scripts/theme-pipeline/ink-contrast.js /tmp/candidates/*.css      # 逐套一行，全过 rc=0
//   node scripts/theme-pipeline/ink-contrast.js --verbose /tmp/c/gen-07-5.css
//
// 退出码: 0 全部达标 · 1 有不达标的 · 2 跑不起来（**不许当成通过**）
//
// ══ 为什么要有这把尺 ═══════════════════════════════════════════════════════════════════════════════
// 覆盖面那把尺（`hook-coverage.js`）只回答「这个钩子有没有规则」。一份表可以 213/213 全覆盖，
// 同时把电话号码画成 1.6:1 —— 实测就是这样：#1051 r3 那批 80 套里 **20 套**的
// `contact-info__phone` / `__email` 落在 1.45–2.49:1，运行时那道检查（#1050 ②e，essential 块下限
// 2.5:1）当场把候选拦下，而覆盖面那把尺一路全绿。
//
// 🔴 它读的是**产物**：颜色一律从这套候选自己的 `<id>.tokens.json` 里解析 `var(--color-…)`，
//    不从生成器那边导入任何东西。所以生成器和这把尺不共用同一个假设 —— 生成器挑错了它照样红。
//
// ══ 「字压在什么底上」这个模型 ═════════════════════════════════════════════════════════════════════
// 静态读一份 CSS 是看不到 DOM 的嵌套的，所以这里用一个**说得清、能被复算**的模型：
//   · 一条规则**同时**写了 `background-color` 和 `color` ⟹ 它自带底（药丸、图标底、块根本身），
//     它的字压的就是它自己那块底。
//   · 一条规则写了 `background-color`、没写 `color`、且有 padding ⟹ 它是一个【面】（卡片、面板），
//     同一个块里的文字可能落在它上面。
//   · 一个只写了 `color` 的部件，压的底 = 块根的底 ∪ 这个块里的那些面，**每一块都要达标**。
// 🔴 这个模型比真页面**严**（真页面上一段字只落在其中一块底上）。严的方向是安全的：它可能多报，
//    不会漏报。校准见票里 r4 那段读数 —— 它在头 15 套里点名的集合与真机上被闸②拦下的集合一致。
//
// ══ 门槛 ══════════════════════════════════════════════════════════════════════════════════════════
// 4.5:1（WCAG 正文），大字 3:1（WCAG：≥24px，或 ≥18.66px 且 ≥700 字重）。大不大由**这条规则
// 自己写的** `font-size` / `font-weight` 决定，不由钩子的名字决定。
// 两个门槛都高于运行时那道检查的 2.5:1 —— 留余量是有意的，见 `sheet-recipes.js` 的 §INK_FLOOR。
'use strict';

const fs = require('fs');
const path = require('path');

let postcss; let contrast;
try {
  postcss = require('postcss');
  ({ contrast } = require(path.join(__dirname, 'palette.js')));
} catch (e) {
  console.error(`🔴 跑不起来: ${e.message}`);
  process.exit(2);
}

const BODY_FLOOR = 4.5;
const LARGE_FLOOR = 3;
const blockOf = (hook) => (hook.includes('__') ? hook.split('__')[0] : hook);

/** `1.0625rem` / `14px` → px。认不出来就当正文（返回 null，按小字判）。 */
function toPx(size) {
  const m = /^([\d.]+)(rem|em|px)$/.exec(String(size || '').trim());
  if (!m) return null;
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
}
/** WCAG 的「大字」：≥24px，或 ≥18.66px 且字重 ≥700。 */
const floorFor = (px, weight) => (
  px !== null && (px >= 24 || (px >= 18.66 && Number(weight) >= 700)) ? LARGE_FLOOR : BODY_FLOOR);

function resolveVar(value, tokens) {
  const m = /var\(--color-(primary|accent)-(\d+)\)/.exec(value || '');
  if (!m) return null;
  return ((tokens.colors || {})[m[1]] || {})[m[2]] || null;
}

/** 一份表 → 每一条「这段字压在这块底上」的读数。 */
function rowsFor(cssText, tokens) {
  const seen = new Map();   // hook -> { color, bg, pad, size, weight }
  postcss.parse(cssText).walkRules((rule) => {
    for (const sel of rule.selector.split(',').map((x) => x.trim())) {
      const m = /^\.([a-z0-9_-]+)$/.exec(sel);
      if (!m) continue;
      const cur = seen.get(m[1]) || { color: null, bg: null, pad: false, size: null, weight: null };
      rule.walkDecls((d) => {
        if (d.prop === 'color') cur.color = resolveVar(d.value, tokens) || cur.color;
        if (d.prop === 'background-color') cur.bg = resolveVar(d.value, tokens) || cur.bg;
        if (d.prop === 'padding' || d.prop.startsWith('padding-')) cur.pad = true;
        if (d.prop === 'font-size') cur.size = d.value;
        if (d.prop === 'font-weight') cur.weight = d.value;
      });
      seen.set(m[1], cur);
    }
  });
  const surfaces = new Map();
  for (const [hook, r] of seen) {
    if (!r.bg) continue;
    if (!hook.includes('__') || (!r.color && r.pad)) {
      const b = blockOf(hook);
      if (!surfaces.has(b)) surfaces.set(b, new Set());
      surfaces.get(b).add(r.bg);
    }
  }
  const rows = [];
  for (const [hook, r] of seen) {
    if (!r.color) continue;
    const floor = floorFor(toPx(r.size), r.weight);
    const push = (bg, where) => rows.push({
      hook, ink: r.color, bg, where, floor, ratio: contrast(r.color, bg),
    });
    if (r.bg) { push(r.bg, 'own'); continue; }
    for (const bg of surfaces.get(blockOf(hook)) || []) push(bg, 'block');
  }
  return rows;
}

/** 一份表的结论。`cssPath` 旁边必须有同名的 `.tokens.json`。 */
function auditSheet(cssPath) {
  const tokensPath = cssPath.replace(/\.css$/, '.tokens.json');
  if (!fs.existsSync(tokensPath)) {
    throw new Error(`找不到 ${path.basename(tokensPath)} —— 这把尺要按这套候选自己的颜色算，不猜色板`);
  }
  const css = fs.readFileSync(cssPath, 'utf8');
  const rows = rowsFor(css, JSON.parse(fs.readFileSync(tokensPath, 'utf8')));
  // 🔴 一条读数都没有 = **什么都没量到**，不是「这份表干净」。而且两种没量到要分开说，
  //    否则下一个人会拿错方向去查：
  if (!rows.length) {
    const hasColour = /(^|\s)color:\s*var\(--color-/m.test(css);
    throw new Error(hasColour
      ? `${path.basename(cssPath)} 有字色、但一条背景色都没有 —— 没有底可压，这把尺量不了它`
      : `${path.basename(cssPath)} 里一条 color: var(--color-…) 都没读到 —— 尺子坏了，不是表干净`);
  }
  const under = rows.filter((r) => r.ratio < r.floor).sort((a, b) => a.ratio - b.ratio);
  const worst = rows.reduce((m, r) => (r.ratio < m.ratio ? r : m), rows[0]);
  return {
    id: path.basename(cssPath, '.css'), pairs: rows.length, under, worst, rows,
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const verbose = argv.includes('--verbose');
  const files = argv.filter((a) => a.endsWith('.css'));
  if (!files.length) {
    console.error('用法: ink-contrast.js [--verbose] <候选表.css> …（同目录要有同名的 .tokens.json）');
    process.exit(2);
  }
  let bad = 0;
  let globalWorst = null;
  for (const f of files) {
    let r;
    try { r = auditSheet(f); } catch (e) { console.error(`🔴 ${f}: ${e.message}`); process.exit(2); }
    if (!globalWorst || r.worst.ratio < globalWorst.ratio) globalWorst = { ...r.worst, id: r.id };
    if (r.under.length) {
      bad += 1;
      const hooks = [...new Set(r.under.map((x) => x.hook))];
      console.log(`🔴 ${r.id}  ${r.under.length} 条不达标 · 最低 ${r.under[0].ratio.toFixed(2)}`
        + ` (${r.under[0].hook}，门槛 ${r.under[0].floor}) · 涉及钩子 ${hooks.length}: ${hooks.slice(0, 6).join(', ')}`);
      if (verbose) {
        for (const x of r.under) {
          console.log(`     ${x.ratio.toFixed(2)} < ${x.floor}  ${x.hook}  ${x.ink} 压 ${x.bg} (${x.where})`);
        }
      }
    } else {
      console.log(`✅ ${r.id}  ${r.pairs} 组配色全达标 · 最低 ${r.worst.ratio.toFixed(2)}`
        + ` (${r.worst.hook}，门槛 ${r.worst.floor})`);
    }
  }
  console.log(bad
    ? `\n🔴 ${files.length} 份表里 ${bad} 份画出了读不出来的字`
    : `\n✅ ${files.length} 份表画的字都读得出来（正文 ≥${BODY_FLOOR}:1、大字 ≥${LARGE_FLOOR}:1）`
      + `；全场最低 ${globalWorst.ratio.toFixed(2)} ${globalWorst.id}/${globalWorst.hook}`);
  process.exit(bad ? 1 : 0);
}

module.exports = {
  auditSheet, rowsFor, floorFor, toPx, BODY_FLOOR, LARGE_FLOOR,
};
