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
// · 形态下拉    → catalog 的 `pairs`（出处是形态**子目录**）。
//                 🔴 不是 manifest 里的 `variants` —— 那是 #1008 之前的旧画法名单，照它生成会接上
//                    一份废弃数据而不报错（hero 那份 9 条，跟 7 个形态目录 0 撞名）。
//
// ── 槽位怎么变成字段：`kind` 决定控件 ────────────────────────────────────────────────────────────
//   editLabel 是字符串  kind text/link…        → 一个 text 字段（`control: 'text'`）
//                       kind richtext            → 一个多行文本框 + 写法提示（`control: 'richtext'`，#1498）
//                       kind list（`[string]`） → array，每项一个内部子字段 `value`（`control: 'strings'`）
//   声明了 intRange     kind text              → 一格下拉，取值 = 范围里的每个整数（`control: 'int'`，#1497）
//   editLabel 是对象    kind list              → array，子字段 = 那几个 `sub`（`control: 'list'`）
//                       kind link / object     → object，子字段 = 那几个 `sub`（`control: 'object'`）；
//                                                link 再多一个 `href`（显示名 Link，#1404 r3，理由在 §fieldsOf）
//                       kind list 且项形状顶层必有 `href`（按钮列表 `[{label, href, …}]`）→ 每项也多一个 `href`（#1518，§itemTopKeys），
//                                                它跟 link 那格一样带 `sources`（本店电话 / 邮箱，#1521）
//                       kind list 且某条 editLabel 在项形状里是 `[string]`（`features` / `bullets`）→ 那一格是一列字（`strings: true`，#1686）
//                       kind list 且 editLabel 带点（`cta.label` / `link.label` / `price.monthly`）→ 合成项里那个对象的一格（`nested`）；对象是按钮
//                                                （`{label, href, …}`）时再补 Link，带 `sources`（#1686，§itemSubs）
//                       kind list 且项形状顶层有可选 `href?`（点评平台 / logo）→ 每项多一格 Link，不带 `sources`（#1686，§addOptionalHref）
//   一张图（#1693）      形状是 `{imageUrl, alt}` 的对象槽 → 一格图片（`control: 'image'`）：缩略图 + Change + 图片说明（alt），
//                        可选的（`required: false`）再给 Remove；列表项里值是 `{imageUrl, alt}` 的那个键 → 同样一格（`image: true`，
//                        可选 = 项形状里那个键带 `?`）。判据是形状（§isOneImage），不写块名单；成排的图（`[{imageUrl, alt}]`）不在射程（T9）。
// 列表项里**不给格子**的字段逐条登记在 §ITEM_FIELD_EXEMPT（带理由），§itemFieldCoverageProblems 守「每个字段要么有格子、要么在名单里」。
// 🔴 「带 `sub`」≠「列表」：`link`（`{label, href}`）和 `object`（`hero-with-form.form`）也带 `sub`。
//    把它们做成 array 字段，Puck 会把一个对象当数组编辑，存回去就坏了。
//
// 没有 `editLabel` 的槽位（成排的图、`NON_EDITABLE_TEXT_SLOTS`、`flag` …）**不出字段** —— 它们的值由
// 转换器原样携带（`editor-convert.js`），画布照样渲染。
// 📌 #1693 之前图片槽一律在这一类里（#1404 票正文「换图不做」）；「一个位置一张」的图现在标了 `editLabel`，出一格图片。

const path = require('path');
const { blockShapeCatalog } = require('./block-catalog');
const { editableSlotPaths, defaultShapeOf } = require('./block-manifest');
const { knobsOf, knobDefault, choiceDefault, presetsOf, booleanOptionsOf, presetColorSlotsOf, presetPartDemosOf } = require('./block-knobs');
const { shapeForBlock } = require('./block-shape');
const siteRegions = require('./site-regions');
const pageLayoutLib = require('./page-layout');
const { ROOT_FIELDS } = require('./editor-root-fields');
const { shapesFor } = require('../themes');
const { GRADIENT_SWATCHES } = require('./contrast');
const { BUTTON_SOURCES } = require('./item-sources');

/** `kind: link` 的字段在 manifest 的 `editLabel` 之外多出来的那一个子字段（#1404 r3）。 */
const LINK_HREF = 'href';

