'use strict';

// editor-schema.js —— 编辑器页（#1404）在构建时从**这个站自己的**区块库算出「Puck 里有哪些组件、每个
// 组件有哪些字段、形态下拉列哪几项」。算出来的是一份纯数据（能跨 server → client 边界），Puck 的
// config 由 `src/components/editor/EditorApp.tsx` 照它拼 —— render 函数只能在客户端那一侧。
//
// ── 为什么在构建时算、从站自己的仓读 ─────────────────────────────────────────────────────────────
// manifest 住在每个站自己的仓里，版本是它建站（或最后一次「更新网站」）那天的。拿一份今天的副本对
// 老站会「保存成功、页面一个字不变」（这条规矩当年写在检查器的可编辑探针上，#1352）。编辑器页是在站自己的
// 容器里构建的，这里的 `blocks/` 就是那个站的 `blocks/` —— 这个问题按构造不存在。
//
// ── 三份清单都不手写 ─────────────────────────────────────────────────────────────────────────────
// · 有哪些块    → `block-catalog.js` §blockShapeCatalog（从注册表派生；图册、几何守卫共用这一份）。
//                 注册表里有而没有 manifest 的块，它当场抛并点名 —— 不回一份残缺的清单。
// · 有哪些字段  → `block-manifest.js` §editableSlotPaths（#1352，检查器面板和 `data-slot` 守卫也用它）。
// · 形态下拉    → catalog 的 `pairs`（出处是形态**子目录**），去掉 `candidate === true`。
//                 🔴 不是 manifest 里的 `variants` —— 那是 #1008 之前的旧画法名单，照它生成会接上
//                    一份废弃数据而不报错（hero 那份 9 条，跟 7 个形态目录 0 撞名）。
//                 🔴 候选必须去掉：构建遇到候选静默落回默认（`block-shape.js` §shapeForBlock），
//                    列出来就是「选了、保存成功、页面却是另一个形态」（#1350 r6）。
//
// ── 槽位怎么变成字段：`kind` 决定控件 ────────────────────────────────────────────────────────────
//   editLabel 是字符串  kind text/link…        → 一个 text 字段（`control: 'text'`）
//                       kind list（`[string]`） → array，每项一个内部子字段 `value`（`control: 'strings'`）
//   editLabel 是对象    kind list              → array，子字段 = 那几个 `sub`（`control: 'list'`）
//                       kind link / object     → object，子字段 = 那几个 `sub`（`control: 'object'`）；
//                                                link 再多一个 `href`（显示名 Link，#1404 r3，理由在 §fieldsOf）
// 🔴 「带 `sub`」≠「列表」：`link`（`{label, href}`）和 `object`（`hero-with-form.form`）也带 `sub`。
//    把它们做成 array 字段，Puck 会把一个对象当数组编辑，存回去就坏了。
//
// 没有 `editLabel` 的槽位（图片、`NON_EDITABLE_TEXT_SLOTS`、`flag` …）**不出字段** —— 它们的值由
// 转换器原样携带（`editor-convert.js`），画布照样渲染。图片槽因此在面板里不出现（票正文「换图不做」）。

const path = require('path');
const { blockShapeCatalog } = require('./block-catalog');
const { editableSlotPaths, defaultShapeOf } = require('./block-manifest');
const { knobsOf, presetsOf, booleanOptionsOf } = require('./block-knobs');
const { shapeForBlock } = require('./block-shape');
const siteRegions = require('./site-regions');
const pageLayoutLib = require('./page-layout');
const { ROOT_FIELDS } = require('./editor-root-fields');
const { shapesFor } = require('../themes');

/** `kind: link` 的字段在 manifest 的 `editLabel` 之外多出来的那一个子字段（#1404 r3）。 */
const LINK_HREF = 'href';

