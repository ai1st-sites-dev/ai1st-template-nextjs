#!/usr/bin/env node
/**
 * block-radius.test.js — 块的圆角只读 Corner style / 主题给的两个变量（#1718）。
 *
 *   node scripts/block-radius.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * Chris 2026-10-11 验 #1697：Corner style 选 sharp，只有按钮变方，卡片 / 图片全都还是圆的。原因是块的圆角写死在两处：
 * `block.css` 的字面值（27 行）和 img 上的 Webpixels `rounded-4`（字面量 + `!important`，不读变量）。#1718 把它们
 * 接到 `--radius-card` / `--radius-image` 上；下一个加块、改块的人随手写一个 `border-radius: 1rem`，这个开关就又
 * 「对一部分页面不起作用」，而构建照样绿。
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 *   ① `blocks/**\/*.css` 里每一条 `border-radius:` 的值只由这几样拼成：`var(--radius-card)` / `var(--radius-image)` /
 *      `0` / `50%`（头像）/ 胶囊（`999px` / `9999px` / `50rem`）。别的数值现取 0 处。
 *      阳性对照：同一把尺读一段带 `border-radius: 1rem;` 的文本，必须报出来。
 *   ② 块 .tsx 里挂在 `<img>` 上的类（`slotImg` 的 className）没有 `rounded-3` / `rounded-4` —— 图片读 `--radius-image`
 *      （各块 block.css 自己的 `…-img` 规则），不跟卡片那个变量走。阳性对照同上。
 *   ③ 主题那一侧：`settings.radius`（px，数值形状）⟹ `--radius-card` / `--radius-image` 都 = `radius`px，theme.css 用的
 *      `settingsToCssVars` 和发往站的 `settingsToSiteCssVars` 两条都给；按钮仍按 `buttonShape`。
 *
 * 📌 量不到的（说在明处）：浏览器里算出来的 `borderRadius` —— 那要真渲染（#1718 验收 1–3 在真站上量）。
 *    `rounded-3` / `rounded-4` 本身接到变量上的那条规则在 `scripts/lib/site-css.test.js` ⑥（compile + purge 两步）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const BLOCKS = path.join(NEXT, 'blocks');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// 一个值里允许出现的「词」。`0 0 var(--radius-card) var(--radius-card)` 这种只圆下边的按空格拆开逐个判。
const ALLOWED_TOKEN = /^(0|50%|999px|9999px|50rem|var\(--radius-(card|image)\))$/;

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** 一段 CSS 里不合格的 `border-radius` → [{ line, value }]。注释先剥掉（注释里写「1rem 圆角」是说明，不是规则）。 */
function badRadii(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    const m = /(?:^|[;{\s])border-radius\s*:\s*([^;}]+)/.exec(l);
    if (!m) return;
    const value = m[1].replace(/\s*!important\s*$/, '').trim();
    if (!value.split(/\s+/).every((t) => ALLOWED_TOKEN.test(t))) out.push({ line: i + 1, value });
  });
  return out;
}

