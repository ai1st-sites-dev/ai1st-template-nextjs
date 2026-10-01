'use strict';

const { isColorValue, normalizeBg } = require('./contrast');

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-knobs.js —— 「预设 + 旋钮 + Custom」这套机制的纯函数（#1463 建，T3 给 header / footer 复用）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// manifest 里的声明（位置 PM #1463 r3 冻死，#1462 的 Go 那一侧读同一份）：
//   · `slots.options.knobs`  数组，**顺序 = 控件顺序**；每项 `{ name, values: [...] }`，`values[0]` 是默认。
//                            布尔开关（`icons` / `topbar`）不进 knobs，照旧写在 `slots.options.shape` 那串
//                            `"{…, icons: bool}"` 里。
//   · 顶层 `presets`         `[{ name, shape, knobs: { … }, options?: { <布尔>: true | false } }]`。`name` 是显示名，
//                            `shape` 是形态目录名。#1468 起预设也能带布尔（header-new 的 `topbar`）：有预设写了的
//                            那几个布尔「归预设管」—— 写了就每个预设都要写，判「一模一样」「是哪个预设」都连它一起比；
//                            没有预设写的（dark / icons）不参与，点预设也不动它们。
//
//   · 预设的 `colors`（#1483，Chris 2026-09-29 为 pricing 的 Rainbow 破例）：`{ <颜色槽名>: <颜色值> }`，可选。
//                            有预设写了的那几个颜色槽「归预设管」：判「是哪个预设」时，写了 `colors` 的预设要颜色
//                            也对上（按 `contrast.js` §normalizeBg 之后比），而且它**先于**没写颜色的预设判 ——
//                            对上了 Rainbow 就不亮 Plan cards；颜色一改就回落到 Plan cards（它不看颜色）。
//                            点一个预设（§presetColors）：写了颜色的设上，没写的把归预设管的颜色槽恢复成空。
//                            没有预设写 `colors` 的块（hero / cta / features / milestones）一个字都不受影响。
//
//   · 预设的 `parts`（#1487，Chris 2026-09-29 为 team 的 Hiring 要的：这个预设的意思就是「带招聘卡」）：`["join"]`，可选，
//                            名字必须在顶层 `parts` 里、那个槽要有 `demo`。跟 `colors` 同一个声明族：
//                            判「是哪个预设」时写了 `parts` 的预设要那些部件**也有内容**（§partFilled）才亮，而且跟带颜色的预设
//                            一起**先**判；点它（§presetPartFills）时部件是空的就用槽的 `demo` 填上，已有内容不动；
//                            点别的预设**不删**部件内容（部件是内容，点预设只改排法 —— 跟颜色不同，颜色会被恢复成空）。
//
// 旋钮值只存一处：页面 JSON 的 `data.options.<旋钮名>`（PM r3 定：`image.mode` / `form.style` 那两份副本作废）。
// 颜色值也只存一处：`data.<颜色槽名>`（不在 options 里）。判预设时调用方把它们按槽名并进 `values`。
//
// 🔴 **Section 和编辑器共用这几个函数**：「实际生效的旋钮」「这组旋钮是哪个预设 / 还是 custom」
//    两边各算一遍的话，编辑器会说 Split、页面却排成 Centered，而两边都不会红。

/** manifest 声明的旋钮（没有就是空数组）。 */
function knobsOf(manifest) {
  const k = manifest && manifest.slots && manifest.slots.options && manifest.slots.options.knobs;
  return Array.isArray(k) ? k.filter((x) => x && typeof x.name === 'string' && Array.isArray(x.values)) : [];
}

/** manifest 声明的预设（没有就是空数组）。 */
function presetsOf(manifest) {
  return Array.isArray(manifest && manifest.presets) ? manifest.presets : [];
}

/** `options.shape` 那串里的布尔修饰名（`"{reverse: bool}"` → `['reverse']`）。 */
function booleanOptionsOf(manifest) {
  const s = manifest && manifest.slots && manifest.slots.options && manifest.slots.options.shape;
  return typeof s === 'string' ? Array.from(s.matchAll(/(\w+)\s*:\s*bool/g)).map((x) => x[1]) : [];
}

