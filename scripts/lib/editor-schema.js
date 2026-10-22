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
//                       kind list 且项形状顶层有可选 `location?`（testimonials）→ 每项多一格 Location（`location: true`，值是地点 id，#1981，§addLocationRef）
//   一张图（#1693）      形状是 `{imageUrl, alt}` 的对象槽 → 一格图片（`control: 'image'`）：缩略图 + Change + 图片说明（alt），
//                        可选的（`required: false`）再给 Remove；列表项里值是 `{imageUrl, alt}` 的那个键 → 同样一格（`image: true`，
//                        可选 = 项形状里那个键带 `?`）。判据是形状（§isOneImage），不写块名单。
//   成排的图（#1694）    项里的图片地址键（`imageUrl` / `logoUrl`，值是一个字符串，§isImageUrlEntry）标了 editLabel →
//                        一格图片（`image: true, url: true`：缩略图 + Change，没有说明）。项**本身就是一张图**（顶层键只有
//                        地址 + `alt?` + `href?`：`logos.items`、`hero.band`、`proof.avatars`）⟹ 整列是一列图（`imageRow: true`）：
//                        每项缩略图 + Change + 名字 / 说明（`alt`）+ 链接（`href?`），能加（先选图）、删、拖动排序，条数夹在
//                        `minItems` / `maxItems` 之间。对象里包着的列表（`logos: {caption, items: [...]}`）在 editLabel 里写成
//                        `items.imageUrl`，那一格是对象字段里的一个子字段（同样 `imageRow`）。
// 列表项里**不给格子**的字段逐条登记在 §ITEM_FIELD_EXEMPT（带理由），§itemFieldCoverageProblems 守「每个字段要么有格子、要么在名单里」。
// 🔴 「带 `sub`」≠「列表」：`link`（`{label, href}`）和 `object`（`hero-with-form.form`）也带 `sub`。
//    把它们做成 array 字段，Puck 会把一个对象当数组编辑，存回去就坏了。
//
// 没有 `editLabel` 的槽位（`NON_EDITABLE_TEXT_SLOTS`、`flag` …）**不出字段** —— 它们的值由
// 转换器原样携带（`editor-convert.js`），画布照样渲染。
// 📌 #1693 之前图片槽一律在这一类里（#1404 票正文「换图不做」）；「一个位置一张」的图（#1693）和成排的图（#1694）现在都标了 `editLabel`。

const path = require('path');
const { blockShapeCatalog } = require('./block-catalog');
const { editableSlotPaths, defaultShapeOf } = require('./block-manifest');
const { knobsOf, knobDefault, choiceDefault, presetsOf, booleanOptionsOf, presetColorSlotsOf, presetPartDemosOf } = require('./block-knobs');
const { shapeForBlock } = require('./block-shape');
const siteRegions = require('./site-regions');
const pageLayoutLib = require('./page-layout');
const { ROOT_FIELDS } = require('./editor-root-fields');
const { shapesFor } = require('../themes');
const { GRADIENT_SWATCHES, normalizeBg } = require('./contrast');
const { BUTTON_SOURCES } = require('./item-sources');
const { IMAGE_FIELDS } = require('./image-urls');

/** `kind: link` 的字段在 manifest 的 `editLabel` 之外多出来的那一个子字段（#1404 r3）。 */
const LINK_HREF = 'href';

/** #1693 —— 「一个位置一张图」的形状：对象槽的 `shape`、或列表项里某个键的值写法恰好是 `{imageUrl, alt}`。 */
const ONE_IMAGE_SHAPE = /^\{\s*imageUrl\s*,\s*alt\s*\}$/;
function isOneImage(shape) {
  return typeof shape === 'string' && ONE_IMAGE_SHAPE.test(shape.trim());
}

/**
 * #1694 —— 项形状里的一个键是不是「一张图的地址」：键名在 `image-urls.js` §IMAGE_FIELDS 里（AI 改站的写入闸、模板按 `<img src>` 画的
 * 就是这几个键），值写法是一个字符串（不是 `{…}` / `[…]`）。`reviews.platforms` 的 `logoUrl?`、`logos.items` 的 `imageUrl`。
 */
