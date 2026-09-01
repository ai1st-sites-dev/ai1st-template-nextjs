'use strict';
// template-layer.js —— 升级一个已有站时，算「铺哪些文件、删哪些文件」（#1166 第 1 步 / AC2）。
//
// ══ 站的仓是两层叠起来的 ═══════════════════════════════════════════════════════════════════════
//   数据层  `site/` 下的全部 · `public/logo.png` · `public/photos/**`
//   模板层  其余（`src/` · `scripts/` · `package.json` · `public/base.css` · `public/images/` …）
// 仓建好之后模板那层再没人动过 —— 真机量过一个：`site-51c2f83b`（2026-07-23 建）身上那份模板是
// 72 个文件，今天的模板是 293 个。升级就是把模板层换成今天这份，数据层一个字不动。
//
// 🔴🔴 删除集【不许】按「除 site/ 之外」算 —— 那样会删掉这个站自己的照片和 logo。
//
// 真机读数（#1166 正文，PM 按全量 29 个站仓复核过）：`site-51c2f83b` 的 HEAD 里非 `site/` 的文件
// 有 91 个，今天的模板（去掉 `site/`）293 个，两者的差集 23 个 —— 其中 **18 张
// `public/photos/*` + `public/logo.png`**，只有 4 个是真的模板文件（那四个被合并掉的
// `*Section.tsx`）。照片和 logo 是「Generate site」那一次写进来的（照片在 `create-site.js §generateSlotPhotos`，
// logo 在 `§generateContent` 里 `fs.writeFileSync(path.join(publicDir, 'logo.png'), …)` 那一句），它们**在
// `site/` 之外**，所以「除 site/ 之外」这把尺子会把它们算成删除集。
//
// ⟹ 基线是【这个站现在身上那份模板的文件清单】：
//      · 没升级过的站 → 仓库的第一个 commit（`/generate` 出来那个，建站当天的模板快照）。照片和
//        logo 是后来那次 commit 才写进来的、不在第一个 commit 里，**按构造永远进不了删除集**。
//        （第一个 commit 拿得到是因为 #1033 让站仓保留完整历史，`entrypoint.sh:29-33`。）
//      · 已升级过的站 → 上一次铺进去的那一版。所以升级必须留下记录，见 §UPGRADE_RECORD。
//
// 🔴 基线不是恒定的第一个 commit。第二次升级如果还拿第一个 commit 当基线，第一次铺进来、而今天
// 模板已经没有的那些文件就永远删不掉 —— 这正是 AC2③ 那一格要抓的。

const path = require('path');

// UPGRADE_RECORD —— 升级留下的记录，放在数据层里（它属于这个站，不属于模板）。
//
// 🔴 放 `site/` 下面是有理由的：它必须活过下一次「铺模板层」这个动作本身。放模板层里的话，下一次
// 升级会先把它删掉/盖掉，然后就没有基线可读了。
const UPGRADE_RECORD = 'site/.upgrade.json';

// DATA_LAYER —— 数据层的判据。三条，逐条都有出处。
//
// 🔴 这是一份**判据**而不是一份清单：照片的文件名是 `/photos/<key>.jpg`，key 由建站那次的内容定，
// 写死名字等于每加一张照片就漏一张。
function isDataLayer(p) {
  return p === 'site' || p.startsWith('site/')
    || p === 'public/logo.png'
    || p.startsWith('public/photos/');
}

// templateFilesOf —— 从一份「仓里全部文件」的清单里，取出模板层那些。
function templateFilesOf(allPaths) {
  return allPaths.filter((p) => !isDataLayer(p)).sort();
}