/** 归预设管的布尔：有预设在 `options` 里写了的那几个，按 `options.shape` 里的声明顺序（#1468）。 */
function presetBooleansOf(manifest) {
  const written = new Set();
  for (const p of presetsOf(manifest)) {
    if (p && p.options && typeof p.options === 'object' && !Array.isArray(p.options)) for (const key of Object.keys(p.options)) written.add(key);
  }
  return booleanOptionsOf(manifest).filter((b) => written.has(b));
}

/** manifest 里 `kind: color` 的槽名，按声明顺序。 */
function colorSlotsOf(manifest) {
  const slots = (manifest && manifest.slots) || {};
  return Object.keys(slots).filter((s) => slots[s] && slots[s].kind === 'color');
}

/** 归预设管的颜色槽（#1483）：有预设在 `colors` 里写了的那几个，按槽的声明顺序。 */
function presetColorSlotsOf(manifest) {
  const written = new Set();
  for (const p of presetsOf(manifest)) {
    if (p && p.colors && typeof p.colors === 'object' && !Array.isArray(p.colors)) for (const key of Object.keys(p.colors)) written.add(key);
  }
  return colorSlotsOf(manifest).filter((s) => written.has(s));
}

/** 颜色值的比较键：归一化之后的形状（`#7D52F4` 与 `#7d52f4` 相同）；空 / 不合法 = ''。 */
function colorKey(v) {
  const n = normalizeBg(v);
  return n === null ? '' : typeof n === 'string' ? n : JSON.stringify(n);
}

/** 这个预设写的颜色（没写 = 空对象）。 */
function colorsOfPreset(p) {
  return p && p.colors && typeof p.colors === 'object' && !Array.isArray(p.colors) ? p.colors : {};
}

/** 这个预设要的部件（没写 = 空数组）。 */
function partsOfPreset(p) {
  return p && Array.isArray(p.parts) ? p.parts.filter((x) => typeof x === 'string' && x) : [];
}

/**
 * 一个部件「有内容」吗（#1487）：字符串非空；数组非空；对象里至少一个顶层字符串字段非空（`join` = title 或 body 有字，
 * 跟 team-new 的 Section 画不画招聘卡同一条判据 —— 只剩一个按钮的招聘卡不画，也就不算有）。
 */
function partFilled(v) {
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.values(v).some((x) => typeof x === 'string' && x.trim() !== '');
  return false;
}

/** 有预设在 `parts` 里写了的部件，按顶层 `parts` 的顺序（#1487）。 */
function presetPartsOf(manifest) {
  const written = new Set();
  for (const p of presetsOf(manifest)) for (const x of partsOfPreset(p)) written.add(x);
  const top = Array.isArray(manifest && manifest.parts) ? manifest.parts : [];
  return top.filter((x) => written.has(x));
}

/** 归预设管的部件各自的占位内容（槽的 `demo`，深拷贝）：`{ join: {...} }`；没有带部件的预设 ⟹ {}。 */
function presetPartDemosOf(manifest) {
  const slots = (manifest && manifest.slots) || {};
  const out = {};
  for (const x of presetPartsOf(manifest)) {
    if (slots[x] && slots[x].demo !== undefined) out[x] = JSON.parse(JSON.stringify(slots[x].demo));
  }
  return out;
}

/**
 * 点了预设 `name` 之后要补上的部件（#1487 规则 2）：`{ <部件>: <demo> }`，只含这个预设写了的部件。调用方只在那个部件
 * **没有内容**（§partFilled）时用它填；已有内容不动。别的预设 / 名字对不上 ⟹ {}（规则 3：点别的预设不删部件）。
 */
function presetPartFills(manifest, name) {
  const p = presetsOf(manifest).find((x) => x && x.name === name);
  const demos = presetPartDemosOf(manifest);
  return Object.fromEntries(partsOfPreset(p).filter((x) => x in demos).map((x) => [x, demos[x]]));
}

/**
 * 点了预设 `name` 之后，归预设管的颜色槽各该是什么（#1483 规则 2）：预设写了的 → 那个值（归一化后）；
 * 没写的 → null（= 恢复成空，调用方删掉这个键）。块里没有任何预设写 `colors` ⟹ 空对象（什么都不动）。
 * 名字对不上任何预设 ⟹ 空对象。
 */