/** #1693 —— 「一个位置一张图」的形状：对象槽的 `shape`、或列表项里某个键的值写法恰好是 `{imageUrl, alt}`。 */
const ONE_IMAGE_SHAPE = /^\{\s*imageUrl\s*,\s*alt\s*\}$/;
function isOneImage(shape) {
  return typeof shape === 'string' && ONE_IMAGE_SHAPE.test(shape.trim());
}

/**
 * #1693 —— §editableSlotPaths 的一条是不是一张图：顶层 = 对象槽、形状 `{imageUrl, alt}`；列表项 = 项形状里那个键的值是 `{imageUrl, alt}`。
 * 是 ⟹ `{ optional }`（顶层看 `required === false`，列表项看键带不带 `?` —— PM 2026-10-10 裁定）；不是 ⟹ null。
 */
function imageCellOf(spec, sub) {
  if (!spec) return null;
  if (sub === null || sub === undefined) {
    return spec.kind === 'object' && isOneImage(spec.shape) ? { optional: spec.required === false } : null;
  }
  if (spec.kind !== 'list') return null;
  const e = itemShapeEntries(spec.shape).find((x) => x.key === sub);
  return e && isOneImage(e.value) ? { optional: e.optional } : null;
}

/**
 * 一份 manifest → 字段清单（顺序照 manifest 里槽位的书写顺序）。
 *
 * #1463 —— 除了带 `editLabel` 的槽位，还有两种槽位出字段：
 *   · `kind: color`                    → 色板 + 取色器（`control: 'color'`），色板取 manifest 的 `swatches`；
 *                                        #1477 起另带三档预设渐变（`gradients`），值可以是渐变 `{stops, angle}`
 *   · 声明了 `knobs` 的 `options` 槽   → 「预设 + 旋钮 + Custom」（`control: 'options'`）：第一格是预设一排
 *                                        （点一个就把旋钮一次设好），下面每个旋钮一个单选，再下面是
 *                                        `options.shape` 那串里的布尔修饰（`reverse`）。是不是 custom 由
 *                                        `block-knobs.js` §presetNameFor 判，Section 用同一个函数。
 * 对象槽的子字段在 manifest 的 `choices` 里有词表的（`eyebrow.style`），那一格是下拉（`choices`）。
 * 🔴 字段顺序就是 manifest 槽位的书写顺序 —— hero 的槽位按「排布 → 修饰 → 部件 → 细节 → 内容」写，
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
      // #1477 —— 三档预设渐变跟着纯色色板一起带下去（`contrast.js` §GRADIENT_SWATCHES，副本）。
      fields.push({ slot, kind: 'color', label: humanize(slot === 'bg' ? 'background' : slot), control: 'color', subs: [],
        swatches: Array.isArray(spec.swatches) ? spec.swatches.slice() : [],
        gradients: GRADIENT_SWATCHES.map((g) => ({ stops: g.stops.slice(), angle: g.angle })) });
      continue;
    }
    if (spec && knobsOf({ slots: { [slot]: spec } }).length && slot === 'options') {
      fields.push({
        slot,
        kind: spec.kind,
        label: 'Layout options',
        control: 'options',
        subs: [],
        // #1481 —— 带上 `default`：顺序只管展示，没写值时侧栏亮哪一格看它（block-knobs.js §knobDefault）。
        knobs: knobsOf(manifest).map((k) => ({ name: k.name, values: k.values.slice(), default: knobDefault(k) })),
        booleans: booleanOptionsOf(manifest),
        // #1483 —— 预设带的颜色（Rainbow）+ 归预设管的颜色槽：点预设时编辑器按 block-knobs.js §presetColors 同一条规则
        //    设上 / 恢复这几个颜色字段。没有带颜色预设的块 `colorSlots` 是 []，侧栏的行为一字不变。
        // #1487 —— 预设带的部件（team 的 Hiring）+ 那些部件的占位内容：点预设时部件为空就拿 `partDemos` 填上
        //    （block-knobs.js §presetClickProps）。没有带部件预设的块 `partDemos` 是 {}。
        presets: presetsOf(manifest).map((p) => ({ name: p.name, shape: p.shape, knobs: { ...p.knobs },
          ...(p.colors ? { colors: JSON.parse(JSON.stringify(p.colors)) } : {}),
          ...(Array.isArray(p.parts) ? { parts: p.parts.slice() } : {}) })),
        colorSlots: presetColorSlotsOf(manifest),
        partDemos: presetPartDemosOf(manifest),
      });
      continue;
    }
    // #1471 —— 选站级表单的槽（`form: { id? }`，hero / footer / contact / cta）：一个对象字段、子字段只有 `id`，
    //    EditorApp 把它画成下拉（选项 = 这个语言的表单库，`site-forms.js` §formIdOptions）。按形状认，不写块名单；
    //    旧块 `hero-with-form` 的 `form` 是另一个形状（自带字段 / 按钮文字），走下面原来那条路。
    if (slot === 'form' && spec && spec.kind === 'object' && /^\{\s*id\?\s*\}$/.test(String(spec.shape || ''))) {
      fields.push({ slot, kind: 'object', label: 'Form', control: 'object', subs: [{ sub: 'id', label: 'Form' }] });
      continue;
    }
    // #1497 —— 一个整数设置（`blog.postCount` 2–6，manifest `intRange`）：一格下拉，取值从范围现算。
    //    它不在 editableSlotPaths 里（不是页面上的字、没有 data-slot），所以在这里单出。
    if (spec && Array.isArray(spec.intRange) && typeof spec.editLabel === 'string') {
      const [lo, hi] = spec.intRange;
      fields.push({ slot, kind: spec.kind, label: spec.editLabel, control: 'int', subs: [],
        values: Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i)) });
      continue;
    }
    const entries = bySlot.get(slot);
    if (!entries && spec && spec.editItems === true) {
      // 没有可改的字，只有「几项、什么顺序」可改（`hero.band`）。每项的摘要用它的 alt。
      // #1686 —— 项上有可选链接（`logos.items` 的 `href?`）照样给一格，见下面 §addOptionalHref。
      const subs = [];
      addOptionalHref(subs, spec);
      fields.push({ slot, kind: spec.kind, label: humanize(slot), control: 'list', subs, summary: ['alt'] });
      continue;
    }
    if (!entries) continue;
    const kind = entries[0].kind;
    const img = entries.length === 1 && entries[0].sub === null ? imageCellOf(spec, null) : null;
    if (img) {
      // #1693 —— 一张图：缩略图 + Change + 图片说明（alt），可选的再给 Remove。值整份对象进出（editor-convert §toProp 的 `image`）。
      fields.push({ slot, kind, label: entries[0].label, control: 'image', subs: [], optional: img.optional });
      continue;
    }
    if (entries.length === 1 && entries[0].sub === null) {
      // #1498 —— `richtext`（content.body）是一段带段落 / 列表的正文：多行文本框，不是单行 text。
      fields.push({ slot, kind, label: entries[0].label, control: kind === 'list' ? 'strings' : kind === 'richtext' ? 'richtext' : 'text', subs: [] });
      continue;
    }
    const choices = (spec && spec.choices) || {};
    const subs = kind === 'list' ? itemSubs(entries, spec) : entries.map((e) => ({ sub: e.sub, label: e.label }));
    // #1463 —— `choices` 里有、又不是 editLabel 的子字段（`eyebrow.style`）：一格下拉。取值是数组的
    //    （`form.fields`）不出字段 —— 一个多选框不是这张票的活，它由转换器原样携带。
    for (const [sub, vals] of Object.entries(choices)) {
      if (subs.some((x) => x.sub === sub)) continue;
      const shape = typeof spec.shape === 'string' ? spec.shape : '';
      if (new RegExp(`${sub}\\s*:\\s*\\[`).test(shape)) continue;
      subs.push({ sub, label: humanize(sub), choices: vals.slice(), choiceDefault: choiceDefault(spec, sub) });
    }
    // #1404 r3 —— `kind: link` 再补一个 `href`（显示名 Link）。按钮链接不是一段看得见的字，所以它不在
    // `editableSlotPaths()` 里（那个函数说的是「带 `data-slot` 的字」，检查器面板和 `data-slot` 守卫也吃它，
    // 往 `editLabel` 里加 `href` 就得给守卫开豁免）。而编辑器开放了插入：新插的 hero 不填链接，按钮就是
    // `href="#"`，访客点了没反应 —— 所以这里只在编辑器自己的 schema 里补，按 kind 派生、不写块名单。
    if (kind === 'link' && !subs.some((x) => x.sub === LINK_HREF)) subs.push({ sub: LINK_HREF, label: 'Link' });
    // #1506 —— 这一格 Link 除了手填地址，还能选「Business phone」「Business email」（写成 `{source: "phone"}` 引用，
    //    构建时从 brand.json 展开，`scripts/lib/item-sources.js`）。按 kind 派生、不写块名单；EditorApp 据 `sources` 画控件。
    //    按钮列表（`ctas` / `introCtas`）每一项的 Link 格也有这份选项，在下面 `kind === 'list'` 那段（#1518 补格、#1521 补选项）。
    if (kind === 'link') for (const x of subs) if (x.sub === LINK_HREF) x.sources = BUTTON_SOURCES.slice();
    // #1489 —— 列表槽**每一项**的词表（`itemChoices`，`contact.items[].kind`）也是一格下拉；`itemNeeds` 里点名
    //    的必填子字段（`kind=link` ⟹ `href`）补一格文字。少了它们，在编辑器里新加的一条没有 kind，组件整条不画。
    if (kind === 'list') {
      for (const [sub, vals] of Object.entries((spec && spec.itemChoices) || {})) {
        if (!subs.some((x) => x.sub === sub)) subs.push({ sub, label: humanize(sub), choices: vals.slice() });
      }
      for (const need of Object.values((spec && spec.itemNeeds) || {}).flat()) {
        if (!subs.some((x) => x.sub === need)) subs.push({ sub: need, label: need === LINK_HREF ? 'Link' : humanize(need) });
      }
      // #1518 —— 项形状里【必有】`href` 的列表槽（按钮列表 `ctas` / `introCtas`：`[{label, href, style, …}]`）每一项也补一格 Link，
      //    理由同上面 `kind: link` 那条（#1404 r3）：编辑器能新加一项，不给这一格，新按钮就是 `href="#"`。
      //    按形状派生、不写块名单；只认项的顶层键、只认必填（`href?` 那种可选链接不在本条射程）。
      // #1521 —— 这一格也能选「Business phone」「Business email」，跟上面 `kind: link` 那格同一份 `BUTTON_SOURCES`：
      //    构建侧把任何「有 `label` 又有 `href`」的对象当按钮展开（`item-sources.js` §resolveButtons），这几项正是这个形状。
      //    🔴 `itemNeeds` 补出来的 Link（`contact.items`，项是 `{kind, title, hint?, href?}`、没有 `label`）不给：
      //       它不是按钮，引用不会被展开，写进去那一行就不画了；电话 / 邮箱它另有 `kind=phone` / `kind=email` 两种项。
      if (itemTopKeys(spec && spec.shape).includes(LINK_HREF) && !subs.some((x) => x.sub === LINK_HREF)) {
        subs.push({ sub: LINK_HREF, label: 'Link', sources: BUTTON_SOURCES.slice() });
      }
      addOptionalHref(subs, spec);
    }
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

/**
 * #1686 —— 列表槽 `editLabel` 的几条 → 每项的子字段。普通的一条就是一格文字；另外两种按**项形状**认（不写块名单）：
 *   · 值是字符串列表（`features: [string]`）⟹ `strings: true`，EditorApp 画成能加 / 删 / 拖动排序的一列（值仍是字符串数组）；
 *   · 带点的（`cta.label` / `link.label` / `price.monthly`：项里一个对象的某个键）⟹ 按点前那一段合成一格 `nested`。
 *     #1692 —— 价格块套餐的 `price`（Price / Yearly price）原来是 #1670 在这里之外单补的两格，不在 editableSlotPaths 里，
 *     画布点不着、守卫也看不见；现在写进 manifest 的 editLabel，跟 `cta.label` 同一条路。
 *     那个对象在形状里是按钮（`{label, href, …}`，`href` 必有）⟹ 再补一格 Link，带 `sources`（本店电话 / 邮箱，同 #1521 的
 *     按钮列表那一格）：构建侧 `item-sources.js` §resolveButtons 一路往下找「有 label 又有 href」的对象展开，项里的按钮在射程里。
 * 🔴 带点的那几条必须真是项形状里某个对象的键：画布上那段字的 `data-slot`（`plans.0.cta.label`）跟它一模一样，
 *    `block-slots.test.js` 两个方向守着。
 */