/**
 * 一份 manifest → 字段清单（顺序照 manifest 里槽位的书写顺序）。
 *
 * #1463 —— 除了带 `editLabel` 的槽位，还有两种槽位出字段：
 *   · `kind: color`                    → 色板 + 取色器（`control: 'color'`），色板取 manifest 的 `swatches`
 *   · 声明了 `knobs` 的 `options` 槽   → 「预设 + 旋钮 + Custom」（`control: 'options'`）：第一格是预设一排
 *                                        （点一个就把旋钮一次设好），下面每个旋钮一个单选，再下面是
 *                                        `options.shape` 那串里的布尔修饰（`reverse`）。是不是 custom 由
 *                                        `block-knobs.js` §presetNameFor 判，Section 用同一个函数。
 * 对象槽的子字段在 manifest 的 `choices` 里有词表的（`eyebrow.style`），那一格是下拉（`choices`）。
 * 🔴 字段顺序就是 manifest 槽位的书写顺序 —— hero-new 的槽位按「排布 → 修饰 → 部件 → 细节 → 内容」写，
 *    Puck 侧栏的顺序（AC8）靠的就是这一条，不在这里另排一遍。
 */
function fieldsOf(manifest) {
  const bySlot = new Map();
  for (const e of editableSlotPaths(manifest)) {
    if (!bySlot.has(e.slot)) bySlot.set(e.slot, []);
    bySlot.get(e.slot).push(e);
  }
  const fields = [];
  for (const [slot, spec] of Object.entries((manifest && manifest.slots) || {})) {
    if (spec && spec.kind === 'color') {
      fields.push({ slot, kind: 'color', label: humanize(slot === 'bg' ? 'background' : slot), control: 'color', subs: [],
        swatches: Array.isArray(spec.swatches) ? spec.swatches.slice() : [] });
      continue;
    }
    if (spec && knobsOf({ slots: { [slot]: spec } }).length && slot === 'options') {
      fields.push({
        slot,
        kind: spec.kind,
        label: 'Layout options',
        control: 'options',
        subs: [],
        knobs: knobsOf(manifest).map((k) => ({ name: k.name, values: k.values.slice() })),
        booleans: booleanOptionsOf(manifest),
        presets: presetsOf(manifest).map((p) => ({ name: p.name, shape: p.shape, knobs: { ...p.knobs } })),
      });
      continue;
    }
    const entries = bySlot.get(slot);
    if (!entries && spec && spec.editItems === true) {
      // 没有可改的字，只有「几项、什么顺序」可改（`hero-new.band`）。每项的摘要用它的 alt。
      fields.push({ slot, kind: spec.kind, label: humanize(slot), control: 'list', subs: [], summary: ['alt'] });
      continue;
    }
    if (!entries) continue;
    const kind = entries[0].kind;
    if (entries.length === 1 && entries[0].sub === null) {
      fields.push({ slot, kind, label: entries[0].label, control: kind === 'list' ? 'strings' : 'text', subs: [] });
      continue;
    }
    const choices = (spec && spec.choices) || {};
    const subs = entries.map((e) => ({ sub: e.sub, label: e.label }));
    // #1463 —— `choices` 里有、又不是 editLabel 的子字段（`eyebrow.style`）：一格下拉。取值是数组的
    //    （`form.fields`）不出字段 —— 一个多选框不是这张票的活，它由转换器原样携带。
    for (const [sub, vals] of Object.entries(choices)) {
      if (subs.some((x) => x.sub === sub)) continue;
      const shape = typeof spec.shape === 'string' ? spec.shape : '';
      if (new RegExp(`${sub}\\s*:\\s*\\[`).test(shape)) continue;
      subs.push({ sub, label: humanize(sub), choices: vals.slice() });
    }
    // #1404 r3 —— `kind: link` 再补一个 `href`（显示名 Link）。按钮链接不是一段看得见的字，所以它不在
    // `editableSlotPaths()` 里（那个函数说的是「带 `data-slot` 的字」，检查器面板和 `data-slot` 守卫也吃它，
    // 往 `editLabel` 里加 `href` 就得给守卫开豁免）。而编辑器开放了插入：新插的 hero 不填链接，按钮就是
    // `href="#"`，访客点了没反应 —— 所以这里只在编辑器自己的 schema 里补，按 kind 派生、不写块名单。
    if (kind === 'link' && !subs.some((x) => x.sub === LINK_HREF)) subs.push({ sub: LINK_HREF, label: 'Link' });
    fields.push({
      slot,
      kind,
      // 一个带子字段的槽位没有自己的 editLabel；显示名用 manifest 的槽位名（Puck 会在它下面列子字段）。
      label: humanize(slot),
      control: kind === 'list' ? 'list' : 'object',
      subs,
    });
  }
  return fields;
}

