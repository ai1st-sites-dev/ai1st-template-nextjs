'use strict';
// #1121 — 把一个样例站「穿上」某一套主题。**这个动作有两半，这个文件的存在就是为了它们不再分开。**
//
//   ① site/theme.json   ← { themeId, applied: true }（可选再带一个 css 表名）
//   ② site/brand.json   ← 那套主题的 colors / fonts / settings
//
// ── 为什么必须是两半（#1121）─────────────────────────────────────────────────────────────────────
// 在 #1121 之前，只写 ① 就够了：构建期 sync-config.js 看见 `applied: true` 会拿注册表那套
// colors / fonts / settings **现盖**内存里的 brand。#1121 把那处覆盖撤掉了 —— 颜色 / 字体 /
// 风格设定从此永远来自这个站自己的 brand.json，构建期一处覆盖都没有；而「换主题仍然改颜色」靠的
// 是 worker 在老板按下 Apply 那一刻把新主题那套写进 brand.json（`worker/main.go` 的
// `processThemeTask` §write）。
//
// ⟹ 任何**自己动手给站上色**的工具，就是在扮演 worker 那一步，必须两半都做。少了 ② 的后果不是
//    报错，是**一组对照全部读到同一个值**：不管写哪套主题，页面上的颜色恒等于这个样例站建站那天
//    那一套。#1121 交付当天在 `theme-css-invariants-all-sheets.sh` 上实测过（83 张表全部落在同一
//    套调色板上，其中 5 张因此报了对比度不合格，而同样那几张在干净 origin/main 上是绿的），
//    QA1 随后在 `theme-gallery/` 又找到两处同样的写法。
//
// 🔴 三个键跟 worker 那一步**逐个对应**（`if (th.colors)` / `if (th.fonts)` /
//    `if (th.settings) … else delete`），别的键一个都不动 —— brand.json 里的站名、logo、地址、
//    表单 id 全部原样留着。两处实现要是分叉，「样例站上量到的」就不再是「真站上会发生的」。
//
// 🔴 **注册表从磁盘上那份 `scripts/themes.js` 读**，不是调用方自己传一份进来。
//    `theme-gallery/check-controls.sh` 的正例对照就是**在原地改那个文件**（把另一套主题的 colors
//    块打进去）再构建 —— 它要的正是「改过的注册表要能到页面上」。从磁盘读，那条路自动还成立；
//    调用方传主题对象进来的话，那个脚本就得自己再实现一遍读取，也就又分叉了。
//
// ── 用法 ────────────────────────────────────────────────────────────────────────────────────────
//   命令行（shell 脚本用这个）：
//     node scripts/lib/dress-site-in-theme.js <站目录> <themeId> [表名]
//       rc=0 穿上了（stdout 一行读数）· rc=2 什么都没写（原因在 stderr）
//
//   模块（node 里用这个）：
//     const { dressSiteInTheme } = require('./lib/dress-site-in-theme.js');
//     dressSiteInTheme({ siteDir, themeId, css });
//
// 🔴 **失败一律不写半个**：主题查不到、brand.json 不在、brand.json 不是 JSON —— 三种都在动笔
//    之前抛出来，`site/theme.json` 一个字节都不动。上色只做了一半的站，比没上色的站更难诊断：
//    它长得跟「代码坏了」一模一样。
//
// 📌 这里**不管存档还原**。谁调用谁负责把样例站恢复成它找到时的样子（`theme.json` 与
//    `brand.json` 各存一份），因为「跑完要不要还原」是调用方的性质：
//    `theme-css-invariants-all-sheets.sh` 与 `theme-gallery/*.sh` 都还原，
//    worker 在真站上做的这件事恰恰**不能**还原。

const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY = path.join(__dirname, '..', 'themes.js');

/**
 * @param {object}  opts
 * @param {string}  opts.siteDir       样例站目录（里面有 theme.json / brand.json；多语言站也是这一层）
 * @param {string}  opts.themeId       注册表里的主题 id
 * @param {string} [opts.css]          写进 theme.json 的表名（`css` 键）。不给就不写这个键 ——
 *                                     它跟 `applied` 是两码事（#991），给一个默认值会改变被拍到的东西。
 * @param {string} [opts.registryPath] 注册表路径，默认 `scripts/themes.js`。只有测试会传它。
 * @returns {{themeJsonPath: string, brandJsonPath: string, keys: string[]}}
 */
function dressSiteInTheme({ siteDir, themeId, css, registryPath = DEFAULT_REGISTRY }) {
  if (!siteDir) throw new Error('dressSiteInTheme: 没给站目录');
  if (!themeId) throw new Error('dressSiteInTheme: 没给 themeId');

  const { themes } = require(registryPath);
  const theme = themes[themeId];
  if (!theme) {
    throw new Error(`注册表 ${registryPath} 里没有主题 "${themeId}" —— 什么都没写`);
  }

  const brandJsonPath = path.join(siteDir, 'brand.json');
  if (!fs.existsSync(brandJsonPath)) {
    // 这个文件不是可选的：sync-config.js 没有它直接退出。所以「它不在」是夹具的问题，
    // 不是要静默容忍的一种形状。
    throw new Error(`${brandJsonPath} 不在 —— 这个站还不是一个能构建的站，什么都没写`);
  }
  let brand;
  try {
    brand = JSON.parse(fs.readFileSync(brandJsonPath, 'utf-8'));
  } catch (e) {
    throw new Error(`${brandJsonPath} 读不成 JSON（${e.message}）—— 什么都没写`);
  }

  const keys = [];
  if (theme.colors) { brand.colors = theme.colors; keys.push('colors'); }
  if (theme.fonts) { brand.fonts = theme.fonts; keys.push('fonts'); }
  if (theme.settings) { brand.settings = theme.settings; keys.push('settings'); }
  else if ('settings' in brand) { delete brand.settings; keys.push('settings(删掉)'); }

  // 两个文件都写完才算穿上，所以放在一起、都在上面那些检查之后。
  const themeJsonPath = path.join(siteDir, 'theme.json');
  const meta = { themeId, applied: true };
  if (css) meta.css = css;
  fs.writeFileSync(themeJsonPath, JSON.stringify(meta, null, 2) + '\n');
  fs.writeFileSync(brandJsonPath, JSON.stringify(brand, null, 2) + '\n');

  return { themeJsonPath, brandJsonPath, keys };
}

module.exports = { dressSiteInTheme, DEFAULT_REGISTRY };

if (require.main === module) {
  const [siteDir, themeId, css] = process.argv.slice(2);
  if (!siteDir || !themeId) {
    console.error('用法: node scripts/lib/dress-site-in-theme.js <站目录> <themeId> [表名]');
    process.exit(2);
  }
  try {
    const r = dressSiteInTheme({ siteDir, themeId, css });
    console.log(`穿上 "${themeId}"：${path.basename(r.themeJsonPath)} + ${path.basename(r.brandJsonPath)} 的 ${r.keys.join(' / ')}`);
  } catch (e) {
    console.error('🔴 ' + e.message);
    process.exit(2);
  }
}
