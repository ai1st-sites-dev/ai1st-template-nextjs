'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// block-knobs.js —— 「预设 + 旋钮 + Custom」这套机制的纯函数（#1463 建，T3 给 header / footer 复用）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// manifest 里的声明（位置 PM #1463 r3 冻死，#1462 的 Go 那一侧读同一份）：
//   · `slots.options.knobs`  数组，**顺序 = 控件顺序**；每项 `{ name, values: [...] }`，`values[0]` 是默认。
//                            布尔修饰（`reverse`）不进 knobs，照旧写在 `slots.options.shape` 那串
//                            `"{…, reverse: bool}"` 里（header-new 今天就是这么写的）。
//   · 顶层 `presets`         `[{ name, shape, knobs: { … } }]`。`name` 是显示名，`shape` 是形态目录名。
//
// 旋钮值只存一处：页面 JSON 的 `data.options.<旋钮名>`（PM r3 定：`image.mode` / `form.style` 那两份副本作废）。
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

/** 这组旋钮对得上哪个预设：对得上回那个预设对象，对不上回 null（= custom）。 */
function presetFor(manifest, knobValues) {
  const knobs = knobsOf(manifest);
  for (const p of presetsOf(manifest)) {
    if (!p || !p.knobs) continue;
    if (knobs.every((k) => p.knobs[k.name] === (knobValues || {})[k.name])) return p;
  }
  return null;
}

/** `presetFor` 的名字版：预设的显示名，或 `'custom'`。 */
function presetNameFor(manifest, knobValues) {
  const p = presetFor(manifest, knobValues);
  return p ? p.name : 'custom';
}

/**
 * manifest 自己这份声明对不对（给 `block-manifest.js` 的校验与守卫用）。回字符串数组，空 = 对。
 *   · 旋钮名不重复、每个至少两个取值、取值不重复
 *   · 预设名、预设形态不重复；预设的 `shape` 必须是这个块真有的形态目录
 *   · 预设给**每一个**旋钮都写了合法取值（少写一个，「这组旋钮是哪个预设」就判不准）
 *   · 两个预设的旋钮组合不许一样（一样的话点哪个都显示成先声明的那个）
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
    const combo = knobs.map((k) => (p.knobs || {})[k.name]).join('|');
    if (combos.has(combo)) out.push(`预设 "${p.name}" 跟 "${combos.get(combo)}" 的旋钮组合一模一样`);
    else combos.set(combo, p.name);
  }
  return out;
}

module.exports = {
  knobsOf, presetsOf, booleanOptionsOf, effectiveKnobs, presetFor, presetNameFor, knobDeclarationProblems,
};
