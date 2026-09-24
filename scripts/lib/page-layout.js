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
//   `resolveRegionLayout`）。🔴 括号里原来写的是「换装才接管」——#1086（2026-08-18）之后那句是假的：
//   顶栏 / 页脚跟着 `themeId` 走，站有没有换过装不影响它。唯一的例外写在下面 `repeatVariants`
//   那段——同一种区出现多次时主题只有一个值，分不出谁是谁。
//
// 🔴 D11 的保证挪进了这里，没有丢。以前「页面写不出没有 Header 的站」是**写死**保证的；按库拼区之后
//   降级成「库里定义的」，所以下面的 schema 强制每个布局都得有 header / content / footer 三种区，
//   缺一个构建期就拒绝并点名。AC2 是这条的替身，AC6 是它的反向对照。
const fs = require('fs');
const path = require('path');

const { shapesOf, candidateShapeNames, REGION_BLOCK } = require('../region-layout');

const LAYOUTS_DIR = path.join(__dirname, '..', '..', 'page-layouts');
const DEFAULT_LAYOUT_ID = 'standard';

/** 区的四种「类」。区名是类本身（`footer`），或者类加后缀（`footer-a`）——后缀只用来区分同类的第几个。 */
const REGION_KINDS = ['topbar', 'header', 'content', 'footer'];
/** 缺了它们，页面就不是一个页面：header/footer 是 D11，content 是页面自己的块。 */
const REQUIRED_KINDS = ['header', 'content', 'footer'];

// #1353 —— 「这一类区有哪些结构」现从**块 manifest** 取（`blocks/<块>.json` 的 `shapes`），
// 不再从 `region-layout.js` 那三张写死的清单取 —— 那三张表随顶栏页脚搬进形态层一起退役了。
// 🔴 每次调用都现取，不在模块加载时固化成一个常量：`repeatVariants` 的校验只跑在构建 / 测试里，
//    而现取让「往 manifest 里加一种形态」当天就被这道校验认得，不用记得来改第二处。
function variantsForKind(kind) {
  const block = REGION_BLOCK[kind];
  return block ? shapesOf(block) : [];
}

/**
 * 哪些区可以在一个布局里出现多次。
 *
 * 🔴 这张表说的不是「哪些区重复起来有意义」，而是**渲染器真的接了线的那些**（#1014）：
 * `SiteShell.tsx` 只给 footer 区传了 `variant`，header / topbar 重复几次都只会按主题那一个值画。
 * 以前 schema 收下 `{"regions":["header-a","header-b",…]}` 并要求它们各自声明结构，而渲染出来两个
 * 一模一样 —— schema 答应的事没人兑现，且构建全绿。
 * 🔴 要让 header / topbar 也能重复，得先在 `SiteShell.tsx` 把 `variant` 传给它们，**再**把它加到这里。
 * 只加这里等于把 #1014 那一格重新打开。
 */
const REPEATABLE_KINDS = ['footer'];

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
    // content 上面那条已经点过名，理由还更具体（页面的块只有一份），别报第二遍。
    if (kind === 'content') continue;
    if (!REPEATABLE_KINDS.includes(kind)) {
      problems.push(`${where}: "${kind}" 出现了不止一次 —— 现在只有 `
        + `${REPEATABLE_KINDS.join(' / ')} 能重复。渲染器（src/components/SiteShell.tsx）只给 `
        + `${REPEATABLE_KINDS.join(' / ')} 区传了它自己那份结构，${kind} 重复几次都只会按主题的那一个值`
        + `画出来，repeatVariants 里写什么都不生效`);
      continue;
    }
    for (const r of regions.filter((x) => kindOf(x) === kind)) {
      const v = declared[r];
      if (!v) {
        problems.push(`${where}: "${kind}" 出现了不止一次，但没说 "${r}" 用哪种结构 `
          + `（repeatVariants 里补一个：${variantsForKind(kind).join(' / ')}）`);
      } else if (!variantsForKind(kind).includes(v)) {
        problems.push(`${where}: repeatVariants["${r}"] = "${v}" 不在 ${kind} 的结构清单里`
          + `（${variantsForKind(kind).join(' / ')}）`);
      }
    }
  }
  for (const r of Object.keys(declared)) {
    if (!regions.includes(r)) problems.push(`${where}: repeatVariants 写了 "${r}"，而 regions 里没有这个区`);
  }
  return problems;
}

/**
 * `page-layout.json` 里的 layoutId 能不能用 → 不能用时返回一句说清哪里坏了的话，能用时返回 null。
 *
 * 🔴 为什么单独一支（#1014）：这个文件此前两种坏法一种响一种不响 —— 坏 JSON 会拒绝并点名，而
 *    「文件在、但 layoutId 是数字 / 空串 / 缺键 / 键名大小写写错 / 是数组」全部静默按 standard 走，
 *    还顺便打印「站没挑，按默认」。站明明挑了，选的布局被悄悄换成另一个，而构建是绿的。
 *    「这个站没挑」的唯一诚实形态是**文件不存在**；文件留着而里面拿不出东西，是坏了，不是没挑。
 */
