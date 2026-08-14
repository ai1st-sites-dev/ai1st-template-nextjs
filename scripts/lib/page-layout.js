// ══════════════════════════════════════════════════════════════════════════════════════════════════
// page-layout.js — 「一个页面由哪些区组成」的库（#1000，spec §4.9② / D15）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 在这之前只有一种页面骨架，写死在 `SiteShell.tsx` 里：header → content → footer，页面写不出别的。
// #960 给了每个区自己的结构变体，但「有哪些区」不可变。这个库把那件事变成可选，站在
// `site/page-layout.json` 里挑一个（`{"layoutId":"standard"}`），缺文件按 `standard` 走。
//
// 🔴 骨归站、皮归主题（spec §4.2，作者 2026-08-14 在 #1000 上确认过一次）：
//   这个库只说**有哪些区**；每个区长什么样仍由主题决定（`scripts/region-layout.js` 的
//   `resolveRegionLayout`，换装才接管）。唯一的例外写在下面 `repeatVariants` 那段——同一种区出现
//   多次时主题只有一个值，分不出谁是谁。
//
// 🔴 D11 的保证挪进了这里，没有丢。以前「页面写不出没有 Header 的站」是**写死**保证的；按库拼区之后
//   降级成「库里定义的」，所以下面的 schema 强制每个布局都得有 header / content / footer 三种区，
//   缺一个构建期就拒绝并点名。AC2 是这条的替身，AC6 是它的反向对照。
const fs = require('fs');
const path = require('path');

const { HEADER_VARIANTS, FOOTER_VARIANTS, TOPBAR_VARIANTS } = require('../region-layout');

const LAYOUTS_DIR = path.join(__dirname, '..', '..', 'page-layouts');
const DEFAULT_LAYOUT_ID = 'standard';

/** 区的四种「类」。区名是类本身（`footer`），或者类加后缀（`footer-a`）——后缀只用来区分同类的第几个。 */
const REGION_KINDS = ['topbar', 'header', 'content', 'footer'];
/** 缺了它们，页面就不是一个页面：header/footer 是 D11，content 是页面自己的块。 */
const REQUIRED_KINDS = ['header', 'content', 'footer'];

const VARIANTS_BY_KIND = {
  header: HEADER_VARIANTS,
  footer: FOOTER_VARIANTS,
  topbar: TOPBAR_VARIANTS,
};

function kindOf(region) {
  if (REGION_KINDS.includes(region)) return region;
  const dash = region.indexOf('-');
  const head = dash > 0 ? region.slice(0, dash) : region;
  return REGION_KINDS.includes(head) ? head : null;
}

function loadLayouts(dir = LAYOUTS_DIR) {
  const out = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const layout = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
    if (layout.id !== path.basename(name, '.json')) {
      throw new Error(`page-layouts/${name}: id 是 "${layout.id}"，跟文件名对不上`);
    }
    out.set(layout.id, layout);
  }
  return out;
}

