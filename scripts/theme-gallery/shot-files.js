// shot-files.js — 一套主题/候选在 shots/ 目录里的全部产物，以及「开拍之前先清掉上一轮那份」。
//
// 🔴 #1061 r2 —— 这个文件为什么存在（QA3 在 r1 上打回的那一条）：
//
//   r1 把「有没有图给人翻」的判据从 `shoot.mjs` 的退出码换成了「盘上有哪几张图」。换掉是对的
//   （那个退出码是好几件事的或，其中一件今天对每个站都误报，结果三张拍好的图一张都不摆），
//   但换完之后新判据自己开了一个反方向的口子：**shots/ 是跨轮累积的，谁都不清。**
//
//   于是同一个 id 复跑、而这一轮整个失败时（对不上端口、站建不出来、静态检查就没过），盘上留着的
//   是上一轮的三张图和上一轮的 `<id>.json`，对照页照样把它们摆出来、卡片上照样印着上一轮那套表的
//   色号和字体，而翻图的人看不出来。QA3 是实测的：种一份带 `#STALE-FROM-LAST-RUN` 标记的残留，
//   对着一个死端口跑一轮 —— 本轮对盘的贡献是零字节，读数却原样把那个标记返回了回来。
//   还有个更细的：`shoot.mjs` 的图是逐页写的、`<id>.json` 是最后写的，中途崩掉会留下
//   「本轮的新图 + 上一轮的旧图 + 上一轮的旧读数」混成一套。
//
//   ⟹ 清掉之后，「盘上有这张图」重新等于「这一轮拍到了这张图」。那个等号是
//      `theme-pipeline/gallery.js` 的 `card()`、`gates.js` 第四道闸、`run.js` 那句「N/M 套有图」
//      共同站着的地基 —— 所以清的动作放在**每一轮开拍之前**，不是拍完之后。
//
// 谁调它（三处，缺一条路就漏一条）：
//   · `shoot.mjs` 开头            —— 盖住所有真的走到拍图那一步的路（含 `check-controls.sh`）
//   · `theme-pipeline/run.js`     —— 盖住**根本走不到拍图**的路：静态闸没过 / 样例站建不出来 /
//                                     建出来的不是这一份。那时这一轮一个字节都不写。
//   · `theme-gallery/shoot-themes.sh` —— 同上：注册表那条路建站失败会 `continue`，`shoot.mjs` 一次都不跑。
//
// 🔴 清的射程是**同一个 id**，不是整个目录。注册表那本图册按设计是攒出来的（`shoot-themes.sh`
//    可以只重拍其中几套），把别的 id 的图一起删掉会让那本图册凭空少几套。
const fs = require('fs');
const path = require('path');

// `shoot.mjs` 一轮里可能写下的全部图（后缀）。`''` 是首页，`-header` 只有 `--header-closeup` 才写。
// 🔴 这张表跟 `shoot.mjs` 的 `PAGES` 必须一起动：漏一个后缀，那一张就会跨轮活下来，而失败方向是
//    静默的。`shoot.mjs` 里有一句自查，漏改时当场退 2。
// 🔴 `-slid` (#1190) 不在 `shoot.mjs` 的 `PAGES` 里（它是同一页的第二次拍摄，推到底之后），
//    所以那边那句自查（PAGES ⊆ 这张表）碰不到它 —— 漏在这里的话它会跨轮活下来，而那正好是最坏的
//    方向：上一轮那套主题的横条图挂在这一轮这套主题的卡片上。
const SHOT_SUFFIXES = ['', '-about', '-allblocks', '-header', '-slid'];

/** 一套 id 在 shots/ 里的全部产物文件名（图 + 那份读数）。 */
function shotFiles(id) {
  return SHOT_SUFFIXES.map((s) => `${id}${s}.png`).concat(`${id}.json`);
}

/** 删掉这套 id 上一轮留下的产物，返回真删掉了哪几个（没有就是空数组）。 */
function clearShots(dir, id) {
  const gone = [];
  for (const f of shotFiles(id)) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) { fs.rmSync(p); gone.push(f); }
  }
  return gone;
}

module.exports = { SHOT_SUFFIXES, shotFiles, clearShots };