function presetColors(manifest, name) {
  const owned = presetColorSlotsOf(manifest);
  const p = presetsOf(manifest).find((x) => x && x.name === name);
  if (!p || !owned.length) return {};
  const c = colorsOfPreset(p);
  return Object.fromEntries(owned.map((s) => [s, s in c ? normalizeBg(c[s]) : null]));
}

/**
 * #1483 —— Puck 侧栏里点一个预设之后，这一块的 props 变成什么（EditorApp 的 OptionsField 调它；编辑器字段 schema 的
 * `presets` / `colorSlots` 由 editor-schema.js 带下去）：
 *   · `options` 换成 `{ ...原来的, ...预设的旋钮 }`（同 #1463：别的键原样留着）
 *   · 归预设管的颜色槽按 §presetColors：预设写了 ⟹ 设上；没写 ⟹ 删掉（= 恢复成空，存盘时这个键被删）
 *   · 块里没有带颜色的预设（`colorSlots` 空）⟹ 颜色一个都不碰
 * 名字对不上任何预设 ⟹ 原样回。
 */
function presetClickProps(field, props, name) {
  const presets = (field && field.presets) || [];
  const p = presets.find((x) => x && x.name === name);
  if (!p) return props;
  const out = { ...props, options: { ...((props && props.options) || {}), ...p.knobs } };
  const colorSlots = (field && field.colorSlots) || [];
  const man = { slots: Object.fromEntries(colorSlots.map((s) => [s, { kind: 'color' }])), presets };
  for (const [slot, v] of Object.entries(presetColors(man, name))) {
    if (v === null) delete out[slot]; else out[slot] = v;
  }
  // #1487 —— 这个预设要的部件：空的用 `partDemos`（editor-schema.js 带下去的槽 `demo`）填上；已有内容 / 别的预设都不动。
  const demos = (field && field.partDemos) || {};
  for (const x of partsOfPreset(p)) {
    if (!partFilled(out[x]) && demos[x] !== undefined) out[x] = JSON.parse(JSON.stringify(demos[x]));
  }
  return out;
}

/**
 * 实际生效的旋钮：形态对应的那个预设给底，`options` 里写了、而且取值合法的逐个覆盖。
 * 形态不是任何预设的目录 ⟹ 每个旋钮从 `values[0]` 起。取值不合法 ⟹ 当没写（落回底）。
 */
function effectiveKnobs(manifest, shape, options) {
  const knobs = knobsOf(manifest);
  const preset = presetsOf(manifest).find((p) => p && p.shape === shape);
  const out = {};
  for (const k of knobs) {
    const fromPreset = preset && preset.knobs ? preset.knobs[k.name] : undefined;
    out[k.name] = k.values.includes(fromPreset) ? fromPreset : k.values[0];
    const v = options && typeof options === 'object' ? options[k.name] : undefined;
    if (k.values.includes(v)) out[k.name] = v;
  }
  return out;
}

/**
 * 归预设管的布尔的实际值（#1468）：形态对应的那个预设给底（形态不是预设的目录 ⟹ false），`options` 里写了
 * 布尔就覆盖。不归预设管的布尔（dark / icons）不在这里 —— 它们没有底，就是 `options` 里写的那个。
 */
function effectivePresetBooleans(manifest, shape, options) {
  const preset = presetsOf(manifest).find((p) => p && p.shape === shape);
  const out = {};
  for (const b of presetBooleansOf(manifest)) {
    out[b] = !!(preset && preset.options && preset.options[b] === true);
    const v = options && typeof options === 'object' ? options[b] : undefined;
    if (typeof v === 'boolean') out[b] = v;
  }
  return out;
}

/**
 * 这组值对得上哪个预设：对得上回那个预设对象，对不上回 null（= custom）。`values` 里是旋钮值，外加归预设管的
 * 布尔（没写 = false）；别的布尔在不在都不影响。
 * #1483 —— `values` 还可以带颜色槽的值（键 = 槽名，同 `data` 顶层）：写了 `colors` 的预设要它写的每个颜色都对上，
 * 而且先判；没写 `colors` 的预设不看颜色。调用方不带颜色 ⟹ 带颜色的预设永远对不上（回落到同排法的那个）。
 * #1487 —— 同一条路：`values` 还可以带部件的内容（键 = 部件名，同 `data` 顶层）：写了 `parts` 的预设要那些部件都有内容
 * （§partFilled），跟带颜色的一起先判；调用方不带部件 ⟹ 带部件的预设永远对不上。
 */