function itemSubs(entries, spec) {
  const shape = new Map(itemShapeEntries(spec && spec.shape).map((e) => [e.key, e]));
  const subs = [];
  for (const e of entries) {
    const dot = e.sub.indexOf('.');
    if (dot < 0) {
      const se = shape.get(e.sub);
      // #1693 —— 项里的一张图（`image?: {imageUrl, alt}` / `photo?`）：一格图片，可选的带 Remove。
      if (se && isOneImage(se.value)) { subs.push({ sub: e.sub, label: e.label, image: true, optional: se.optional }); continue; }
      subs.push(se && /^\[\s*string\s*\]$/.test(se.value) ? { sub: e.sub, label: e.label, strings: true } : { sub: e.sub, label: e.label });
      continue;
    }
    const head = e.sub.slice(0, dot);
    const part = { sub: e.sub.slice(dot + 1), label: e.label };
    const group = subs.find((x) => x.sub === head && x.nested);
    if (group) { group.nested.push(part); continue; }
    subs.push({ sub: head, label: humanize(head), nested: [part] });
  }
  for (const g of subs) {
    if (!g.nested) continue;
    const se = shape.get(g.sub);
    const inner = se && /^\{([\s\S]*)\}$/.exec(se.value) ? objectEntries(se.value.slice(1, -1)) : [];
    const required = (k) => inner.some((x) => x.key === k && !x.optional);
    if (required('label') && required(LINK_HREF) && !g.nested.some((x) => x.sub === LINK_HREF)) {
      g.nested.push({ sub: LINK_HREF, label: 'Link', sources: BUTTON_SOURCES.slice() });
    }
  }
  return subs;
}

