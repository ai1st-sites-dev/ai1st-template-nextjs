#!/usr/bin/env node
/**
 * block-intro-width.test.js — 每个块的源码里都没有 `64ch` / `52ch`（#1486 T6.1 验收 3 第一类）。
 *
 *   node scripts/block-intro-width.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么 ──────────────────────────────────────────────────────────────────────────────────────
 * 块头文字块的宽度规则（Chris 2026-09-29）是 left / right = 100%、center 在 ≥992 最宽 80%（<992 = 100%），
 * 正文不单独限宽。在那之前，从 features 起每个块都抄了「center / right 限 64ch」和「正文 ≤ 52ch」两道上限，
 * 而新块照着旧块写 —— 不拦的话下一个块会把它们抄回来。这条原来只在 `team-render.test.js` 里管 team 一个块，
 * 这里推广到 `blocks/` 下**全部**块：块目录从磁盘现取，不写清单，新块进来自动在射程里。
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 * 每个块目录下的 `block.css` 与 `Section.tsx`，**连注释一起**数 `64ch` / `52ch`，必须都是 0。
 * 注释也算：注释里写着「限 64ch」就是在告诉下一个人这里该限 64ch。
 * 不管的：`public/shapes.css`（生成物，`build-blocks.js --check` 管）、图册（`docs/reference/webpixels/gallery`）。
 *
 * 🔴 带反向对照（同一进程、单变量）：拿一份内存里的 CSS 加一行 `max-width: 64ch;` 喂给同一个数数函数，必须数到 1。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BLOCKS = path.resolve(__dirname, '..', 'blocks');
const FILES = ['block.css', 'Section.tsx'];
const BANNED = ['64ch', '52ch'];

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

/** 一段文字里每个禁用串各出现几次。 */
const countBanned = (text) => Object.fromEntries(BANNED.map((s) => [s, text.split(s).length - 1]));

if (!fs.existsSync(BLOCKS)) die(`找不到 ${BLOCKS}`);
const blocks = fs.readdirSync(BLOCKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
// 🔴 分母自检：一个块都没读到时这一节空过就是绿的。
if (!blocks.length) die('blocks/ 下一个块都没有 —— 这一节会整节空过');

console.log('── 块源码里没有 64ch / 52ch');
{
  const probe = countBanned('[data-block="x"] .x-intro-text {\n  max-width: 64ch;\n}\n/* 正文 ≤ 52ch */');
  if (probe['64ch'] === 1 && probe['52ch'] === 1) ok('反向对照：往一份 CSS 里加一行 max-width: 64ch、一句注释写 52ch ⟹ 各数到 1');
  else bad(`反向对照没数到：64ch=${probe['64ch']} 52ch=${probe['52ch']} —— 这个数数函数是瞎的，下面的 0 不作数`);

  const offenders = [];
  let filesRead = 0;
  for (const b of blocks) {
    for (const f of FILES) {
      const file = path.join(BLOCKS, b, f);
      if (!fs.existsSync(file)) continue;
      filesRead += 1;
      const n = countBanned(fs.readFileSync(file, 'utf8'));
      const hit = BANNED.filter((s) => n[s] > 0).map((s) => `${s}×${n[s]}`);
      if (hit.length) offenders.push(`blocks/${b}/${f}（${hit.join(' · ')}）`);
    }
  }
  if (filesRead < blocks.length) bad(`${blocks.length} 个块只读到 ${filesRead} 份文件 —— 有块连 block.css / Section.tsx 都没有，先看是不是目录结构变了`);
  if (!offenders.length) ok(`${blocks.length} 个块、${filesRead} 份文件里 64ch / 52ch 都是 0`);
  else bad(`${offenders.length} 份文件还带着旧的宽度上限：${offenders.join(' · ')} —— 块头宽度照 team 的 block.css「块头宽度」那段写（#1486）`);
}

console.log(`\n${fail ? '❌' : '✅'} block-intro-width: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