// planTemplateLayer —— 算这次升级要铺什么、删什么。
//
// 入参都是**文件路径的数组**（相对仓根），谁去取由调用方决定（worker 那边一个是 `git ls-tree`，
// 一个是今天模板目录的 walk）—— 这样这份判据可以在没有容器、没有 git 的地方被测。
//
//   baselinePaths  这个站现在身上那份模板的清单（第一个 commit，或上次升级的记录）
//   todayPaths     今天模板里的全部文件
//   currentPaths   容器工作树/HEAD 现在有哪些文件（用来把删除集收窄成「真的还在」的那些）
//
// 返回 { lay, remove, keptData, baselineSource }
//   lay        要铺的（今天模板的模板层全部 —— 铺是覆盖，逐个都铺，不做「只铺变了的」那种优化：
//              那需要比字节，而少铺一个的失败方向是静默的）
//   remove     要删的 = 基线的模板层 − 今天的模板层，再与 currentPaths 求交
//   keptData   currentPaths 里属于数据层的那些（**永远不动**，打出来是为了让「没删照片」这件事
//              是一个读数，而不是一句承诺）
function planTemplateLayer({ baselinePaths, todayPaths, currentPaths }) {
  const baseTpl = new Set(templateFilesOf(baselinePaths));
  const todayTpl = new Set(templateFilesOf(todayPaths));
  const current = new Set(currentPaths);

  const remove = [...baseTpl]
    .filter((p) => !todayTpl.has(p))
    // 🔴 与「现在真的还在」求交：基线里有、今天模板没有、而工作树里也已经没有的，不要报进删除集
    //    —— 那会让「删除集为空」这个读数分不出「没什么可删」和「清单算错了」。
    .filter((p) => current.has(p))
    .sort();

  // 🔴 这里【不再】加一道「删除集里有没有数据层」的检查 —— 它在这个函数里**按构造不可达**：
  //    `templateFilesOf` 已经把数据层从 baseTpl 里滤掉了，所以 remove 里永远到不了数据层。写在这里
  //    的话它是一道永远不会开火的保险，而永远不开火的保险比没有更糟（人会以为那一维有人看着）。
  //    真正能出错的地方是**调用方**：它要把这些路径拼成容器里的 `rm`，路径拼接 / 通配都可能把数据层
  //    带进去。所以那道检查做成 §assertNoDataLayer 由调用方在「真要删的那一刻」调，测试驱动的也是它。
  return {
    lay: [...todayTpl].sort(),
    remove,
    keptData: [...current].filter(isDataLayer).sort(),
  };
}

// baselineFrom —— 从升级记录里读基线，读不到就说清楚该落回第一个 commit。
//
// record 的形状（这次铺的模板是从哪来的，写进 UPGRADE_RECORD）：
//   { upgradedAt, source: {kind:'path'|'repo', ref, sha}, templatePaths: [...] }
//
// 🔴 `source` 要记全 —— 「哪个仓/哪个路径 + 哪个 sha」。test / prod 今天两个模板仓的内容与 main
// 相同，但那不是本票保证的；仓落后 main 时升上去的就是仓里那版，记录里要写清是哪一版，否则第二次
// 升级会拿错基线。
function baselineFrom(record) {
  if (record && Array.isArray(record.templatePaths) && record.templatePaths.length) {
    return { paths: record.templatePaths, source: 'upgrade-record', detail: record.source || null };
  }
  return { paths: null, source: 'first-commit', detail: null };
}

// assertNoDataLayer —— 在【真要删】的那一刻再问一次：这批路径里有数据层吗？
//
// 🔴 它属于调用方，不属于 planTemplateLayer（那里不可达，理由写在上面）。调用方拿到 remove 之后还要
// 做事：拼容器里的路径、可能展开目录、可能把别处算出来的清单并进来 —— 那几步都能把照片带进来，而
// 这里是最后一个能拦住的地方。上一版正文那把「除 site/ 之外」的尺子算出来的删除集里就有 18 张照片
// 和一个 logo，所以这不是防御性编程，是对着一个量到过的错误。
function assertNoDataLayer(paths, what = 'delete set') {
  const hits = paths.filter(isDataLayer);
  if (hits.length) {
    throw new Error(`${what} contains ${hits.length} data-layer file(s): ${hits.slice(0, 5).join(', ')}`
      + `${hits.length > 5 ? ` … and ${hits.length - 5} more` : ''}`);
  }
  return paths;
}

module.exports = {
  UPGRADE_RECORD,
  assertNoDataLayer,
  isDataLayer,
  templateFilesOf,
  planTemplateLayer,
  baselineFrom,
};