/**
 * #1686 —— 项形状里有**可选**的 `href?`（点评平台 / logo 点出去的链接：`reviews.platforms`、`testimonials.summary`、`logos.items`）
 * ⟹ 每项补一格 Link。🔴 不带 `sources`：这几项不是按钮（没有 `label`），指向的是点评站或别人的网站；`item-sources.js` 也只
 * 展开「有 label 又有 href」的对象，写一个电话引用进去这一项就坏了。必有的 `href`（按钮列表）在上面 #1518 那条。
 */
function addOptionalHref(subs, spec) {
  const e = itemShapeEntries(spec && spec.shape).find((x) => x.key === LINK_HREF);
  if (!e || !e.optional || subs.some((x) => x.sub === LINK_HREF)) return;
  insertByShape(subs, { sub: LINK_HREF, label: 'Link' }, spec);
}

/** 照项形状里的键序把一个子字段插进去（插在形状里排它后面的第一格之前；都没有就放最后）。 */
function insertByShape(subs, item, spec) {
  const keys = itemShapeEntries(spec && spec.shape).map((e) => e.key);
  const at = subs.findIndex((x) => keys.indexOf(x.sub) > keys.indexOf(item.sub));
  subs.splice(at < 0 ? subs.length : at, 0, item);
}

/**
 * 列表槽项形状（`[{label, href, style: "solid" | "outline", icon?, …}]`）的**顶层**必填键名。
 * 嵌套的 `{…}` / `[…]` 和引号里的东西不算；带 `?` 的（可选）不算。形状不是**一个** `[{…}]` ⟹ []
 * （两项示例 `[{…}, {…}]` 不是项形状，不认 —— 当初的例子是 page-header 的 breadcrumbs 槽，#1630 随面包屑删了）。
 */
