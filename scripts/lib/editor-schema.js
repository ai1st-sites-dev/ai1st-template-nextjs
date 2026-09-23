'use strict';

// editor-schema.js —— 编辑器页（#1404）在构建时从**这个站自己的**区块库算出「Puck 里有哪些组件、每个
// 组件有哪些字段、形态下拉列哪几项」。算出来的是一份纯数据（能跨 server → client 边界），Puck 的
// config 由 `src/components/editor/EditorApp.tsx` 照它拼 —— render 函数只能在客户端那一侧。
//
// ── 为什么在构建时算、从站自己的仓读 ─────────────────────────────────────────────────────────────
// manifest 住在每个站自己的仓里，版本是它建站（或最后一次「更新网站」）那天的。拿一份今天的副本对
// 老站会「保存成功、页面一个字不变」（`manager/block_panel.go` 那条规矩）。编辑器页是在站自己的
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
const { editableSlotPaths } = require('./block-manifest');
const { shapeForBlock } = require('./block-shape');
const siteRegions = require('./site-regions');
const { shapesFor } = require('../themes');

/** `kind: link` 的字段在 manifest 的 `editLabel` 之外多出来的那一个子字段（#1404 r3）。 */
const LINK_HREF = 'href';

/** 一份 manifest → 字段清单（顺序照 manifest 里槽位的书写顺序）。 */
function fieldsOf(manifest) {
  const bySlot = new Map();
  for (const e of editableSlotPaths(manifest)) {
    if (!bySlot.has(e.slot)) bySlot.set(e.slot, []);
    bySlot.get(e.slot).push(e);
  }
  const fields = [];
  for (const [slot, entries] of bySlot) {
    const kind = entries[0].kind;
    if (entries.length === 1 && entries[0].sub === null) {
      fields.push({ slot, kind, label: entries[0].label, control: kind === 'list' ? 'strings' : 'text', subs: [] });
      continue;
    }
    const subs = entries.map((e) => ({ sub: e.sub, label: e.label }));
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
 * @returns {{ components: Array<{ type, label, fields, carried, shapes, defaultShape }> }}
 *   · `carried`       没有字段、由转换器原样携带的槽位名（守卫拿它证明「每个槽位都有归属」）
 *   · `shapes`        下拉选项 `[{ name, needs }]`，已去掉候选，顺序照形态清单
 *   · `defaultShape`  新插进来的这种块画布上戴哪个形态 —— 跟构建同一个函数（§shapeForBlock）对一份
 *                     空 data 算，也就是「主题选择单给的，缺槽位就落回 manifest 默认」。
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
    });
  }
  return { components };
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
