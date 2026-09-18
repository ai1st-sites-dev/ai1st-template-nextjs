#!/usr/bin/env node
/**
 * generated-fresh.test.js — 盘上那三份生成物 == 现在从 `blocks/` 拼出来的那份（#1387）。
 *
 * 跑法:  node scripts/block-build/generated-fresh.test.js   （或 `npm run test:scripts`，按文件名发现）
 * 退出码: 0 一致 · 1 对不上 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么要这一道：`public/shapes.css` / `public/base.css` / `src/lib/sections/registry.generated.ts`
 * 都进 git（理由在 `build-blocks.js` 文件头：读它们的人里有一多半根本不构建）。进 git 就会漂 ——
 * 改了 `blocks/` 忘了跑生成器，盘上那份就是旧的，而**这件事的失败方向是静默的**：站照样建得出来，
 * 只是新形态没有几何、admin 页上有它、页面上没有。这一道把那件事变成当场红。
 *
 * 🔴 它自己也要有牙：下面第 ② 段故意把 `blocks/` 复制一份并往里丢一个新形态，**不**跑生成器，
 *    确认 `--check` 那一支真的会说不一致。只有第 ① 段绿的话，分不出「一致」和「这个检查什么都没比」。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(__dirname, 'build-blocks.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (!fs.existsSync(BUILD)) die(`没有 ${path.relative(NEXT, BUILD)}`);

// ── ① 盘上那份 == 现在拼出来的那份 ───────────────────────────────────────────────────────────────
console.log('── ① 三份生成物跟 blocks/ 对得上');
{
  const r = cp.spawnSync(process.execPath, [BUILD, '--check'], { cwd: NEXT, encoding: 'utf8' });
  if (r.error) die(`跑不动生成器: ${r.error.message}`);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status === 0) ok(`build-blocks.js --check 退出码 0\n${out.trim().split('\n').map((l) => `      ${l}`).join('\n')}`);
  else bad(`build-blocks.js --check 退出码 ${r.status}：\n${out.trim()}`);
}

// ── ② 这个检查有牙吗：丢一个新形态进副本、不跑生成器 ⟹ 必须说不一致 ────────────────────────────
console.log('── ② 故意让它们对不上，看这个检查会不会红');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blocks-fresh-'));
  try {
    for (const d of ['blocks', 'public', 'scripts', 'src']) {
      fs.cpSync(path.join(NEXT, d), path.join(root, d), { recursive: true });
    }
    // 生成器 require postcss —— 副本里得找得到它。软链回本仓的 node_modules（不拷：那是几百 MB）。
    fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(root, 'node_modules'));
    // 先证明这份副本自己是干净的 —— 不然下面那个「红」可能是复制过程弄坏的。
    const before = cp.spawnSync(process.execPath, [path.join(root, 'scripts', 'block-build', 'build-blocks.js'), '--check'],
      { cwd: root, encoding: 'utf8' });
    if (before.status !== 0) die(`副本自己就对不上（复制坏了？）：\n${before.stdout}${before.stderr}`);
    ok('副本未改动时 --check 退出码 0（对照组成立）');

    const dir = path.join(root, 'blocks', 'hero', 'fake-shape-for-this-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'shape.css'),
      '[data-block="hero"][data-shape="fake-shape-for-this-test"] {\n  display: grid;\n}\n');
    fs.writeFileSync(path.join(dir, 'shape.md'), '---\norder: 99\n---\n\n# 假的\n');
    const after = cp.spawnSync(process.execPath, [path.join(root, 'scripts', 'block-build', 'build-blocks.js'), '--check'],
      { cwd: root, encoding: 'utf8' });
    const out = `${after.stdout || ''}${after.stderr || ''}`;
    if (after.status === 1 && out.includes('public/shapes.css')) {
      ok('副本里丢进一个新形态、不跑生成器 ⟹ --check 退出码 1 并点名 public/shapes.css');
    } else {
      bad(`本该红却没红：退出码 ${after.status}\n${out}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n══ generated-fresh.test.js: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
