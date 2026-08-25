#!/usr/bin/env node
/**
 * edit-site-prompt.test.js — #1171（来源 #1162）：给 `edit-site.js` 提示词里那份**手抄的**
 * `Available section types:` 清单装一道常设守卫。
 *
 *   node scripts/edit-site-prompt.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * 那一行必须逐项等于 `src/lib/sections/registry.ts` 的键集合，而它是**人手抄的**。两个方向都坏过，
 * 而且坏法都是静默的：
 *   · 清单里有注册表**没有**的名字 ⟹ 模型照着写出那个块，`SectionRenderer` 走未知类型那一支
 *     （`console.warn` + `return null`）—— **块在页面上直接不出现，而构建是绿的**；
 *   · 注册表里有清单**没写**的名字 ⟹ 模型从不知道那个块存在，它永远不会被用上，也没有任何红。
 * #1162 现取时它**两个方向同时**漂着：多四个已并入 `card-group` 的老名字（`values-grid` /
 * `benefits-list` / `checklist` / `service-highlights`），少三个现役块（`card-group` /
 * `contact-form` / `service-related-pages`）。#1162 把清单改齐了，但**机制没换** —— 下一个改注册表
 * 的人还得记着回来改这一行。#1171 现取：31 项对 31 项、两向差集都空，也就是今天它是齐的，
 * 活着的问题是**没有任何东西在盯它**。这个文件就是那个东西。
 *
 * 🔴 它判的是【两个方向】，不是「清单里的名字都存在」。单向判据对上面第二种坏法按构造是盲的，
 *    而那一种恰好没有任何别的仪器会响。
 *
 * 🔴 分母先自检再判：抠不到那一行、或者两边任一集合小得不像话 ⟹ exit 2（跑不起来），不是通过。
 *    「什么都没量到」和「量过且相等」在一个只打 ✅ 的实现里长得一模一样。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.join(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 尺子一侧：提示词里那一行 ────────────────────────────────────────────────────────────────────
const editSitePath = path.join(NEXT, 'scripts', 'edit-site.js');
let editSite;
try { editSite = fs.readFileSync(editSitePath, 'utf-8'); } catch (e) { die(`读不到 ${editSitePath}: ${e.message}`); }

// 🔴 只认**行首**那一处。`edit-site.js` 里同一串字还出现在它自己那段说明注释里（`// 🔴 下面那份
//    提示词里的 \`Available section types:\` 一行…`），按子串数会数到两处，而那两处一处是判据、
//    一处是散文 —— 分不开的尺子会在有人改注释时报假红。
const promptLines = editSite.split('\n').filter((l) => l.startsWith('Available section types:'));
if (promptLines.length !== 1) {
  die(`在 scripts/edit-site.js 里，行首以 "Available section types:" 开头的行有 ${promptLines.length} 行，`
    + '应当恰好 1 行 —— 这把尺指不到它要量的东西了（那一行被改写、挪进别的字符串、或者多了一份副本）');
}
const promptList = promptLines[0].slice('Available section types:'.length)
  .split(',').map((s) => s.trim()).filter(Boolean);
const promptSet = new Set(promptList);

// ── 尺子另一侧：注册表的键 ──────────────────────────────────────────────────────────────────────
// 📌 用文本抠而不是 require：那是 TypeScript，node 直接读不了。同样的抠法在
//    `blocks.test.js` 与 `lib/site-data-migration.test.js` 里各有一处，理由同。
const regPath = path.join(NEXT, 'src', 'lib', 'sections', 'registry.ts');
let reg;
try { reg = fs.readFileSync(regPath, 'utf-8'); } catch (e) { die(`读不到 ${regPath}: ${e.message}`); }
const body = reg.slice(reg.indexOf('sectionRegistry'));
if (body === reg && reg.indexOf('sectionRegistry') < 0) die('registry.ts 里找不到 sectionRegistry —— 抠不出键集合');
const regSet = new Set([...body.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]));

// ── 分母自检（先证尺子没坏，再判相等）─────────────────────────────────────────────────────────
if (regSet.size < 20) die(`从 registry.ts 只抠出 ${regSet.size} 个键 —— 尺子坏了（正则跟文件形状对不上）`);
if (promptSet.size < 20) die(`提示词那一行只解出 ${promptSet.size} 项 —— 尺子坏了（分隔符或行形状变了）`);
if (promptSet.size !== promptList.length) {
  bad(`提示词那一行里有重复项: ${promptList.filter((n, i) => promptList.indexOf(n) !== i).join(' · ')}`);
} else {
  ok(`提示词那一行解出 ${promptList.length} 项，无重复；registry.ts 抠出 ${regSet.size} 个键`);
}

// ── 判据：两个方向 ──────────────────────────────────────────────────────────────────────────────
const onlyPrompt = [...promptSet].filter((n) => !regSet.has(n));
const onlyReg = [...regSet].filter((n) => !promptSet.has(n));

if (onlyPrompt.length) {
  bad(`提示词里有 ${onlyPrompt.length} 个注册表没有的块类型: ${onlyPrompt.join(' · ')}\n`
    + '     ⟹ 模型会照着写出这些块，而 SectionRenderer 对未知类型是 console.warn + return null：\n'
    + '        块在页面上不出现，构建照样 exit 0。改 scripts/edit-site.js 那一行，或把类型加进注册表。');
} else {
  ok(`提示词 → 注册表：${promptSet.size} 项全部在 registry.ts 里`);
}

if (onlyReg.length) {
  bad(`registry.ts 里有 ${onlyReg.length} 个块类型没写进提示词: ${onlyReg.join(' · ')}\n`
    + '     ⟹ 模型不知道它们存在，永远不会用上它们，而这件事没有任何别的仪器会报。\n'
    + '        把它们补进 scripts/edit-site.js 的 "Available section types:" 那一行。');
} else {
  ok(`注册表 → 提示词：${regSet.size} 个键全部写在提示词那一行里`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