function itemTopKeys(shape) {
  return itemShapeEntries(shape).filter((e) => !e.optional).map((e) => e.key);
}

/**
 * #1686 —— 列表槽项形状的**全部**顶层键（含带 `?` 的可选键），每个带上它的值写法：
 * `[{name, features: [string], cta: {label, href, style?}, badge?}]` →
 * `[{key:'name', optional:false, value:''}, {key:'features', …, value:'[string]'}, {key:'cta', …, value:'{label, href, style?}'}, {key:'badge', optional:true, value:''}]`。
 * 引号里的东西不算；形状不是**一个** `[{…}]` ⟹ []（同 §itemTopKeys）。
 */
function itemShapeEntries(shape) {
  const m = /^\s*\[\s*\{([\s\S]*)\}\s*\]\s*$/.exec(typeof shape === 'string' ? shape : '');
  return m ? objectEntries(m[1]) : [];
}

/** 一个对象形状的花括号**里面**（`label, href, style?: "solid"`）→ 顶层键。§itemShapeEntries 和项里的对象（`cta`）共用。 */
function objectEntries(body) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of body + ',') {
    if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { if (--depth < 0) return []; }
    else if (ch === ',' && depth === 0) {
      const k = /^\s*(\w+)(\??)\s*(?::\s*([\s\S]*))?$/.exec(cur);
      if (k) out.push({ key: k[1], optional: !!k[2], value: (k[3] || '').trim() });
      cur = '';
      continue;
    }
    cur += ch;
  }
  return out;
}