function presetFor(manifest, values) {
  const knobs = knobsOf(manifest);
  const bools = presetBooleansOf(manifest);
  const v = values || {};
  const layoutMatches = (p) => knobs.every((k) => p.knobs[k.name] === v[k.name])
    && bools.every((b) => (p.options || {})[b] === (v[b] === true));
  const presets = presetsOf(manifest).filter((p) => p && p.knobs);
  const colored = presets.filter((p) => Object.keys(colorsOfPreset(p)).length || partsOfPreset(p).length);
  for (const p of colored) {
    const c = colorsOfPreset(p);
    if (layoutMatches(p) && Object.keys(c).every((s) => colorKey(c[s]) !== '' && colorKey(c[s]) === colorKey(v[s]))
      && partsOfPreset(p).every((x) => partFilled(v[x]))) return p;
  }
  for (const p of presets) {
    if (!colored.includes(p) && layoutMatches(p)) return p;
  }
  return null;
}

/** `presetFor` 的名字版：预设的显示名，或 `'custom'`。 */
function presetNameFor(manifest, values) {
  const p = presetFor(manifest, values);
  return p ? p.name : 'custom';
}

/**
 * manifest 自己这份声明对不对（给 `block-manifest.js` 的校验与守卫用）。回字符串数组，空 = 对。
 *   · 旋钮名不重复、每个至少两个取值、取值不重复
 *   · 预设名、预设形态不重复；预设的 `shape` 必须是这个块真有的形态目录
 *   · 预设给**每一个**旋钮都写了合法取值（少写一个，「这组旋钮是哪个预设」就判不准）
 *   · 预设的 `options`（#1468）：键必须是 `options.shape` 里声明的 `: bool`、值只能是 true / false；
 *     有预设写了某个布尔，每个预设都要写
 *   · 两个预设的组合（旋钮 + 归预设管的布尔 + 颜色，#1483）不许一样（一样的话点哪个都显示成先声明的那个）
 *   · 预设的 `colors`（#1483）：键必须是本块 `kind: color` 的槽、值要过 `contrast.js` §isColorValue
 *   · 预设的 `parts`（#1487）：字符串数组；每个名字必须在顶层 `parts` 里，那个槽要有 `demo`（点预设时拿它填空的部件）
 */
