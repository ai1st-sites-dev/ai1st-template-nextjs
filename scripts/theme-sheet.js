// #1064 — 「这套主题自己那张表叫什么」，只在这里回答一次。
//
// 背景：`site/theme.json` 的 `css` 字段点名 `public/themes/<name>.css`，构建时那份表的原文被整份
// 贴进生成出来的 `public/theme.css`（读的一侧是 `sync-config.js` 的 `readThemeSheet()`）。在本文件
// 之前**全仓没有一处代码往 `css` 写值** —— 两个写入方（建站 `create-site.js`、换主题
// `worker/main.go` 的 Apply）都只写 `{themeId, applied}`，所以每个站走的都是没有形态规则的那条路。
//
// 🔴 配对靠【同名】：主题 id 就是表的文件名。这不是这里发明的规矩，是流水线自己的写法 ——
//    `theme-pipeline/run.js` 的 `installCandidate()` 写的是 `{ themeId: id, applied: false, css: id }`，
//    一个 id 同时当注册表的键和 `public/themes/` 里那份文件的名字。#1016 的池成员就是这么进来的。
//
// 🔴 为什么是一个模块而不是两处各写一行：读的那一侧（`sync-config.js`）对这个值有两条硬要求，
//    而**两条都是「不满足就 `process.exit(1)`，整个构建挂掉」**：
//      ① 形状必须是 slug（`/^[a-z0-9][a-z0-9-]*$/`）—— 这个值会被拼成文件路径
//      ② 那个文件必须真的在
//    写的一侧漏掉任何一条，症状都不是「没穿上皮」，是**这个站从此构建不出来**。所以这两条在写入
//    之前问一次，答案是空串就干脆不写这个字段 —— 失败方向是「这个站没有形态规则」（也就是今天
//    100% 的站所处的状态），不是「这个站挂了」。
//
// 🔴 `SHEET_NAME_OK` 与 `sync-config.js` 里那条正则**必须逐字一致**，`theme-sheet.test.js` 有一格
//    读那个文件的原文来盯它 —— 两处各写一条正则，迟早只有一处被改。

const fs = require('fs');
const path = require('path');

// 🔴 与 `sync-config.js` 的 `readThemeSheet()` 逐字相同（改这里要同时改那里，测试会红）。
const SHEET_NAME_OK = /^[a-z0-9][a-z0-9-]*$/;

/**
 * 这套主题有没有自己那张形态样式表？有就返回该写进 `theme.json.css` 的名字，没有返回空串。
 *
 * @param {string} themeId       注册表里的主题 id（也就是表的文件名）
 * @param {string} [rootDir]     模板根目录；默认是本文件的上一级（`templates/nextjs/`），
 *                               容器里就是 `/app/repo`
 * @returns {string} 可以直接写进 `theme.json` 的 `css` 值，或者空串（= 别写这个字段）
 */
function sheetNameForTheme(themeId, rootDir = path.resolve(__dirname, '..')) {
  if (typeof themeId !== 'string') return '';
  const name = themeId.trim();
  if (!SHEET_NAME_OK.test(name)) return '';
  return fs.existsSync(path.join(rootDir, 'public', 'themes', `${name}.css`)) ? name : '';
}

module.exports = { sheetNameForTheme, SHEET_NAME_OK };