// ── #1657 —— 画布里点字直接改：哪几段字能就地打字、哪几段出 AI 按钮 ─────────────────────────────────────────
//
// 全集就是 §editableSlotPaths（检查器面板和 `data-slot` 守卫用的那一把尺）。每一条再问两件事：
//   · `typing`：能不能在画布上直接打字。只有 `richtext`（content.body，我们自己的 markdown）不能 —— 就地编辑是纯文本，
//                点进去会露出 markdown 原文，打歪一个字符就能把链接写坏；它只出 AI 按钮，打字仍去右栏。
//   · `ai`：出不出 AI 按钮。数字 / 价格 / 事实这一类不出（AI 不该编数字），见 §isFactSlot。
//   · `image`（#1693）：这一格是一张图（§imageCellOf）⟹ 不打字、不出 AI 按钮，点它 = 面板上点 Change（选图）。
// 🔴 按字段性质判，不按块名写名单（PM 裁定，#643 的老规矩）：今天命中的 6 个只是读数。
//
// 「数字 / 价格 / 事实」的判据（任一条）：
//   ① manifest 给这个子字段声明了数值范围（`slots.<槽>.ranges.<子字段>`，#1488）—— 评分、评价条数；
//   ② 它的显示名（`editLabel`）说的就是一个数：Number / Price / Rating（整词，大小写不论）。
//      「Number of reviews」「Yearly price」也算；「What it counts」「Yearly label」不算。
function isFactSlot(spec, sub, label) {
  if (sub && spec && spec.ranges && typeof spec.ranges === 'object' && Object.prototype.hasOwnProperty.call(spec.ranges, sub)) return true;
  return /\b(number|price|rating)\b/i.test(String(label || ''));
}

/** 一份 manifest → 画布上每一段可改的字（顺序同 §editableSlotPaths）：`{ path, kind, typing, ai, image? }`。 */
function inlineSlotsOf(manifest) {
  const slots = (manifest && manifest.slots) || {};
  return editableSlotPaths(manifest).map((e) => {
    if (imageCellOf(slots[e.slot], e.sub)) return { path: e.path, kind: e.kind, typing: false, ai: false, image: true };
    return {
      path: e.path,
      kind: e.kind,
      typing: e.kind !== 'richtext',
      ai: !isFactSlot(slots[e.slot], e.sub, e.label),
    };
  });
}

// ── #1660 —— 新块拖到画布那一刻播几条列表项 ──────────────────────────────────────────────────────────────
//
// 不写块名单，按一条规则现算（票正文「做什么 1」）：
//   · manifest 里 `kind: list` 且 `required: true`；
//   · 没写 `itemRequires`（条目非填不可的是图片这类，本票不配图 —— 播了画不出来，「写了条目但一条都不合格」整块不画）；
//   · 每条的可改文字格（§inlineSlotsOf）至少一格 `ai: true`，且条目里没有【必填】的 `ai: false` 事实格（评分 / 数字
//     必填的不播：AI 不编数字，占位也不编；留空的条目会被块滤掉、整块消失）。可选的事实格（features 的 `number?`、
//     testimonials 的 `rating?`）不挡 —— 只是不填。判「必填」看项形状里那一格的顶层键带不带 `?`（§itemShapeEntries）。
//     📌 #1686 给这两块补了可选事实格的编辑格之后，「全部 ai: true」那一版把它们俩踢出了集合（PM r4 验收量到）。
// `keys` = 播出来的条目里填占位的那几格：项形状里**顶层的纯文字键**（值写法里不带 `[` / `{`）、有编辑格、`ai: true`。
//   `[string]` 列表（features 的 `bullets`）不填 —— 写一句话进去类型就错；子对象（`link` / `cta`）不填 —— 带链接，
//   只写文字等于一个死按钮。这也让 pricing 交给 fill 的格数停在 8 + 3×4 = 20（= manager 的 rewriteMaxFields）。
// 条数 SEED_ITEMS 夹在这个槽的 `minItems` / `maxItems` 之间。今天命中 faq·items、features·items、pricing·plans、
// team·members、testimonials·items —— 那是读数，`scripts/editor-placeholders.test.js` ⑤ 断言的就是这个集合。
const SEED_ITEMS = 3;

