#!/usr/bin/env node
/**
 * theme-sheet.test.js — #1064：写进 `theme.json.css` 之前那一问答对不对。
 *
 *   node scripts/theme-sheet.test.js       （CI 里由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 这里判的每一格，错法都是同一个方向：`sheetNameForTheme` 多说了一个「有」，那个站就写下一个
 * `css`，而 `sync-config.js` 的 `readThemeSheet()` 对着它 `process.exit(1)` —— 症状不是「没穿上
 * 皮」，是**这个站从此构建不出来**。所以下面既量「该说有的时候说了有」，也量三种该说没有的形状。
 *
 * 🔴 最后一格盯的是**两处正则会不会分叉**：形状判据在 `theme-sheet.js` 和 `sync-config.js` 里
 *    各有一条，写的一侧宽了就是上面那个后果。它读 sync-config.js 的原文来比，不是重抄一遍。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sheetNameForTheme, SHEET_NAME_OK } = require('./theme-sheet.js');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof sheetNameForTheme !== 'function') die('theme-sheet.js 没导出 sheetNameForTheme');

// ── 夹具：一个只有 public/themes/ 的假模板根 ─────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 't1064-'));
fs.mkdirSync(path.join(root, 'public', 'themes'), { recursive: true });
fs.writeFileSync(path.join(root, 'public', 'themes', 'gen-07-3.css'), '/* a sheet */\n');
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

console.log('\n── 有表 / 没表 ──');
{
  const got = sheetNameForTheme('gen-07-3', root);
  got === 'gen-07-3'
    ? ok('同名的表在 ⟹ 返回那个名字（这是 #1016 的池成员进站的那条路）')
    : bad(`同名的表在，却返回了 ${JSON.stringify(got)}`);
}
{
  const got = sheetNameForTheme('ocean-blue', root);
  got === ''
    ? ok('没有同名的表 ⟹ 空串（今天注册表那 30 套走的就是这一支，theme.json 一个字节都不变）')
    : bad(`没有同名的表，却返回了 ${JSON.stringify(got)}`);
}

console.log('\n── 三种该说「没有」的形状 ──');
// 这三格量的是同一件事：这个值会被拼成一条文件路径，而写下去之后校验它的是构建。
for (const [why, id] of [
  ['路径穿越', '../../etc/passwd'],
  ['大写字母（sync-config 的 slug 判据不收）', 'Ocean-Blue'],
  ['不是字符串', 42],
]) {
  const got = sheetNameForTheme(id, root);
  got === ''
    ? ok(`${why} ⟹ 空串`)
    : bad(`${why} 被放行成 ${JSON.stringify(got)} —— 写进 theme.json 就是一个构建不出来的站`);
}
{
  // 阳性对照：上面三格全绿也可能只是「这个夹具目录里什么都没有」。造一个名字确实不合法、
  // 文件却真的在的表，证明红是形状判据判出来的，不是「文件不在」顺手判的。
  fs.writeFileSync(path.join(root, 'public', 'themes', 'Ocean-Blue.css'), '/* x */\n');
  const got = sheetNameForTheme('Ocean-Blue', root);
  got === ''
    ? ok('阳性对照：`Ocean-Blue.css` 真的在磁盘上，仍然返回空串 ⟹ 拦它的是形状那一条，不是「文件不在」')
    : bad(`阳性对照红了：文件在就放行了 ${JSON.stringify(got)}，形状判据没在判事`);
  fs.unlinkSync(path.join(root, 'public', 'themes', 'Ocean-Blue.css'));
}

console.log('\n── 写的一侧与读的一侧那条正则要一样 ──');
{
  const syncConfig = fs.readFileSync(path.join(__dirname, 'sync-config.js'), 'utf-8');
  const m = syncConfig.match(/if \(!(\/\^\[a-z0-9\][^/]*\/)\.test\(name\)\)/);
  if (!m) {
    bad('在 sync-config.js 里找不到 readThemeSheet 那条 slug 正则了 —— 它被改写过，'
      + '本格量不了两处一不一致，去人工核对 theme-sheet.js 的 SHEET_NAME_OK');
  } else if (m[1] === SHEET_NAME_OK.toString()) {
    ok(`两处逐字相同：${m[1]}`);
  } else {
    bad(`分叉了 —— sync-config.js 是 ${m[1]}，theme-sheet.js 是 ${SHEET_NAME_OK}。`
      + '写的一侧宽了 ⟹ 那个站构建不出来');
  }
}

console.log(`\n${fail ? '❌' : '✅'} theme-sheet.test.js — ${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
