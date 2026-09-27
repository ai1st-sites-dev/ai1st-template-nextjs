'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// header-knobs.js —— 预设 + 旋钮的两个纯函数（#1462）：纠正不成立的组合、认出是哪个预设
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 块自己在 manifest 里声明三样东西，这里一样都不写死：
//   · 旋钮和值域：`slots.options.shape` 里的 `名: "a" | "b"`（§knobsOf 解析；布尔开关不是旋钮）；
//   · 预设：顶层 `presets: [{ name, <旋钮>: <值>, … }]` —— 预设就是旋钮组合起的名；
//   · 耦合：顶层 `knobCoupling: [甲, 乙]` —— 这两个旋钮的组合**必须在某个预设里出现过**，否则不成立。
//     header 是 `["logo", "menu"]`：logo=center 只能配 split / gathered / below，logo=left 只能配
//     right / center（Chris 2026-09-27 定稿第 2 版）。topbar 不参与：它跟两者任意组合都成立。
//
// 🔴 纠正时**谁让步**看刚拧的是哪一个（跟图册 `build.py` §constrain 同一套）：拧了乙 ⟹ 甲跟着改；
//    其余情况（拧了甲、或者不知道拧了谁 —— Section 渲染时就是这样）⟹ 乙跟着改。改成的值取「第一个
//    让步方值与保留方相同的预设」里那个值：logo=center + menu=right ⟹ 第一个 logo=center 的预设是
//    logo-center-split ⟹ menu=split（验收 3）。
//
// 🔴 这份逻辑在 dashboard 里有一份 TS 抄写（`dashboard/src/pages/admin/catalogKnobs.ts`）：admin
//    是另一个构建，引不到模板里的文件。两份都只吃 manifest 给的数据，改算法要两边一起改。

/** manifest → `[{ name, values }]`，按 shape 串里出现的顺序（= 工具栏上的顺序）。 */
function knobsOf(manifest) {
  const slots = (manifest && manifest.slots) || {};
  const shape = slots.options && typeof slots.options.shape === 'string' ? slots.options.shape : '';
  return Array.from(shape.matchAll(/(\w+)\s*:\s*((?:"[a-z0-9-]+"\s*\|?\s*)+)/g)).map((m) => ({
    name: m[1],
    values: Array.from(m[2].matchAll(/"([a-z0-9-]+)"/g)).map((q) => q[1]),
  }));
}

function presetsOf(manifest) {
  return manifest && Array.isArray(manifest.presets) ? manifest.presets : [];
}

function couplingOf(manifest) {
  const c = manifest && manifest.knobCoupling;
  return Array.isArray(c) && c.length === 2 ? c : null;
}

/** 名字 → 那个预设的旋钮值；不认识就 null。 */
function presetKnobs(presets, name) {
  const p = presets.find((x) => x.name === name);
  if (!p) return null;
  const { name: _n, ...knobs } = p;
  return knobs;
}

/**
 * 纠正。`values` 里认不出的值（不在值域里、或者缺）先落回 `base`（没给 base 就落回第一个预设）；
 * 然后按 §文件头 那条规则把耦合的两个旋钮拧成一个成立的组合。回一个新对象，不改入参。
 */
function normalizeKnobs(values, { knobs, presets, coupling, changed, base } = {}) {
  const fallback = base || (presets[0] ? presetKnobs(presets, presets[0].name) : {}) || {};
  const out = {};
  for (const k of knobs) {
    const v = values && values[k.name];
    out[k.name] = k.values.includes(v) ? v : (k.values.includes(fallback[k.name]) ? fallback[k.name] : k.values[0]);
  }
  if (coupling) {
    const [a, b] = coupling;
    const holds = presets.some((p) => p[a] === out[a] && p[b] === out[b]);
    if (!holds) {
      const keep = changed === b ? b : a;
      const give = keep === a ? b : a;
      const donor = presets.find((p) => p[keep] === out[keep]);
      if (donor) out[give] = donor[give];
    }
  }
  return out;
}

/** 旋钮值跟哪个预设逐个吻合就回它的名，都对不上回 `custom`。 */
function presetOf(values, { knobs, presets }) {
  const hit = presets.find((p) => knobs.every((k) => p[k.name] === values[k.name]));
  return hit ? hit.name : 'custom';
}

module.exports = { knobsOf, presetsOf, couplingOf, presetKnobs, normalizeKnobs, presetOf };