function badLayoutId(meta) {
  if (meta === null) return '文件内容是 null';
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return `文件顶层不是一个对象（是 ${Array.isArray(meta) ? '数组' : typeof meta}）`;
  }
  if (!('layoutId' in meta)) {
    const keys = Object.keys(meta);
    const near = keys.find((k) => k.toLowerCase() === 'layoutid');
    if (near) return `没有 layoutId 这个键，只有 "${near}" —— 大小写不一样`;
    return keys.length
      ? `没有 layoutId 这个键（文件里的键是：${keys.join(' / ')}）`
      : '没有 layoutId 这个键（文件里一个键都没有）';
  }
  const value = meta.layoutId;
  if (value === null) return 'layoutId 是 null，不是字符串';
  if (typeof value !== 'string') {
    return `layoutId 是 ${Array.isArray(value) ? '数组' : typeof value}，不是字符串`;
  }
  if (!value.trim()) return 'layoutId 是空字符串';
  return null;
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
    const bad = badLayoutId(meta);
    if (bad) {
      problems.push(`site/page-layout.json 在，但拿不出一个能用的 layoutId：${bad}。`
        + `写成 {"layoutId":"…"}（库里有的是：${[...layouts.keys()].join(' / ')}），`
        + `或者把这个文件删掉 —— 删掉才是「这个站没挑，按 ${DEFAULT_LAYOUT_ID} 走」`);
      return { layout: layouts.get(DEFAULT_LAYOUT_ID), layoutId: DEFAULT_LAYOUT_ID, explicit: false, problems };
    }
    layoutId = meta.layoutId.trim();
    explicit = true;
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

/**
 * #1405 —— 这个布局自己钉了页脚形态吗（`repeatVariants` 里有没有 footer 类的区）。
 *
 * 钉了的话 `SiteShell.tsx` 的 footer 那一支直接用 `repeatVariants[区名]`，站在 `theme.json` 里写的
 * `regionLayout.footer` 画不出来 ⟹ 编辑器那个「页脚形态」下拉在这种布局下改了也没用，要灰掉，存盘时也
 * 不许写它。判据只看布局文件本身，按 §kindOf 认区类（`footer-a` → footer），不列布局名。
 */
function layoutPinsFooter(layout) {
  return Object.keys((layout && layout.repeatVariants) || {}).some((r) => kindOf(r) === 'footer');
}

/**
 * 布局钉死的那几个区形态（`repeatVariants`），**去掉里面的候选**（#1384）。
 *
 * 🔴 **这是第三条能让真站戴上候选的路，而它跟另外两条都不重叠。** 主题选择单那条走
 *    `theme-pipeline/shape-sheet.js` 的 `shapeSheetFor`，页面 JSON 那条走 `sync-config.js` 的
 *    `shapeForBlock` —— 而布局把「这个页脚区戴哪种形态」直接写在 `page-layouts/*.json` 这份**数据
 *    文件**里，两条都不经过。QA3 2026-09-17 在会落地的合并形态上真构建复现过：把 `footer` 的
 *    `slim-row` 标成候选、站挑 `tri-footer`，构建退出码 0、零提示，产物里 `"footer-c":"slim-row"`，
 *    `SiteShell.tsx` 直传 `Footer` 渲染出来。
 *
 * 🔴 **落回的是「这个站那一类区已经解析出来的那个形态」，不是 manifest 的第 0 项。** 传进来的
 *    `regions` 是 `resolveRegionShapes` 的产物（`{header:{shape},footer:{shape},topbar:{shape}}`），
 *    它自己已经把候选挡掉了（`region-layout.js` §resolveRegionShapes），所以落回值按构造不是候选。
 *    取 manifest 第 0 项的话，一个把页脚设成 `cta-band` 的站会在这条路上突然掉回 `multi-column` ——
 *    那是一个没人要求过的、看得见的改动。
 *
 * 🔴 **这里落回，而不是让 `validateLayout` 报错。** 那条路今天存在（`repeatVariants` 的值不在
 *    结构清单里就 push 一条 problem），而 `sync-config.js` 见到 problem 会 `process.exit(1)`，
 *    并且它**校验库里每一份布局、不只校验这个站挑的那份** —— 哪天对表票把 `slim-row` 原名重做成
 *    候选，所有站的构建当天一起红，连没挑 `tri-footer` 的站也红。所以 `validateLayout` 一个字不动
 *    （它的成员判据仍然是不过滤候选的 `shapesOf`），候选在这里静静落回并说一行话。
 *
 * @param {object} layout   `resolveSiteLayout()` 回的那份布局
 * @param {object} regions  `resolveRegionShapes()` 的产物；缺某一类时那一类不落回（原样留着）
 * @returns {{variants: object, notes: string[]}}
 *   `variants` 是落回之后的那张表（键与 `layout.repeatVariants` 逐个相同）；
 *   `notes` 一行一句人话，调用方自己决定打不打（`sync-config.js` 打，库不打）。
 */
function resolveRepeatVariants(layout, regions) {
  const declared = (layout && layout.repeatVariants) || {};
  const variants = {};
  const notes = [];
  for (const [region, shape] of Object.entries(declared)) {
    variants[region] = shape;
    const kind = kindOf(region);
    const blockType = kind ? REGION_BLOCK[kind] : null;
    if (!blockType || !candidateShapeNames(blockType).has(shape)) continue;
    // 这一类区解析出来的那个形态。读不到（布局写了一个 `resolveRegionShapes` 不管的区类）就不动它 ——
    // 「没有可落回的值」跟「落回一个猜的值」是两件事，后者才是这张票在治的病。
    const fallback = regions && regions[kind] && regions[kind].shape;
    if (!fallback) continue;
    variants[region] = fallback;
    notes.push(`布局 ${layout && layout.id ? layout.id : '?'} 的 ${region} 点名形态 ${shape} `
      + `但它是候选（还没签字进库），落回 ${fallback}`);
  }
  return { variants, notes };
}

module.exports = {
  LAYOUTS_DIR,
  DEFAULT_LAYOUT_ID,
  REGION_KINDS,
  REQUIRED_KINDS,
  REPEATABLE_KINDS,
  kindOf,
  loadLayouts,
  validateLayout,
  resolveSiteLayout,
  resolveRepeatVariants,
  needsTopbar,
  layoutPinsFooter,
};
