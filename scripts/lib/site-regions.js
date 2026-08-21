'use strict';

/**
 * site-regions.js — 这个站的每一页由哪些区组成，每个区是什么版式？（#1104 r6）
 *
 *   const { resolveSiteRegions } = require('./lib/site-regions.js');
 *   const r = resolveSiteRegions(siteDir);
 *   r.regionLayout.footer   // 主题给的页脚版式
 *   r.footerVariants        // 这个站【真的渲染出来】的那几个页脚，按区的顺序
 *   r.hasTopbarRegion       // 这个站的页面上有没有那条顶部横带
 *
 * ── 为什么单开一个文件 ──────────────────────────────────────────────────────────────────────────
 * 这一问原来只有构建自己在答（`sync-config.js` 里那两个读 `theme.json` 的函数）。#1104 之后
 * **AI 聊天编辑器也要答同一问**：它放行了一次对 `navigation.json` 的编辑之后，得知道「这个站的页面
 * 到底读不读这个字段」，读不到就要把这件事说给老板听（`navigation-owned.js` 的 `PAGE_READS`）。
 *
 * 🔴 两处各写一遍必然分叉，而分叉的方向是**门说"你这个站不显示它"、页面其实显示了**（或者反过来）
 *    —— 两种都是本票要治的那个病（说的话跟页面上发生的事对不上）。所以这里是唯一实现，
 *    `sync-config.js` 也从这里拿（它拿走的就是它自己原来那两个函数，逐字搬过来的）。
 *
 * 🔴 本模块只**读**，不校验、不退出。`sync-config.js` 里那些 `process.exit(1)` 一条都没搬过来：
 *    构建拒绝一个站是构建的职责，而聊天编辑器拿到同一份读数时不能把老板的编辑打死。
 */

const fs = require('fs');
const path = require('path');

const { themes, layoutFor } = require('../themes');
const { resolveRegionLayout } = require('../region-layout');
const pageLayoutLib = require('./page-layout');

// ── 下面这两个函数 2026-08-20 从 `sync-config.js` 搬过来（#1104 r6），逐字未改，只把它们读的
//    `siteDir` 从模块作用域换成入参。注释一起搬 —— 它们记的是这两个函数为什么长这样。 ──────────

// #1079 — THE HEADER/FOOTER STRUCTURE FOR A THEME THAT IS **NOT** IN THE REGISTRY YET.
//
//     { "themeId": "gen-07-60", "applied": false, "css": "gen-07-60",
//       "regionLayout": { "header": "pill-floating", "footer": "cta-band" } }
//
// 🔴 Why this key has to exist at all. The candidate pipeline installs a candidate with
// `applied: false` on purpose (`theme-pipeline/run.js` installCandidate). 🔴 #1121 CHANGED THE
// REASON WITHOUT CHANGING THE CONCLUSION: it used to be "`true` would make the REGISTRY override
// brand.json's colours", and the registry does not override colours any more — but `readAppliedThemeId`
// above still `process.exit(1)`s on an id that is not in the registry, and a candidate's id never is,
// so `applied: true` on a candidate would kill its build outright. Still false, still on purpose.
// Back when this key was added, `applied: false` also pinned the two Regions to their defaults,
// because `readAppliedThemeId` returned null and `resolveRegionLayout({})` answers solid-bar +
// multi-column. So the gallery a human signs
// off on (`theme-pipeline/gallery.js`, gate ④) printed `solid-bar` on all 80 cards while only 22 of
// the 80 pool members are actually solid-bar — the one dimension a human cannot check against
// anything else was, by construction, always wrong. Measured: #1079's repro, and the 80 shot
// readbacks of #1016's r4c gallery.
//
// 🔴 #1086 摘掉了「只在 `applied !== true` 那条路上读」这条限制,连同下面那句 `if (appliedThemeId)
// return {}`。为什么摘:那条限制的理由是「换过装的站,结构归注册表,这个键到不了它」——而本票把
// 「结构」和 `applied` 解耦之后,那个理由不成立了。现在的规则一句话:**结构来自 themeId 那套主题,
// 谁在 theme.json 里显式写了哪个键,那个键就归他**,`applied` 不参与。
// 📌 摘它今天不改变任何一个站,这是量过的、不是推的:写这个键的**只有**候选流水线
// (`theme-pipeline/run.js` installCandidate),而它恒写 `applied: false`(它自己那条 🔴 注释里
// 写着为什么必须是 false);换装那一下(`worker/main.go` processThemeTask)写的是
// `{ themeId, applied: true }`,连前一份的 regionLayout 都不带过去。⟹ `applied:true` + 这个键
// 这个组合没有任何代码路径能造出来。
//
// 🔴 No new validation here on purpose: `resolveRegionLayout` already refuses a value that is not in
// its list, falls back to the default and says so in `notes` (which sync-config.js prints). A second
// check here would be a second list to forget — the same reason #991's `css` check reads the
// filesystem instead of keeping a list.
function readPreviewRegionLayout(siteDir) {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return {};
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(themePath, 'utf-8'));
  } catch {
    return {}; // sync-config.js 的 readAppliedThemeId 已经报过这个解析错误并退出了。
  }
  const wanted = meta && meta.regionLayout;
  if (!wanted || typeof wanted !== 'object') return {};
  return wanted;
}