function isImageUrlEntry(e) {
  return !!e && IMAGE_FIELDS.includes(e.key) && !/[[{]/.test(e.value);
}

/**
 * #1694 —— 项**本身就是一张图**：有一个图片地址键，其余顶层键只有 `alt`（图的名字 / 说明）和 `href`（点出去的链接）。
 * `[{imageUrl, alt, href?}]`（logos）· `[{imageUrl, alt?}]`（hero.band）· `[{imageUrl}]`（头像）。回那个地址键的形状条目，不是 ⟹ null。
 */
function imageRowKeyOf(itemShape) {
  const entries = itemShapeEntries(itemShape);
  const urls = entries.filter(isImageUrlEntry);
  if (urls.length !== 1) return null;
  return entries.every((e) => e === urls[0] || e.key === 'alt' || e.key === LINK_HREF) ? urls[0] : null;
}

/** #1694 —— 对象槽形状（`{caption, items: [{imageUrl, alt}]}`）里值是一列（`[{…}]`）的那几个键：`[{ key, itemShape }]`。 */
function objectListsOf(spec) {
  const m = /^\s*\{([\s\S]*)\}\s*$/.exec(spec && spec.kind === 'object' && typeof spec.shape === 'string' ? spec.shape : '');
  if (!m) return [];
  return objectEntries(m[1]).filter((e) => /^\[\s*\{[\s\S]*\}\s*\]$/.test(e.value)).map((e) => ({ key: e.key, itemShape: e.value }));
}

/**
 * #1693 —— §editableSlotPaths 的一条是不是一张图：顶层 = 对象槽、形状 `{imageUrl, alt}`；列表项 = 项形状里那个键的值是 `{imageUrl, alt}`。
 * 是 ⟹ `{ optional }`（顶层看 `required === false`，列表项看键带不带 `?` —— PM 2026-10-10 裁定）；不是 ⟹ null。
 * #1694 —— 成排的图：列表项里的图片地址键（§isImageUrlEntry），或对象里包着的列表的那一键（`items.imageUrl`）⟹ `{ optional, url: true }`
 *    （值是一个字符串地址，不是 `{imageUrl, alt}` 对象）。
 */
function imageCellOf(spec, sub) {
  if (!spec) return null;
  if (sub === null || sub === undefined) {
    return spec.kind === 'object' && isOneImage(spec.shape) ? { optional: spec.required === false } : null;
  }
  if (spec.kind === 'object') {
    const [head, key, ...more] = String(sub).split('.');
    const list = more.length ? null : objectListsOf(spec).find((x) => x.key === head);
    const e = list && itemShapeEntries(list.itemShape).find((x) => x.key === key);
    return isImageUrlEntry(e) ? { optional: e.optional, url: true } : null;
  }
  if (spec.kind !== 'list') return null;
  const e = itemShapeEntries(spec.shape).find((x) => x.key === sub);
  if (isImageUrlEntry(e)) return { optional: e.optional, url: true };
  return e && isOneImage(e.value) ? { optional: e.optional } : null;
}

/**
 * #1694 —— 一列图（项本身就是一张图，§imageRowKeyOf）的子字段，照项形状的键序：图（`image + url`）· `alt`（logo 叫 Name，别的叫
 * Image description）· `href?`（Link，不带 `sources`，同 §addOptionalHref）。`urlLabel` = manifest 给那个地址键的 editLabel。
 * #1707 —— `itemRequires` = 槽自己的「每一项都必须有」声明：文字格（`alt` / `href`）在里面 ⟹ 那一格带 `required: true`，面板加完图
 *    把焦点给它、空着就标出来（AI 改站那一关 `scope: 'edit'` 会拒空的）。按声明现算，不写块名 —— 今天命中的只有 `logos.items` 的 `alt`。
 */
function imageRowSubs(itemShape, urlLabel, itemRequires) {
  const req = Array.isArray(itemRequires) ? itemRequires : [];
  const need = (sub) => (req.includes(sub) ? { required: true } : {});
  const out = [];
  for (const e of itemShapeEntries(itemShape)) {
    if (isImageUrlEntry(e)) out.push({ sub: e.key, label: urlLabel, image: true, url: true, optional: false });
    else if (e.key === 'alt') out.push({ sub: 'alt', label: /\blogo\b/i.test(urlLabel) ? 'Name' : 'Image description', ...need('alt') });
    else if (e.key === LINK_HREF) out.push({ sub: LINK_HREF, label: 'Link', ...need(LINK_HREF) });
  }
  return out;
}

/**
 * manifest 的 `minItems` / `maxItems` → 字段上的 `min` / `max`（没写就不带：0 条起、不封顶，同 §seedListsOf 的读法）。
 * #1723 —— `maxItems` 没写时回落读 `max`：按钮列表（`ctas` / `introCtas`）的「最多几项」写在 `max` 上（#1479），
 *   `block-knobs.js` §toolbarControlsOf 据它出 `count:` 旋钮、`block-manifest.js` 校验它 ⟹ 🔴 别把 manifest 里的 `max` 改名。
 */
function itemBounds(spec) {
  const out = {};
  if (spec && Number.isInteger(spec.minItems)) out.min = spec.minItems;
  if (spec && Number.isInteger(spec.maxItems)) out.max = spec.maxItems;
  else if (spec && Number.isInteger(spec.max)) out.max = spec.max;
  return out;
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
      // #1477 —— 预设渐变跟着纯色色板一起带下去（`contrast.js` §GRADIENT_SWATCHES，副本；#1698 起有两档是跟主题走的名字）。
      //    #1698 r2 —— 槽自己写了 `gradients` 就用它的（pricing `featuredColor` 不给浅渐变，理由见 block-manifest.js 那条校验）。
      const grads = Array.isArray(spec.gradients) ? spec.gradients : GRADIENT_SWATCHES;
      fields.push({ slot, kind: 'color', label: humanize(slot === 'bg' ? 'background' : slot), control: 'color', subs: [],
        swatches: Array.isArray(spec.swatches) ? spec.swatches.slice() : [],
        gradients: grads.map((g) => normalizeBg(g)) });
      continue;
    }
    // #1833 —— `kind: code`（Custom HTML 的 html）：一个代码框，面板标题是槽上的 `codeLabel`。页面上没有这一格的字
    //    （不在 editableSlotPaths 里），所以在这里单出。
    if (spec && spec.kind === 'code') {
      fields.push({ slot, kind: 'code', label: typeof spec.codeLabel === 'string' && spec.codeLabel ? spec.codeLabel : humanize(slot), control: 'code', subs: [],
        optional: spec.required !== true });
      continue;
    }
    // #1833 —— `panelOnly`（`custom-html.label`）：右栏一格字，页面上没有它（不在 editableSlotPaths 里）。
    if (spec && spec.panelOnly === true && typeof spec.editLabel === 'string') {
      fields.push({ slot, kind: spec.kind, label: spec.editLabel, control: 'text', subs: [] });
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
        // #1784 —— 写了 `label` 就带上（面板上那一行的标题；顶栏 logo 位置那个叫 Logo position，跟 Logo / Logo size 分得开）。
        knobs: knobsOf(manifest).map((k) => ({ name: k.name, values: k.values.slice(), default: knobDefault(k), ...(typeof k.label === 'string' && k.label ? { label: k.label } : {}) })),
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
    if (!entries) continue;
    // #1694 —— 一列图（`logos.items`、`hero.band`）：每项缩略图 + Change + 名字 / 说明 + 链接，能加（先选图）/ 删 / 排序。
    //    #1463 那版（`editItems: true`：只能挪 / 删，没有换图）随之退役。
    const row = spec && spec.kind === 'list' ? imageRowKeyOf(spec.shape) : null;
    if (row && entries.some((e) => e.sub === row.key)) {
      const label = entries.find((e) => e.sub === row.key).label;
      fields.push({ slot, kind: spec.kind, label: humanize(slot), control: 'list', imageRow: true, subs: imageRowSubs(spec.shape, label, spec.itemRequires), summary: ['alt'], ...itemBounds(spec) });
      continue;
    }
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
    const subs = kind === 'list' ? itemSubs(entries, spec) : objectSubs(entries, spec, slot);
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
      addLocationRef(subs, spec);
    }
    // #1755 —— 按钮列表（项的顶层必有 `label` + `href`，Link 那格带本店引用 —— 正是上面 #1518 / #1521 补的那几条）：编辑器整个
    //    换成一套按钮控件（Link Type 五选一 + 那一格 + Button label，`src/components/editor/ButtonLink.tsx`），画布上点按钮开按钮弹窗。
    //    按形状派生、不写块名单（今天是 hero / cta / content / page-header 的 `ctas`、features / milestones 的 `introCtas`）。
    const button = kind === 'list' && itemTopKeys(spec && spec.shape).includes('label')
      && subs.some((x) => x.sub === 'label') && subs.some((x) => x.sub === LINK_HREF && x.sources);
    fields.push({
      slot,
      kind,
      // 一个带子字段的槽位没有自己的 editLabel；显示名用 manifest 的槽位名（Puck 会在它下面列子字段）。
      label: humanize(slot),
      control: kind === 'list' ? 'list' : 'object',
      subs,
      // #1694 —— 带一张图地址的列表（点评平台 1–4）：面板上到了上下限，加 / 删就灰掉。
      // #1723 —— 全部列表都挂（画布上的条目条到 `min` 灰掉 🗑，跟面板同一个数）：今天能删到 0 的 faq / features 面板
      //    改完到 `minItems` 就不让删 —— 删到 0 存盘时 validateSite 本来就拦（block-manifest.js「至少要 N 项」）。
      ...(kind === 'list' ? itemBounds(spec) : {}),
      ...(button ? { button: true } : {}),
    });
  }
  return fields;
}