/** 一份 manifest → 新块落下时要播的列表：`[{ slot, count, keys }]`（顺序同 manifest 里槽位的书写顺序）。 */
function seedListsOf(manifest) {
  const slots = (manifest && manifest.slots) || {};
  const cells = editableSlotPaths(manifest);
  const out = [];
  for (const [slot, spec] of Object.entries(slots)) {
    if (!spec || spec.kind !== 'list' || spec.required !== true || spec.itemRequires !== undefined) continue;
    const entries = new Map(itemShapeEntries(spec.shape).map((e) => [e.key, e]));
    // #1693 —— 图片格不是字：不算「能让 AI 写的格」，也不算事实格（它没有占位可播）。
    const own = cells.filter((e) => e.slot === slot && !imageCellOf(spec, e.sub));
    const ai = own.filter((e) => !isFactSlot(spec, e.sub, e.label));
    const requiredFact = own.some((e) => {
      // #1692 —— 只有播种会填的格才参与「播不播」：播种只填项形状里顶层的纯文字键（下面的 `keys`），子对象里的格
      //    （`price.monthly`）播种本来就不填 —— 跟必填的 `cta: {label, href}` 留空一样，挡不着播种。
      if (String(e.sub || '').includes('.')) return false;
      if (!isFactSlot(spec, e.sub, e.label)) return false;
      const top = entries.get(String(e.sub || '').split('.')[0]);
      return !top || !top.optional;
    });
    if (!ai.length || requiredFact) continue;
    const keys = ai.map((e) => e.sub).filter((sub) => {
      const top = entries.get(sub);
      return !!top && !/[[{]/.test(top.value);
    });
    const min = Number.isInteger(spec.minItems) ? spec.minItems : 0;
    const max = Number.isInteger(spec.maxItems) ? spec.maxItems : Infinity;
    out.push({ slot, count: Math.min(max, Math.max(min, SEED_ITEMS)), keys });
  }
  return out;
}

function humanize(name) {
  const s = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * @param {object} [opts]
 * @param {string} [opts.rootDir]       模板根（`site/` 的上一层）；只用来读这个站穿哪套主题
 * @param {string} [opts.siteDir]       站点目录，缺省 `<rootDir>/site`（#1599：分段预览构建读快照，见 editor-page.js §editorSource）
 * @param {string} [opts.registryPath]  透传给 blockShapeCatalog（守卫用它换一份假注册表）
 * @param {string} [opts.blocksDir]     透传给 blockShapeCatalog
 * @param {string} [opts.layoutsDir]    `page-layouts/`（#1405 的 root 字段用）；不给按 page-layout.js 的默认
 * @returns {{ components: Array<{ type, label, fields, carried, shapes, defaultShape, themeShape, fallbackShape }> }}
 *   · `carried`       没有字段、由转换器原样携带的槽位名（守卫拿它证明「每个槽位都有归属」）
 *   · `shapes`        下拉选项 `[{ name, needs }]`，顺序照形态清单
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
    const { structureThemeId } = siteRegions.resolveSiteRegionLayout(opts.siteDir || path.join(opts.rootDir, 'site'));
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
      .filter((p) => p.block === type)
      .map((p) => ({ name: p.shape, needs: p.needs }));
    components.push({
      type,
      label: typeof m.displayName === 'string' && m.displayName ? m.displayName : type,
      fields,
      // #1657 —— 画布上的点击层据它判「点到的这段字能不能打、出不出 AI 按钮」（§inlineSlotsOf）。
      inline: inlineSlotsOf(m),
      // #1660 —— 拖下去那一刻播几条列表项（§seedListsOf）。
      seed: seedListsOf(m),
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
 *   · 顶栏 / 页脚形态 → catalog 的 `pairs`（出处是 `blocks/header/*` 与 `blocks/footer/*` 两个子目录）。
 *   · 布局 → `page-layouts/` 库（`lib/page-layout.js` §loadLayouts）。每一份带上它的区与 `repeatVariants`，
 *     画布照它排区；`pinsFooter` 由 §layoutPinsFooter 算（布局自己钉了页脚形态 ⟹ 页脚下拉灰掉）。
 * 🔴 **没有「哪些组合构建不收」**（带 topbar 区 + 透明浮层 / 缺某种语言的 topbar 文字）：那条规则只住在
 *    站里的写盘脚本（`scripts/write-editor-save.js`，用构建同一个 `needsTopbar` 判），编辑器不抄第二份
 *    （票正文做什么 6）。
 * 🔴 `layoutsDir` 要显式传：被打进 Next 服务端包之后 `__dirname` 是产物目录（同 `blocksDir` 那条）。
 */
function rootSchema(catalog, opts) {
  const pickable = (block) => catalog.pairs
    .filter((p) => p.block === block)
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

/**
 * #1686 —— 列表项里**不给格子**的字段：「块.列表.字段」→ 理由。§itemFieldCoverageProblems 拿它当豁免名单。
 * 🔴 逐条写、不按字段名一刀切：别的块以后新加一个同名、但看得见的字段（一个 `icon` 下面带说明字），不该被顺带放过。
 *    这里没有、又没有格子 ⟹ 那道检查点名它；要么给格子，要么在这里加一条并写明理由。
 */
const BUTTON_STYLE = '按钮的样式设置，不是字';
const ICON = '图标';
// #1693 —— 「一个位置一张图」的那 4 条（features / gallery / team / testimonials 每项的图）有格子了，从名单里删掉；
//    剩下的是成排的图（logo 一排、hero 的 band、点评平台 logo），归 T9。
const IMAGE = '成排的图里的一张。换图做了「一个位置一张」（#1693），成排的归 T9';
const IMAGE_ALT = '成排的图里那一张的替代文字，跟着图片走：等 T9 做成排换图时一起给';
const ITEM_FIELD_EXEMPT = Object.freeze({
  ...Object.fromEntries(['content.ctas', 'cta.ctas', 'features.introCtas', 'hero.ctas', 'milestones.introCtas', 'page-header.ctas']
    .flatMap((l) => ['style', 'icon', 'arrow', 'size'].map((f) => [`${l}.${f}`, BUTTON_STYLE]))),
  'features.items.icon': ICON,
  'milestones.stats.icon': ICON,
  'pricing.highlights.icon': ICON,
  'hero.band.imageUrl': IMAGE,
  'logos.items.imageUrl': IMAGE,
  'reviews.platforms.logoUrl': IMAGE,
  'testimonials.summary.logoUrl': IMAGE,
  'hero.band.alt': IMAGE_ALT,
  'logos.items.alt': IMAGE_ALT,
  'pricing.plans.featured': '「推荐套餐」高亮开关，是样式',
  'team.members.links': '成员的社交图标链接，是图标',
});

/**
 * #1686 —— 每份非 region manifest 的每个列表槽，项形状里的每个顶层字段（含可选的）：要么在编辑器 schema 里有一格
 * （这个槽位的字段里有同名的 `sub`），要么在豁免名单里。§slotCoverageProblems 只管槽位这一层 —— 价格块的 `plans`
 * 有格子它就算过了，项里漏掉的 `features` / `cta` 没人报（#1686 的病根）。
 * 名单那一侧也查：一条豁免在形状里找不到（字段改名 / 删了）、或者它其实已经有格子了，都点名 —— 名单不许比现实多。
 * 回字符串数组，空 = 对得上。
 */
function itemFieldCoverageProblems(schema, manifests, exempt = ITEM_FIELD_EXEMPT) {
  const byType = new Map(schema.components.map((c) => [c.type, c]));
  const out = [];
  const seen = new Set();
  for (const [type, m] of manifests) {
    if (!m || m.region === true) continue;
    const c = byType.get(type);
    for (const [slot, spec] of Object.entries(m.slots || {})) {
      if (!spec || spec.kind !== 'list') continue;
      const field = c && c.fields.find((f) => f.slot === slot);
      const subs = new Set(((field && field.subs) || []).map((x) => x.sub));
      for (const { key } of itemShapeEntries(spec.shape)) {
        const id = `${type}.${slot}.${key}`;
        const excused = Object.prototype.hasOwnProperty.call(exempt, id);
        if (excused) seen.add(id);
        if (subs.has(key)) { if (excused) out.push(`${id}（有格子，却还在豁免名单里）`); continue; }
        if (!excused) out.push(id);
      }
    }
  }
  for (const id of Object.keys(exempt)) if (!seen.has(id)) out.push(`${id}（豁免名单里有，列表项形状里没有这个字段）`);
  return out;
}

module.exports = { editorSchema, fieldsOf, isOneImage, imageCellOf, slotCoverageProblems, itemFieldCoverageProblems, ITEM_FIELD_EXEMPT, itemTopKeys, itemShapeEntries, inlineSlotsOf, isFactSlot, seedListsOf, SEED_ITEMS, LINK_HREF };