// #1086 — 顶栏 / 页脚的结构跟着 `themeId` 走,不再跟着 `applied` 走。
//
// 这张票要治的形状,用最短的话说:**同一套主题有两种长相 —— 老板在后台换过一次装之前和之后不一样。**
//   新建的站    create-site.js 写 { themeId, applied:false, css:<表名> }  → 拿到皮,拿不到骨:
//               `readAppliedThemeId()` 对 applied!==true 返回 null,于是两个 Region 落回默认
//               (solid-bar + multi-column)。
//   换过一次装  worker/main.go processThemeTask 写 { themeId, applied:true } → 结构突然出现。
// 后果是签字的那张图不是客人会拿到的那个站:注册表图册按 applied:true 渲染,ember-38 印的是
// centered-logo,而真站是 solid-bar。Chris 2026-08-18 拍板:结构一律跟着 themeId 走,`applied`
// 从此只管「老板有没有主动换过装」,不再管结构。
//
// 🔴 这个函数【故意】跟 `readAppliedThemeId()` 分开,而不是把那个函数的 applied 判断删掉。
// 🔴 #1121 更新了这里的理由 —— 立这个函数时（#1086）的理由是「applied 仍然决定颜色和字体」，
// 那句话今天不成立了：颜色和字体永远来自 brand.json，applied 一维长相都不决定。留着两个函数的
// 理由换成了下面那一条，而它本来就是承重的那一条：**两个函数对「注册表里查不到这个 id」的答法
// 相反** —— 这个返回 null 让构建继续，那个 exit 1。合并就必然要二选一，而两条路都需要。
//
// 🔴 查不到的 id 在这里【返回 null,不打死构建】,与 `readAppliedThemeId()` 相反,而这个不对称是
// 承重的,不是漏写:
//   · 候选流水线装候选时写的正是 { themeId:<还没进注册表的 id>, applied:false, regionLayout:{…} }
//     (`theme-pipeline/run.js` installCandidate)。在这里退出会把候选图册整条路打死。
//   · applied:true 那条路上「查不到的 id 该怎么办」是 **#1087** 在问的问题(生产站 site-194f1f41
//     的 theme.json 写着一个从来不存在的 `luxury-dark`),它要 Chris 拍。本票不预判它,所以
//     `readAppliedThemeId()` 的那个 `process.exit(1)` 一个字都没动。
function readStructureThemeId(siteDir) {
  const themePath = path.join(siteDir, 'theme.json');
  if (!fs.existsSync(themePath)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(themePath, 'utf-8'));
  } catch {
    return null; // sync-config.js 的 readAppliedThemeId 已经报过这个解析错误并退出了。
  }
  if (!meta || typeof meta.themeId !== 'string' || !meta.themeId) return null;
  // 注册表里没有 ⟹ 不是「取默认」也不是「报错」,而是「这套主题的结构不在这里」:让下面的
  // regionLayout(候选那条路)或默认值接手。理由见上面第三段。
  if (!themes[meta.themeId]) return null;
  return meta.themeId;
}
/**
 * 这个站的两个 Region 解析成什么版式 —— `sync-config.js` 原来在文件中段做的那次 `resolveRegionLayout`。
 *
 * @returns {{regionLayout: object, structureThemeId: string|null, explicitRegionLayout: object}}
 *   后两项 `sync-config.js` 的日志要用（它得说得出**结构是从哪来的**，不只说结果是什么）。
 */
function resolveSiteRegionLayout(siteDir) {
  const structureThemeId = readStructureThemeId(siteDir);
  const explicitRegionLayout = readPreviewRegionLayout(siteDir);
  const regionLayout = resolveRegionLayout({
    ...(structureThemeId ? layoutFor(structureThemeId) : {}),
    ...explicitRegionLayout,
  });
  return { regionLayout, structureThemeId, explicitRegionLayout };
}

/**
 * 这个站的一页上到底渲染出几个页脚、各是什么版式。
 *
 * 🔴 **不是** `regionLayout.footer` 一个值。page layout 库里的 `tri-footer` 把页脚拆成三个区，
 *    每个区的版式由布局自己钉（`repeatVariants`，`SiteShell.tsx` 只有 footer 这一类接了这条线）。
 *    挑了它的站三种页脚同时在页面上 ⟹ 三种里任何一种读的字段，这个站都看得见。
 *    只看主题那一个值会把这种站判成「读不到」，而那正是本票要避免的那类假话。
 *
 * @returns {string[]} 按区的顺序，可能有重复；至少一项（schema 要求每个布局都有 footer 区）。
 */
function footerVariantsFor(siteDir) {
  const { regionLayout } = resolveSiteRegionLayout(siteDir);
  const picked = pageLayoutLib.resolveSiteLayout(siteDir);
  const repeat = (picked.layout && picked.layout.repeatVariants) || {};
  const regions = (picked.layout && picked.layout.regions) || [];
  return regions
    .filter((r) => pageLayoutLib.kindOf(r) === 'footer')
    .map((r) => repeat[r] || regionLayout.footer);
}

/** 这个站的页面上有没有那条顶部横带（`with-topbar` 那种布局才有）。 */
function hasTopbarRegion(siteDir) {
  const picked = pageLayoutLib.resolveSiteLayout(siteDir);
  return pageLayoutLib.needsTopbar(picked.layout);
}

/** 门那一侧要的两句话（`edit-site.js` 递给 `writeNotes`）。 */
function resolveSiteRegions(siteDir) {
  return {
    ...resolveSiteRegionLayout(siteDir),
    footerVariants: footerVariantsFor(siteDir),
    hasTopbarRegion: hasTopbarRegion(siteDir),
  };
}

module.exports = {
  readPreviewRegionLayout,
  readStructureThemeId,
  resolveSiteRegionLayout,
  footerVariantsFor,
  hasTopbarRegion,
  resolveSiteRegions,
};