/**
 * 对象槽 `editLabel` 的几条 → 子字段：一条一格字。#1694 —— 带点、而点前那一段在对象形状里是一列图（`items.imageUrl`、
 * `avatars.imageUrl`，§objectListsOf + §imageRowKeyOf）⟹ 合成一个 `imageRow` 子字段（子字段同顶层那种一列图，§imageRowSubs）。
 * 显示名：列表键叫 `items` 的用槽位名（Logos），否则用列表键（Avatars）。上限 = 对象槽的 `listMax.<列表键>`（块的 Section 据同一个数截，
 * QA2 退回：写死在 Section 里时面板加到第 7 个 logo 存了却不画）；没写 ⟹ 不封顶（PM 裁定 ①）。下限一律 0（删空 = 这一排不画，面板有提示）。
 */
function objectSubs(entries, spec, slot) {
  const lists = new Map(objectListsOf(spec).map((x) => [x.key, x]));
  const subs = [];
  for (const e of entries) {
    const [head, key, ...more] = String(e.sub).split('.');
    const list = key !== undefined && !more.length ? lists.get(head) : null;
    const row = list && imageRowKeyOf(list.itemShape);
    if (row && row.key === key) {
      const max = spec.listMax && Number.isInteger(spec.listMax[head]) ? { max: spec.listMax[head] } : {};
      subs.push({ sub: head, label: humanize(head === 'items' ? slot : head), imageRow: true, subs: imageRowSubs(list.itemShape, e.label), ...max });
      continue;
    }
    subs.push({ sub: e.sub, label: e.label });
  }
  return subs;
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
      // #1694 —— 项里一张图的地址（点评平台的 `logoUrl?`）：一格图片，值是地址字符串，没有说明；可选的带 Remove。
      if (isImageUrlEntry(se)) { subs.push({ sub: e.sub, label: e.label, image: true, url: true, optional: se.optional }); continue; }
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

/**
 * #1981 —— 项形状里有可选的 `location?`（testimonials 的一条评价是哪一家的）⟹ 每项补一格 Location（`location: true`）。
 * 值是地点的 `id`，EditorApp 画成下拉（网站 ≥2 个地点才画）。它不是页面上的一段字（没有 `data-slot`），所以不进 `editLabel`，
 * 同上面 `href?` 那条按形状补。
 */
function addLocationRef(subs, spec) {
  const e = itemShapeEntries(spec && spec.shape).find((x) => x.key === 'location');
  if (!e || !e.optional || subs.some((x) => x.sub === 'location')) return;
  insertByShape(subs, { sub: 'location', label: 'Location', location: true }, spec);
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
//     #1694 —— 成排的图那一格再带 `url: true`（值是地址字符串）。
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
    const img = imageCellOf(slots[e.slot], e.sub);
    // #1694 —— `url`：这一格的值就是地址字符串（成排的图），不是 `{imageUrl, alt}` 对象。
    // #1713 —— `label`：这个位置的名字（manifest 的 editLabel，选图弹窗标题 `Hero · Image` 的后半）；
    //    `regenerate`：图上悬停出不出 ✨ Regenerate —— 成排的小图（`url`）不出，槽上写了 `generateImages: false`
    //    （只能是老板上传的：team / logos / testimonials）也不出。两种都只出 ✎ Edit。
    if (img) {
      const regenerate = !img.url && !(slots[e.slot] && slots[e.slot].generateImages === false);
      return { path: e.path, kind: e.kind, typing: false, ai: false, image: true, ...(img.url ? { url: true } : {}), label: e.label, regenerate };
    }
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
//     （#1766 起写了的也播，见下面 ③）
//   · 每条的可改文字格（§inlineSlotsOf）至少一格 `ai: true`，且条目里没有【必填】的 `ai: false` 事实格（评分 / 数字
//     必填的不播：AI 不编数字，占位也不编；留空的条目会被块滤掉、整块消失）。可选的事实格（features 的 `number?`、
//     testimonials 的 `rating?`）不挡 —— 只是不填。判「必填」看项形状里那一格的顶层键带不带 `?`（§itemShapeEntries）。
//     📌 #1686 给这两块补了可选事实格的编辑格之后，「全部 ai: true」那一版把它们俩踢出了集合（PM r4 验收量到）。
// `keys` = 播出来的条目里填占位的那几格：项形状里**顶层的纯文字键**（值写法里不带 `[` / `{`）、有编辑格、`ai: true`。
//   `[string]` 列表（features 的 `bullets`）不填 —— 写一句话进去类型就错；子对象（`link` / `cta`）不填 —— 带链接，
//   只写文字等于一个死按钮。这也让 pricing 交给 fill 的格数停在 8 + 3×4 = 20（= manager 的 rewriteMaxFields）。
// 条数 SEED_ITEMS 夹在这个槽的 `minItems` / `maxItems` 之间。今天命中 faq·items、features·items、pricing·plans、
// team·members、testimonials·items —— 那是读数，`scripts/editor-placeholders.test.js` ⑤ 断言的就是这个集合。
//
// #1766 —— 再加两档，都是「播了、但**不**交给 AI 填字」（`fill: false`）：
//   ② manifest 写了 `seedItems`（示例条目）⟹ 照它播，`items` 交出去（今天只有 reviews·platforms：Google / Yelp / Facebook
//      带示例分数和条数 —— Chris：「你就编一个就好了……最怕的是你不给他编一个的话，他不知道怎么去修改这些文字」）。
//      条目里的事实格是示例本身带的，不受上面「必填事实格不播」那条管。
//   ③ 写了 `itemRequires` 的列表：#1660 跳过它们，理由是「播了画不出来」—— #1734 有了可点的占位图之后不成立了。
//      每一条「必须有」只能是两种之一才播：一张图（§imageCellOf：画占位图）或项形状顶层的纯文字键（填占位，进 `keys`）；
//      别的（必须有个链接之类）照旧不播。今天命中 logos·items（`alt` 填「Logo 1」）、gallery·items（只有图，没有字要填）。
//      不交给 AI：那几个字是图的名字，老板换图时一起改（正文做什么 3）。
//   `fill: false` 的 `keys` 只填占位，不进 `block-placeholders.js` §fillFields。
const SEED_ITEMS = 3;

/**
 * 一份 manifest → 新块落下时要播的列表：`[{ slot, count, keys, fill?, items? }]`（顺序同 manifest 里槽位的书写顺序）。
 * #1767 —— 另加一种：列表里有一格是 §seedTargetsOf 要补的（图标、数字……）⟹ 这一列也播，条数照那一格路过它时定的
 *    （`pricing.highlights` 的图标、`milestones.stats` 的数字、`testimonials.summary` 的评分照 manifest 的 `demo`）。
 *    按钮列表（`ctas`）不在这里：它整列由 §seedProps 按按钮写。`type` 不给 ⟹ 豁免名单对不上任何一格（只给比较用）。
 */
function seedListsOf(manifest, type = '') {
  const slots = (manifest && manifest.slots) || {};
  const cells = editableSlotPaths(manifest);
  const targets = seedTargetsOf(manifest, type);
  const out = [];
  const clamp = (spec, n) => {
    const min = Number.isInteger(spec.minItems) ? spec.minItems : 0;
    const max = Number.isInteger(spec.maxItems) ? spec.maxItems : Infinity;
    return Math.min(max, Math.max(min, n));
  };
  for (const [slot, spec] of Object.entries(slots)) {
    if (!spec || spec.kind !== 'list') continue;
    if (spec.required === true && Array.isArray(spec.seedItems) && spec.seedItems.length) {
      out.push({ slot, count: spec.seedItems.length, keys: [], fill: false, items: spec.seedItems });
      continue;
    }
    if (spec.itemRequires !== undefined) {
      if (spec.required !== true) continue;
      const entries = new Map(itemShapeEntries(spec.shape).map((e) => [e.key, e]));
      const req = Array.isArray(spec.itemRequires) ? spec.itemRequires : [];
      const isImage = (p) => !!imageCellOf(spec, String(p).split('.')[0]);
      const isText = (p) => !String(p).includes('.') && entries.has(p) && !/[[{]/.test(entries.get(p).value);
      if (!req.every((p) => isImage(p) || isText(p))) continue;
      out.push({ slot, count: clamp(spec, SEED_ITEMS), keys: req.filter((p) => !isImage(p)), fill: false });
      continue;
    }
    const step = (targets.find((t) => t.kind !== 'buttons' && t.steps[0].key === slot && t.steps[0].list) || { steps: [] }).steps[0];
    if (spec.required !== true && !step) continue;
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
    if (!step && (!ai.length || requiredFact)) continue;
    const keys = ai.map((e) => e.sub).filter((sub) => {
      const top = entries.get(sub);
      return !!top && !/[[{]/.test(top.value);
    });
    out.push({ slot, count: step ? step.count : clamp(spec, SEED_ITEMS), keys });
  }
  return out;
}

// ── #1767 —— 拖下那一刻每一类槽位都不空：按槽位的**种类**归类（不按布局、不写块名单） ─────────────────────────
//
// 块画不画一个位置看的是数据空不空（cta 只画有字的按钮、features 的 `b.icon ? … : null`），所以「拖下时哪里空着」按种类判。
// §seedCellsOf 把一块的每个槽位 —— 含对象里的子槽、列表项里的字段 —— 从 manifest 读出它是哪一类：
//   button   按钮 / 链接：一个对象，形状里必有 `label` 和 `href`（`kind: link` 的槽、`cta: {label, href, …}`、`link?: {…}`）
//   buttons  一列按钮：列表项形状里必有 `label` 和 `href`（`ctas` / `introCtas`）
//   number   数字：先认已经声明了的标记 —— 槽的 `intRange`、`ranges.<键>`、形状里写成 `N–M` 的值；认不出才按字段名
//            （§NUMBER_EXAMPLES 的键，也是那张字段名清单的唯一一份；`price: {monthly, yearly?}` 这种看上一层的名字）
//   icon     `icon`
//   strings  `[string]`
//   row      成排的小图：列表项本身就是一张图（§imageRowKeyOf）
//   image    一个位置一张的图（§isOneImage，或一项里的图片地址键）—— 照 #1734 没图垫占位图、数据不写，不归这里管
//   text     字（照 #1660：占位 + AI fill）
//   link     只有地址没有字的 `href`（点评平台 / 成员社交链接点出去的地方，不是按钮）
//   setting  样式 / 开关 / 下拉：`bg` 引用、`kind: color`、旋钮槽、选表单的 `{id?}`、`choices` / `itemChoices` 里的子字段、
//            形状写成 `bool` 或一串引号枚举的值。按钮里除了 `label` / `href` 以外的键（style / icon / arrow / size）算按钮的一部分。
//   list / object  装别的格子的容器（它自己不是一格，但豁免名单可以整个点它）
//   unknown  上面一样都认不出 —— `scripts/block-seed.test.js` 判红，不默默跳过（新写法的按钮槽加进来不会照样绿）
// `steps` 是从块数据走到这一格的路：`[{ key, list }]`，`list: true` = 这一步是一个列表（往下走的是它的每一项）。
// 前五类（`SEED_KINDS`）拖下时必须有值；故意不播的进 §SEED_EXEMPT 写理由。
const SEED_KINDS = Object.freeze(['button', 'buttons', 'number', 'icon', 'strings', 'row']);

/**
 * 数字的示例值（拖下时填的，老板觉得不对自己改 —— Chris 2026-10-13，#1766 / #1767）。键 = 认数字用的字段名清单（只写这一处）。
 * 同一块里几条不一样；评分不贴下界（`reviews.platforms.rating` 下界是 0，播 0 = 替老板编一条差评，PM r2 ②）。
 * 价格只是示例，不按站点货币换算：建站生成的内容不在 #1767 射程内，那里照旧不编价格。
 */
const NUMBER_EXAMPLES = Object.freeze({
  value: Object.freeze(['10+', '500+', '98%']),
  price: Object.freeze(['$29', '$59', '$99']),
  rating: Object.freeze([5, 4, 3]),
  count: Object.freeze([120, 85, 64]),
  number: Object.freeze(['01', '02', '03']),
});

/** 图标的示例名（Bootstrap Icons 里都有：`scripts/block-seed.test.js` 逐个查文件）。一块里几条各不相同。 */
const SEED_ICONS = Object.freeze(['star', 'shield-check', 'lightning-charge', 'heart', 'clock', 'trophy']);

/** 按钮列表拖下时播几颗：hero 和 cta 两颗（一颗实心、一颗描边，#1767 正文做什么 2 点名），别的块一颗。 */
const TWO_BUTTON_BLOCKS = Object.freeze(['hero', 'cta']);

/** #1766 管这三块的播种（logo 一排、照片墙、点评平台），#1767 不做。 */
const SEED_EXCLUDED_BLOCKS = Object.freeze({ logos: '#1766', gallery: '#1766', reviews: '#1766' });

/**
 * 属于 `SEED_KINDS`、但拖下时**故意不播**的格子：`块.路径` → 理由。点一个容器（列表 / 对象）= 它下面的都不播。
 * 🔴 两头都查（`scripts/block-seed.test.js`）：名单里的路径在 manifest 里找不到、下面没有一格属于那几类、或者其实已经播了，
 *    都算红 —— 名单不许比现实多。
 *    以后加一个槽，它要么被播、要么在这里写理由。
 */
const SEED_EXEMPT = Object.freeze({
  'hero.stats': '首屏底下那一排数字是可选部件，默认布局（Split）只要标题、按钮和主图；播上就是首屏多一排编的数字（#1767 正文点名不播）',
  'hero.band': '首屏底下那一排大图是可选部件（#1767 正文点名不播）；要图的位置照 #1734 垫占位图，这一排拖下时不出现',
  'features.items.number': '步骤编号：有了它卡片就从「图标卡」变成「步骤卡」，连线开关也据它判（features/Section.tsx:115），拖下时默认是图标卡',
  'features.items.bullets': '卡片里的小清单是可选部件：播上就是三张卡各带三行勾，默认 Grid 只要图标 + 标题 + 正文',
  'features.items.link': '卡片底下的小链接是可选部件：三张卡各一颗「了解更多」都指向同一个地方，是死重',
  'faq.help': '「还有问题？」那张求助卡是可选部件，整张不播：只播它的按钮会画出半张卡',
  'team.join': '招聘卡是预设部件（Hiring 预设带它的 demo 内容，block-knobs.js §presetClickProps），默认 Photo grid 不带',
  'team.members.links': '成员的社交链接（图标 + 地址）只有老板知道是哪几个号，编一个就是一条指向别人主页的链接',
  'pricing.plans.price.yearly': '年付价：任何一个套餐写了它，月付 / 年付切换就会出现（pricing/Section.tsx:143），拖下时只给月付价',
  'blog.postCount': '显示几篇是一格下拉设置，空着按形状写明的默认 3 篇画（不是页面上的数字）',
});

const isQuotedEnum = (v) => /^"[^"]*"(\s*\|\s*"[^"]*")*$/.test(v);
const isRangeValue = (v) => /^\d+(\.\d+)?\s*[–-]\s*\d+(\.\d+)?$/.test(v);
const isButtonEntries = (entries) => ['label', LINK_HREF].every((k) => entries.some((e) => e.key === k && !e.optional));
const innerOf = (v) => { const m = /^\s*\{([\s\S]*)\}\s*$/.exec(v); return m ? m[1] : null; };

/**
 * 一块 manifest → 每一格的种类：`[{ id, kind, steps, optional }]`（顺序同 manifest 里槽位的书写顺序，容器在它的子格之前）。
 * `type` = 块名（只拼进 `id`）。
 */
function seedCellsOf(manifest, type) {
  const out = [];
  const slots = (manifest && manifest.slots) || {};
  const push = (steps, kind, optional) => out.push({ id: [type, ...steps.map((s) => s.key)].join('.'), kind, steps, optional: !!optional });
  // 一个键的值写法 → 种类（容器往下走）。`parent` = 上一层的键名（`price.monthly` 认数字靠它）；`spec` 只在槽这一层的列表项上给（ranges / choices）。
  const walk = (steps, key, parent, value, optional, spec) => {
    const v = String(value || '').trim();
    const ranges = spec && spec.ranges && typeof spec.ranges === 'object' ? spec.ranges : {};
    const choices = spec && { ...(spec.choices || {}), ...(spec.itemChoices || {}) };
    if (choices && Object.prototype.hasOwnProperty.call(choices, key)) return push(steps, 'setting', optional);
    if (v === '') {
      if (Object.prototype.hasOwnProperty.call(ranges, key)) return push(steps, 'number', optional);
      if (key === 'icon') return push(steps, 'icon', optional);
      if (IMAGE_FIELDS.includes(key)) return push(steps, 'image', optional);
      if (key === LINK_HREF) return push(steps, 'link', optional);
      if (Object.prototype.hasOwnProperty.call(NUMBER_EXAMPLES, key) || Object.prototype.hasOwnProperty.call(NUMBER_EXAMPLES, parent)) return push(steps, 'number', optional);
      return push(steps, 'text', optional);
    }
    if (v === 'bool' || isQuotedEnum(v)) return push(steps, 'setting', optional);
    if (isRangeValue(v)) return push(steps, 'number', optional);
    if (/^\[\s*string\s*\]$/.test(v)) return push(steps, 'strings', optional);
    if (/^\[\s*\{[\s\S]*\}\s*\]$/.test(v)) {
      const entries = itemShapeEntries(v);
      const at = [...steps.slice(0, -1), { ...steps[steps.length - 1], list: true }];
      if (isButtonEntries(entries)) return push(at, 'buttons', optional);
      if (imageRowKeyOf(v)) return push(at, 'row', optional);
      push(at, 'list', optional);
      for (const e of entries) walk([...at, { key: e.key, list: false }], e.key, key, e.value, e.optional, steps.length === 1 ? spec : null);
      return undefined;
    }
    const inner = innerOf(v);
    if (inner !== null) {
      if (isOneImage(v)) return push(steps, 'image', optional);
      const entries = objectEntries(inner);
      if (isButtonEntries(entries)) return push(steps, 'button', optional);
      push(steps, 'object', optional);
      for (const e of entries) walk([...steps, { key: e.key, list: false }], e.key, key, e.value, e.optional, steps.length === 1 ? spec : null);
      return undefined;
    }
    return push(steps, 'unknown', optional);
  };
  for (const [slot, spec] of Object.entries(slots)) {
    if (!spec) continue;
    const steps = [{ key: slot, list: false }];
    const optional = spec.required !== true;
    const shape = typeof spec.shape === 'string' ? spec.shape : '';
    if (spec.ref !== undefined || spec.kind === 'color' || (slot === 'options' && knobsOf({ slots: { [slot]: spec } }).length)
      || /^\{\s*id\?\s*\}$/.test(shape)) push(steps, 'setting', optional);
    else if (Array.isArray(spec.intRange)) push(steps, 'number', optional);
    else if (spec.kind === 'text' || spec.kind === 'richtext' || spec.kind === 'code') push(steps, 'text', optional);
    else if (spec.kind === 'link' || spec.kind === 'object' || spec.kind === 'list') walk(steps, slot, '', shape, optional, spec);
    else push(steps, 'unknown', optional);
  }
  return out;
}

/** 这一格是不是被豁免名单点到了（它自己，或它的某个容器）。 */
function seedExemptOf(id, exempt = SEED_EXEMPT) {
  const segs = String(id).split('.');
  for (let i = segs.length; i >= 2; i--) {
    const at = segs.slice(0, i).join('.');
    if (Object.prototype.hasOwnProperty.call(exempt, at)) return at;
  }
  return null;
}

/**
 * 一块拖下时要补上的格子：`SEED_KINDS` 那几类、不在豁免名单里、块不在 §SEED_EXCLUDED_BLOCKS 里。
 * 每条带上它路过的列表各播几条（`steps[i].count`：§SEED_ITEMS 夹在那一列的 `minItems` / `maxItems`（`max` / 对象里的 `listMax`）
 * 之间；槽写了 `demo` 的照 demo 的条数）。`block-placeholders.js` §seedProps 照它写值。
 */
function seedTargetsOf(manifest, type) {
  if (Object.prototype.hasOwnProperty.call(SEED_EXCLUDED_BLOCKS, type)) return [];
  const slots = (manifest && manifest.slots) || {};
  const cells = seedCellsOf(manifest, type);
  return cells
    .filter((c) => SEED_KINDS.includes(c.kind) && !seedExemptOf(c.id))
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      ...extrasOf(c, cells, slots),
      steps: c.steps.map((s, i) => {
        if (!s.list) return { key: s.key, list: false };
        const spec = slots[c.steps[0].key] || {};
        // 槽这一层的列表读槽自己的界；对象里包着的列表（`proof.avatars`、`logos.items`）读槽的 `listMax`。
        const bounds = i === 0 ? itemBounds(spec) : { ...(spec.listMax && Number.isInteger(spec.listMax[s.key]) ? { max: spec.listMax[s.key] } : {}) };
        const demo = i === 0 && Array.isArray(spec.demo) && spec.demo.length ? spec.demo : null;
        const want = c.kind === 'buttons' && i === c.steps.length - 1 ? (TWO_BUTTON_BLOCKS.includes(type) ? 2 : 1) : SEED_ITEMS;
        const count = demo ? demo.length : Math.min(bounds.max === undefined ? Infinity : bounds.max, Math.max(bounds.min || 0, want));
        return { key: s.key, list: true, count, ...(demo ? { demo: JSON.parse(JSON.stringify(demo)) } : {}) };
      }),
    }));
}

/**
 * §seedTargetsOf 每一格多带的那几样（都从形状读）：
 *   · number —— `key` / `parent`（查 §NUMBER_EXAMPLES 用）；`aggregate`：它是「整体评分」那一类（评分 / 条数，住在一个对象里
 *     （hero 的 `proof`），或者跟 `count` 是同一项的兄弟（`testimonials.summary`））⟹ 站里有建站时抓到的真实评分就用真的。
 *     一条一条的顾客评价（`testimonials.items.rating`）不是。
 *   · row —— `named`：项形状里有 `alt`（logo 一排要一个名字，`Logo 1`，同 #1766）；头像那种只有地址的项是 `{}`。
 */
function extrasOf(c, cells, slots) {
  const key = c.steps[c.steps.length - 1].key;
  if (c.kind === 'number') {
    const parent = c.steps.length > 1 ? c.steps[c.steps.length - 2] : null;
    const parentId = c.id.slice(0, c.id.lastIndexOf('.'));
    const siblingCount = cells.some((x) => x.id === `${parentId}.count`);
    const aggregate = (key === 'rating' || key === 'count') && !!parent && (!parent.list || siblingCount);
    return { key, parent: parent ? parent.key : '', aggregate };
  }
  if (c.kind === 'row') {
    const spec = slots[c.steps[0].key] || {};
    const shape = c.steps.length === 1 ? spec.shape : (objectListsOf(spec).find((l) => l.key === key) || {}).itemShape;
    return { named: itemShapeEntries(shape).some((e) => e.key === 'alt') };
  }
  return {};
}

/**
 * 列表项里每一项都要从站里的资料各播一行的列表（contact 的 `items`：`kind` 的词表里有 phone / email / address / hours）：
 * `[{ slot, key, kinds }]`。值不复制进块（块按 `kind` 现读站里的资料，`contact-facts.js` §siteFactsFrom），这里只决定播哪几行。
 */
const FACT_KINDS = Object.freeze(['phone', 'email', 'address', 'hours']);
function factListsOf(manifest) {
  const out = [];
  for (const [slot, spec] of Object.entries((manifest && manifest.slots) || {})) {
    if (!spec || spec.kind !== 'list' || !spec.itemChoices) continue;
    for (const [key, values] of Object.entries(spec.itemChoices)) {
      const kinds = (Array.isArray(values) ? values : []).filter((v) => FACT_KINDS.includes(v));
      // 每行的标题那一格：项形状里第一个必填的纯文字键（contact 的 `title`），播「电话」「邮箱」……交给 AI fill。
      const text = itemShapeEntries(spec.shape).find((e) => !e.optional && e.value === '' && e.key !== key);
      if (kinds.length && text) out.push({ slot, key, kinds, text: text.key });
    }
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
 * @returns {{ components: Array<{ type, label, category, fields, carried, shapes, defaultShape, themeShape, fallbackShape }> }}
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
      // #1711 —— 选图弹窗 Generate 的默认提示词按 manifest 的 `category` 取景（`slot-prompt.js` §buildSlotPrompt：banner = 宽幅远景）。
      category: typeof m.category === 'string' && m.category ? m.category : null,
      fields,
      // #1657 —— 画布上的点击层据它判「点到的这段字能不能打、出不出 AI 按钮」（§inlineSlotsOf）。
      inline: inlineSlotsOf(m),
      // #1660 —— 拖下去那一刻播几条列表项（§seedListsOf）。
      seed: seedListsOf(m, type),
      // #1767 —— 拖下时还要补上的按钮 / 数字 / 图标 / [string] 列表 / 成排的小图（§seedTargetsOf），和按站里资料播的列表（§factListsOf）。
      seedTargets: seedTargetsOf(m, type),
      factLists: factListsOf(m),
      carried: Object.keys(m.slots || {}).filter((s) => !fieldSlots.has(s)),
      shapes,
      defaultShape: shapeForBlock({ type, data: {} }, selection, manifestsObj, () => {}) || null,
      // #1443 —— 画布上「跟着主题走」的块戴哪个形态，要拿这个块**当前的** data 现算（`editor-convert.js`
      // §canvasShape）：`defaultShape` 是按空 data 塌缩过的，needs 门控的形态（hero 的 media-*、
      // content-split 的四个）在它里面已经落回了默认。所以把塌缩之前的两格原料也交出去。
      themeShape: typeof selection[type] === 'string' && selection[type] ? selection[type] : null,
      fallbackShape: defaultShapeOf(m) || null,
      // #1839 —— 退役 = 只是不可添加（§editor-convert.js categoriesOf 把它放进藏起来的那一格），已有的照画、照编。
      retired: m.retired === true,
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
    // #1738 —— 顶栏 / 页脚在 Design 面板里的那两格：预设 + 旋钮（`control: 'options'`）和底色（`control: 'color'`），
    //    跟页面块同一个 §fieldsOf 算（manifest 取 catalog 里解析过 `ref` 的那份 —— `bg` 是 `{ ref: 'bg' }`）。
    regions: Object.fromEntries(['header', 'footer'].map((r) => {
      const m = catalog.manifests.get(r);
      const fields = m ? fieldsOf(m) : [];
      return [r, {
        label: m && typeof m.displayName === 'string' && m.displayName ? m.displayName : r,
        preset: fields.find((f) => f.control === 'options' && (f.presets || []).length) || null,
        bg: fields.find((f) => f.control === 'color' && f.slot === 'bg') || null,
      }];
    })),
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
// #1693 —— 「一个位置一张图」的那 4 条（features / gallery / team / testimonials 每项的图）有格子了，从名单里删掉。
// #1694 —— 成排的图（logo 一排、hero 的 band、点评平台 logo）那 6 条也有格子了，删掉；名单里不再有图片。
const ITEM_FIELD_EXEMPT = Object.freeze({
  ...Object.fromEntries(['content.ctas', 'cta.ctas', 'features.introCtas', 'hero.ctas', 'milestones.introCtas', 'page-header.ctas']
    .flatMap((l) => ['style', 'icon', 'arrow', 'size'].map((f) => [`${l}.${f}`, BUTTON_STYLE]))),
  'features.items.icon': ICON,
  'milestones.stats.icon': ICON,
  'pricing.highlights.icon': ICON,
  'pricing.plans.featured': '「推荐套餐」高亮开关，是样式',
  'team.members.links': '成员的社交图标链接，是图标',
});

/**
 * #1686 —— 每份非 region manifest 的每个列表槽，项形状里的每个顶层字段（含可选的）：要么在编辑器 schema 里有一格
 * （这个槽位的字段里有同名的 `sub`），要么在豁免名单里。§slotCoverageProblems 只管槽位这一层 —— 价格块的 `plans`
 * 有格子它就算过了，项里漏掉的 `features` / `cta` 没人报（#1686 的病根）。
 * #1694 —— 对象里包着的列表（`pricing.logos` 的 `items: [{imageUrl, alt}]`、`proof.avatars`）同一条规则，条目写成
 * `<块>.<槽>.<列表>.<字段>`：这个槽位的对象字段里那个列表子字段（同名 `sub`）的 `subs` 里有它，或者在名单里。
 * 只认 `kind: list` 的那一版对这一层按构造失明（`pricing.logos.items` 一格都没有也报 0）。
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
      if (!spec) continue;
      const field = c && c.fields.find((f) => f.slot === slot);
      const lists = spec.kind === 'list'
        ? [{ prefix: `${type}.${slot}`, itemShape: spec.shape, subs: (field && field.subs) || [] }]
        : objectListsOf(spec).map((l) => {
          const holder = ((field && field.subs) || []).find((x) => x.sub === l.key);
          return { prefix: `${type}.${slot}.${l.key}`, itemShape: l.itemShape, subs: (holder && holder.subs) || [] };
        });
      for (const { prefix, itemShape, subs: cells } of lists) {
        const subs = new Set(cells.map((x) => x.sub));
        for (const { key } of itemShapeEntries(itemShape)) {
          const id = `${prefix}.${key}`;
          const excused = Object.prototype.hasOwnProperty.call(exempt, id);
          if (excused) seen.add(id);
          if (subs.has(key)) { if (excused) out.push(`${id}（有格子，却还在豁免名单里）`); continue; }
          if (!excused) out.push(id);
        }
      }
    }
  }
  for (const id of Object.keys(exempt)) if (!seen.has(id)) out.push(`${id}（豁免名单里有，列表项形状里没有这个字段）`);
  return out;
}

module.exports = { editorSchema, fieldsOf, isOneImage, imageCellOf, slotCoverageProblems, itemFieldCoverageProblems, ITEM_FIELD_EXEMPT, itemTopKeys, itemShapeEntries, inlineSlotsOf, isFactSlot, seedListsOf, SEED_ITEMS, LINK_HREF,
  seedCellsOf, seedTargetsOf, seedExemptOf, factListsOf, SEED_KINDS, SEED_EXEMPT, SEED_EXCLUDED_BLOCKS, NUMBER_EXAMPLES, SEED_ICONS, TWO_BUTTON_BLOCKS, FACT_KINDS };