/** 一个布局合不合法 → string[]（空 = 合法）。 */
function validateLayout(layout) {
  const problems = [];
  const where = `page-layouts/${layout && layout.id ? layout.id : '(没有 id)'}.json`;
  const regions = (layout && layout.regions) || [];
  if (!Array.isArray(regions) || regions.length === 0) {
    problems.push(`${where}: 没有 regions`);
    return problems;
  }

  const kinds = [];
  for (const r of regions) {
    const kind = kindOf(r);
    if (!kind) {
      problems.push(`${where}: 区 "${r}" 不是这四类里的任何一类（${REGION_KINDS.join(' / ')}），`
        + '渲染器不知道该拿什么画它');
      continue;
    }
    kinds.push(kind);
  }

  // 🔴 D11 —— 这三条是这个 schema 存在的理由，不是一般的字段校验。
  for (const kind of REQUIRED_KINDS) {
    if (!kinds.includes(kind)) {
      problems.push(`${where}: regions 里没有 "${kind}" —— 每个布局都必须有它`
        + (kind === 'content' ? '（否则页面自己的块无处可去）'
          : '（spec §4.4 / D11：Header 与 Footer 是保证，不是选项）'));
    }
  }
  if (kinds.filter((k) => k === 'content').length > 1) {
    problems.push(`${where}: 有不止一个 content 区 —— 页面的块只有一份，渲染两次是复制品`);
  }

  // 同一种区出现多次时，主题给不出「第几个是什么」（它每类只有一个值），所以布局必须自己说。
  const repeats = REGION_KINDS.filter((k) => kinds.filter((x) => x === k).length > 1);
  const declared = (layout && layout.repeatVariants) || {};
  for (const kind of repeats) {
    for (const r of regions.filter((x) => kindOf(x) === kind)) {
      const v = declared[r];
      if (!v) {
        problems.push(`${where}: "${kind}" 出现了不止一次，但没说 "${r}" 用哪种结构 `
          + `（repeatVariants 里补一个：${(VARIANTS_BY_KIND[kind] || []).join(' / ')}）`);
      } else if (!(VARIANTS_BY_KIND[kind] || []).includes(v)) {
        problems.push(`${where}: repeatVariants["${r}"] = "${v}" 不在 ${kind} 的结构清单里`
          + `（${(VARIANTS_BY_KIND[kind] || []).join(' / ')}）`);
      }
    }
  }
  for (const r of Object.keys(declared)) {
    if (!regions.includes(r)) problems.push(`${where}: repeatVariants 写了 "${r}"，而 regions 里没有这个区`);
  }
  return problems;
}

/**
 * 站选了哪个布局 + 它合不合法 → { layout, problems }
 * 站根目录的 `page-layout.json`（`{"layoutId":"…"}`）。缺文件 ⟹ standard，这是所有存量站的那一条路。
 * 🔴 不放 `site_meta.json`：那个文件**存不存在**本身是「老单语言站」的判据（`sync-config.js:113`），
 *    往里塞东西会把老站判成新站。理由跟 `theme.json` 当初分出来一样。
 */
function resolveSiteLayout(siteDir, dir) {
  const layouts = loadLayouts(dir);
  const problems = [];
  const file = path.join(siteDir, 'page-layout.json');
  let layoutId = DEFAULT_LAYOUT_ID;
  let explicit = false;
  if (fs.existsSync(file)) {
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      problems.push(`site/page-layout.json 不是合法 JSON：${e.message}`);
      return { layout: layouts.get(DEFAULT_LAYOUT_ID), layoutId: DEFAULT_LAYOUT_ID, explicit: false, problems };
    }
    if (meta && typeof meta.layoutId === 'string' && meta.layoutId.trim()) {
      layoutId = meta.layoutId.trim();
      explicit = true;
    }
  }
  const layout = layouts.get(layoutId);
  if (!layout) {
    problems.push(`site/page-layout.json 选的 "${layoutId}" 不在库里（有的是：${[...layouts.keys()].join(' / ')}）`);
    return { layout: layouts.get(DEFAULT_LAYOUT_ID), layoutId: DEFAULT_LAYOUT_ID, explicit, problems };
  }
  problems.push(...validateLayout(layout));
  return { layout, layoutId, explicit, problems };
}

/** 这个布局需要 navigation.json 里有 topbar 内容吗？—— 需要而没有，构建期拒绝（AC5 后半）。 */
function needsTopbar(layout) {
  return ((layout && layout.regions) || []).some((r) => kindOf(r) === 'topbar');
}

module.exports = {
  LAYOUTS_DIR,
  DEFAULT_LAYOUT_ID,
  REGION_KINDS,
  REQUIRED_KINDS,
  kindOf,
  loadLayouts,
  validateLayout,
  resolveSiteLayout,
  needsTopbar,
};