function humanize(name) {
  const s = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir]       模板根（`site/` 的上一层）；只用来读这个站穿哪套主题
 * @param {string} [opts.registryPath]  透传给 blockShapeCatalog（守卫用它换一份假注册表）
 * @param {string} [opts.blocksDir]     透传给 blockShapeCatalog
 * @param {string} [opts.layoutsDir]    `page-layouts/`（#1405 的 root 字段用）；不给按 page-layout.js 的默认
 * @returns {{ components: Array<{ type, label, fields, carried, shapes, defaultShape, themeShape, fallbackShape }> }}
 *   · `carried`       没有字段、由转换器原样携带的槽位名（守卫拿它证明「每个槽位都有归属」）
 *   · `shapes`        下拉选项 `[{ name, needs }]`，已去掉候选，顺序照形态清单
 *   · `defaultShape`  按**空 data** 跑一次构建同一个函数（§shapeForBlock）得到的形态（主题选择单给的，缺槽位就
 *                     落回 manifest 默认）。#1445：今天唯一的消费者是 `editor-convert.js` §pageToPuck 的 `shape0`
 *                     兜底（归一化后的块没带 `shape` 时，共用块 / 锁住的块只读下拉显示它）。🔴 它**不是**新插块
 *                     画布上戴的形态 —— #1443 起新块的 `_shape` 是 `THEME_DEFAULT`、画布走 §canvasShape 按当前 data 现算。
 *   · `themeShape`    #1443：主题选择单给这种块的那一格（没给 = null），**没按 data 判过**
 *   · `fallbackShape` #1443：manifest 默认（§shapeForBlock 的落点）
 */
function editorSchema(opts = {}) {
  const catalog = blockShapeCatalog({ registryPath: opts.registryPath, blocksDir: opts.blocksDir });
  let selection = {};
  if (opts.rootDir) {
    const { structureThemeId } = siteRegions.resolveSiteRegionLayout(path.join(opts.rootDir, 'site'));
    if (structureThemeId) selection = shapesFor(structureThemeId);
  }
  const manifestsObj = Object.fromEntries(catalog.manifests);
  const components = [];
  for (const type of catalog.blocks) {
    const m = catalog.manifests.get(type);
    // 外壳区（header / footer）不进页面 JSON，归 #1405。判据用 manifest 自己声明的 `region: true`。
    if (!m || m.region === true) continue;
    const fields = fieldsOf(m);
    const fieldSlots = new Set(fields.map((f) => f.slot));
    const shapes = catalog.pairs
      .filter((p) => p.block === type && p.candidate !== true)
      .map((p) => ({ name: p.shape, needs: p.needs }));
    components.push({
      type,
      label: typeof m.displayName === 'string' && m.displayName ? m.displayName : type,
      fields,
      carried: Object.keys(m.slots || {}).filter((s) => !fieldSlots.has(s)),
      shapes,
      defaultShape: shapeForBlock({ type, data: {} }, selection, manifestsObj, () => {}) || null,
      // #1443 —— 画布上「跟着主题走」的块戴哪个形态，要拿这个块**当前的** data 现算（`editor-convert.js`
      // §canvasShape）：`defaultShape` 是按空 data 塌缩过的，needs 门控的形态（hero 的 media-*、
      // content-split 的四个）在它里面已经落回了默认。所以把塌缩之前的两格原料也交出去。
      themeShape: typeof selection[type] === 'string' && selection[type] ? selection[type] : null,
      fallbackShape: defaultShapeOf(m) || null,
    });
  }
  return { components, root: rootSchema(catalog, opts) };
}