/** 一份 .tsx 里 `slotImg(…, { before: { className: '…' } })` 的 className 带 rounded-3 / rounded-4 的 → [{ line, cls }]。 */
function roundedImgs(tsx) {
  const out = [];
  tsx.split('\n').forEach((l, i) => {
    if (!/slotImg\(/.test(l)) return;
    const m = /className:\s*['"`]([^'"`]*)['"`]/.exec(l);
    if (m && /\brounded-[34]\b/.test(m[1])) out.push({ line: i + 1, cls: m[1] });
  });
  return out;
}

try {
  const cssFiles = walk(BLOCKS, '.css');
  const tsxFiles = walk(BLOCKS, '.tsx');
  if (!cssFiles.length || !tsxFiles.length) die(`blocks/ 下 .css ${cssFiles.length} 份、.tsx ${tsxFiles.length} 份 —— 路径不对`);

  console.log(`① blocks/**/*.css 的 border-radius 只读两个变量（或 0 / 50% / 胶囊）—— ${cssFiles.length} 份`);
  {
    let total = 0;
    const offenders = [];
    for (const f of cssFiles) {
      const css = fs.readFileSync(f, 'utf8');
      total += (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/border-radius\s*:/g) || []).length;
      for (const b of badRadii(css)) offenders.push(`${path.relative(NEXT, f)}:${b.line} ${b.value}`);
    }
    console.log(`     border-radius 共 ${total} 条，不合格 ${offenders.length} 条`);
    if (!total) bad('一条 border-radius 都没读到 —— 尺子没咬到东西');
    else if (!offenders.length) ok(`${total} 条全部合格（别的数值 0 处）`);
    else offenders.forEach((o) => bad(`${o} —— 写死的圆角不跟 Corner style 走，换成 var(--radius-card) 或 var(--radius-image)`));

    // 阳性对照：同一把尺，一段带字面量的文本（含只圆下边那种、带 !important 那种），必须逐条报出来；注释里的不算。
    const probe = 'a {\n  border-radius: 1rem;\n}\nb { border-radius: 0 0 1rem 1rem; }\nc {\n  border-radius: 0.5rem !important;\n}\n'
      + '/* 注释里写 border-radius: 1rem 不算 */\nd { border-radius: var(--radius-card); }\n';
    const hit = badRadii(probe).map((b) => b.value);
    if (hit.length === 3 && hit.includes('1rem') && hit.includes('0 0 1rem 1rem') && hit.includes('0.5rem')) {
      ok('阳性对照：三条字面量（含只圆下边、带 !important）都报出来，注释和 var() 那条不报');
    } else bad(`阳性对照读数不对：${JSON.stringify(hit)} —— 这把尺是瞎的`);
  }

  console.log(`② 块里 <img> 上没有 rounded-3 / rounded-4（图片读 --radius-image）—— ${tsxFiles.length} 份 .tsx`);
  {
    let imgs = 0;
    const offenders = [];
    for (const f of tsxFiles) {
      const tsx = fs.readFileSync(f, 'utf8');
      imgs += (tsx.match(/slotImg\(/g) || []).length;
      for (const r of roundedImgs(tsx)) offenders.push(`${path.relative(NEXT, f)}:${r.line} 「${r.cls}」`);
    }
    console.log(`     slotImg 调用 ${imgs} 处，挂 rounded-3/4 的 ${offenders.length} 处`);
    if (!imgs) bad('一处 slotImg 都没读到 —— 尺子没咬到东西');
    else if (!offenders.length) ok('图片上 0 处 rounded-3 / rounded-4');
    else offenders.forEach((o) => bad(`${o} —— 图片的角会跟卡片变量走，换成块自己的 …-img 规则读 var(--radius-image)`));
    const probe = "{slotImg(img, { before: { className: 'img-fluid rounded-4 w-100' }, slot: 'image' })}";
    if (roundedImgs(probe).length === 1 && roundedImgs(probe.replace('rounded-4 ', '')).length === 0) ok('阳性对照：带 rounded-4 的那一行报出来、拿掉就不报');
    else bad('阳性对照读数不对 —— 这把尺是瞎的');
  }

  console.log('③ 主题的 settings.radius ⟹ --radius-card / --radius-image 都 = radius px（theme.css 与发往站两条都给）');
  {
    const T = require('./theme-settings.js');
    const decls = (list) => new Map(list.map((d) => /^\s*(--[A-Za-z0-9-]+)\s*:\s*(.+?);?\s*$/.exec(d)).filter(Boolean).map((m) => [m[1], m[2]]));
    const problems = [];
    // 4 / 22 是池里两套（azure-29 / ember-12）的值；0 是边界。
    for (const r of [0, 4, 22]) {
      for (const [name, fn] of [['settingsToCssVars', T.settingsToCssVars], ['settingsToSiteCssVars', T.settingsToSiteCssVars]]) {
        const got = decls(fn({ radius: r, density: 1, buttonShape: 'square' }));
        for (const n of ['--radius-card', '--radius-image']) if (got.get(n) !== `${r}px`) problems.push(`${name} radius=${r} ${n}=${got.get(n)}，应为 ${r}px`);
        if (got.get('--radius-button') !== '0px') problems.push(`${name} radius=${r} --radius-button=${got.get('--radius-button')}，应按 buttonShape=square 给 0px`);
      }
    }
    if (!problems.length) ok('radius 0 / 4 / 22 × 两条翻译：卡片 / 图片 = radius px，按钮照 buttonShape');
    else problems.forEach((p) => bad(p));
    // 池里真实两套，读注册表本身（不是写死的数）
    const pool = JSON.parse(fs.readFileSync(path.join(NEXT, 'scripts', 'theme-pool.json'), 'utf8'));
    const off = [];
    const ids = Object.keys(pool);
    if (!ids.length) off.push('theme-pool.json 一套主题都没有');
    for (const id of ids) {
      const r = pool[id] && pool[id].settings && pool[id].settings.radius;
      if (typeof r !== 'number') { off.push(`${id}: settings.radius 不是数字（${JSON.stringify(r)}）`); continue; }
      const got = decls(T.settingsToCssVars(pool[id].settings));
      if (got.get('--radius-card') !== `${r}px` || got.get('--radius-image') !== `${r}px`) off.push(`${id}: card=${got.get('--radius-card')} image=${got.get('--radius-image')}，应为 ${r}px`);
    }
    if (!off.length) ok(`主题池 ${ids.length} 套：${ids.map((id) => `${id} → ${pool[id].settings.radius}px`).join(' · ')}`);
    else off.forEach((x) => bad(x));
  }
} catch (e) {
  die(e && e.stack ? e.stack : String(e));
}

console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
process.exit(failed ? 1 : 0);