function knobDeclarationProblems(manifest) {
  const out = [];
  const knobs = knobsOf(manifest);
  const presets = presetsOf(manifest);
  const shapes = new Set((manifest && Array.isArray(manifest.shapes) ? manifest.shapes : []).map((s) => s && s.name));
  const names = new Set();
  for (const k of knobs) {
    if (names.has(k.name)) out.push(`旋钮 "${k.name}" 声明了两次`);
    names.add(k.name);
    if (k.values.length < 2) out.push(`旋钮 "${k.name}" 只有 ${k.values.length} 个取值 —— 至少要两个`);
    if (new Set(k.values).size !== k.values.length) out.push(`旋钮 "${k.name}" 的取值有重复`);
  }
  if (presets.length && !knobs.length) out.push('写了 presets 却没有 slots.options.knobs —— 预设设的就是旋钮');
  const pNames = new Set();
  const pShapes = new Set();
  const combos = new Map();
  const booleans = booleanOptionsOf(manifest);
  const bools = presetBooleansOf(manifest);
  const colorSlots = colorSlotsOf(manifest);
  for (const [i, p] of presets.entries()) {
    if (!p || typeof p.name !== 'string' || !p.name) { out.push(`presets[${i}] 没有 name`); continue; }
    if (pNames.has(p.name)) out.push(`预设 "${p.name}" 声明了两次`);
    pNames.add(p.name);
    if (typeof p.shape !== 'string' || !p.shape) out.push(`预设 "${p.name}" 没有 shape（形态目录名）`);
    else {
      if (pShapes.has(p.shape)) out.push(`预设 "${p.name}" 的形态 "${p.shape}" 跟别的预设重了`);
      pShapes.add(p.shape);
      if (shapes.size && !shapes.has(p.shape)) out.push(`预设 "${p.name}" 的形态 "${p.shape}" 不是这个块的形态目录`);
    }
    for (const k of knobs) {
      const v = p.knobs ? p.knobs[k.name] : undefined;
      if (!k.values.includes(v)) out.push(`预设 "${p.name}" 的旋钮 "${k.name}" 是 ${JSON.stringify(v)} —— 只能是 ${k.values.join(' / ')}`);
    }
    for (const key of Object.keys(p.knobs || {})) {
      if (!names.has(key)) out.push(`预设 "${p.name}" 写了一个不存在的旋钮 "${key}"`);
    }
    const po = p.options;
    if (po !== undefined && (!po || typeof po !== 'object' || Array.isArray(po))) out.push(`预设 "${p.name}" 的 options 不是一个对象`);
    const pOpts = po && typeof po === 'object' && !Array.isArray(po) ? po : {};
    for (const [key, v] of Object.entries(pOpts)) {
      if (!booleans.includes(key)) out.push(`预设 "${p.name}" 的 options 写了 "${key}" —— 它不是 slots.options.shape 里声明的布尔（${booleans.join(' / ') || '一个都没有'}）`);
      else if (typeof v !== 'boolean') out.push(`预设 "${p.name}" 的 options.${key} 是 ${JSON.stringify(v)} —— 只能是 true / false`);
    }
    for (const b of bools) {
      if (!(b in pOpts)) out.push(`预设 "${p.name}" 没写 options.${b} —— 有预设写了它，每个预设都要写`);
    }
    const pc = p.colors;
    if (pc !== undefined && (!pc || typeof pc !== 'object' || Array.isArray(pc))) out.push(`预设 "${p.name}" 的 colors 不是一个对象`);
    const pColors = colorsOfPreset(p);
    for (const [key, v] of Object.entries(pColors)) {
      if (!colorSlots.includes(key)) out.push(`预设 "${p.name}" 的 colors 写了 "${key}" —— 它不是这个块 kind: color 的槽（${colorSlots.join(' / ') || '一个都没有'}）`);
      else if (!isColorValue(v)) out.push(`预设 "${p.name}" 的 colors.${key} 是 ${JSON.stringify(v)} —— 不是合法的颜色值（#rrggbb / brand / {stops, angle}）`);
    }
    if (p.parts !== undefined && (!Array.isArray(p.parts) || p.parts.some((x) => typeof x !== 'string' || !x))) out.push(`预设 "${p.name}" 的 parts 不是一个字符串数组`);
    const pParts = partsOfPreset(p);
    const topParts = Array.isArray(manifest && manifest.parts) ? manifest.parts : [];
    const slotSpecs = (manifest && manifest.slots) || {};
    for (const x of pParts) {
      if (!topParts.includes(x)) out.push(`预设 "${p.name}" 的 parts 写了 "${x}" —— 它不在这个块顶层的 parts 里（${topParts.join(' / ') || '一个都没有'}）`);
      else if (!slotSpecs[x] || !partFilled(slotSpecs[x].demo)) out.push(`预设 "${p.name}" 的 parts 写了 "${x}"，但 slots.${x} 没有 demo —— 点这个预设时拿它填空的部件`);
    }
    const combo = knobs.map((k) => (p.knobs || {})[k.name]).concat(bools.map((b) => String(pOpts[b])))
      .concat(Object.keys(pColors).sort().map((key) => `${key}=${colorKey(pColors[key])}`))
      .concat(pParts.slice().sort().map((x) => `part=${x}`)).join('|');
    if (combos.has(combo)) out.push(`预设 "${p.name}" 跟 "${combos.get(combo)}" 的组合（旋钮${bools.length ? ' + ' + bools.join(' / ') : ''}${Object.keys(pColors).length ? ' + 颜色' : ''}${pParts.length ? ' + 部件' : ''}）一模一样`);
    else combos.set(combo, p.name);
  }
  return out;
}

module.exports = {
  knobsOf, presetsOf, booleanOptionsOf, presetBooleansOf, effectiveKnobs, effectivePresetBooleans, presetFor, presetNameFor,
  knobDeclarationProblems, colorSlotsOf, presetColorSlotsOf, presetColors, presetClickProps,
  partFilled, presetPartsOf, presetPartDemosOf, presetPartFills,
};