/**
 * #1405 —— 外壳四样（布局 / 顶栏形态 / 页脚形态 / 公告条文字）在 Puck 里是 **root 字段**，这里给出
 * 它们的可选值。跟块一样不手写：
 *   · 顶栏 / 页脚形态 → catalog 的 `pairs`（出处是 `blocks/header/*` 与 `blocks/footer/*` 两个子目录），
 *     去掉候选（候选构建静默落回，列出来就是「选了、存了、页面没变」，同上面块的形态下拉）。
 *   · 布局 → `page-layouts/` 库（`lib/page-layout.js` §loadLayouts）。每一份带上它的区与 `repeatVariants`，
 *     画布照它排区；`pinsFooter` 由 §layoutPinsFooter 算（布局自己钉了页脚形态 ⟹ 页脚下拉灰掉）。
 * 🔴 **没有「哪些组合构建不收」**（带 topbar 区 + 透明浮层 / 缺某种语言的 topbar 文字）：那条规则只住在
 *    站里的写盘脚本（`scripts/write-editor-save.js`，用构建同一个 `needsTopbar` 判），编辑器不抄第二份
 *    （票正文做什么 6）。
 * 🔴 `layoutsDir` 要显式传：被打进 Next 服务端包之后 `__dirname` 是产物目录（同 `blocksDir` 那条）。
 */
function rootSchema(catalog, opts) {
  const pickable = (block) => catalog.pairs
    .filter((p) => p.block === block && p.candidate !== true)
    .map((p) => p.shape);
  const layouts = [...pageLayoutLib.loadLayouts(opts.layoutsDir).values()].map((l) => ({
    id: l.id,
    regions: Array.isArray(l.regions) ? l.regions.slice() : [],
    repeatVariants: l.repeatVariants ? { ...l.repeatVariants } : {},
    pinsFooter: pageLayoutLib.layoutPinsFooter(l),
  }));
  // `fields`：Puck root 上有哪几个字段、各是整站一份还是按语言一份 —— 照分派表（`editor-root-fields.js`）给，
  // 编辑器存盘时逐个比的就是这几个（`editor-convert.js` §puckRootChanges）。
  return {
    fields: ROOT_FIELDS.map((f) => ({ field: f.field, scope: f.scope })),
    layouts,
    header: pickable('header'),
    footer: pickable('footer'),
  };
}

/**
 * 每份非 region manifest 的每个槽位，在编辑器 schema 里都有归属吗（字段 / 原样携带，二者恰居其一）。
 *
 * 🔴 这是槽位这一层的「清单不许手写」：schema 从 manifest 派生时它恒为空；有人把字段清单写死、
 *    或者拿一份旧 schema 去配新 manifest（「manifest 加了一个槽位而转换器没跟上」），它点名
 *    `块.槽位`。回字符串数组，空 = 对得上。
 */
function slotCoverageProblems(schema, manifests) {
  const byType = new Map(schema.components.map((c) => [c.type, c]));
  const out = [];
  for (const [type, m] of manifests) {
    if (!m || m.region === true) continue;
    const c = byType.get(type);
    if (!c) { out.push(`${type}（整个块不在编辑器里）`); continue; }
    const owned = new Map();
    for (const f of c.fields) owned.set(f.slot, (owned.get(f.slot) || 0) + 1);
    for (const s of c.carried) owned.set(s, (owned.get(s) || 0) + 1);
    for (const slot of Object.keys(m.slots || {})) {
      const n = owned.get(slot) || 0;
      if (n !== 1) out.push(`${type}.${slot}${n === 0 ? '（没有归属）' : '（既是字段又被携带）'}`);
      owned.delete(slot);
    }
    for (const slot of owned.keys()) out.push(`${type}.${slot}（manifest 里没有这个槽位）`);
  }
  return out;
}

module.exports = { editorSchema, fieldsOf, slotCoverageProblems, LINK_HREF };
