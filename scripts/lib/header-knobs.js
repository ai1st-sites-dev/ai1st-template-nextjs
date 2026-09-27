'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// header-knobs.js —— 预设 + 旋钮的几个纯函数（#1462）：纠正不成立的组合、认出是哪个预设
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 块自己在 manifest 里声明，这里一样都不写死。位置是 PM 2026-09-27 19:01 冻结的那份（#1462 / #1463 两张票
// 共用同一套读者，写成别的形状就是两边分叉）：
//   · 旋钮：`slots.options.knobs: [{ name, values: [...] }]`，**顺序 = 控件顺序**。布尔修饰（dark / icons /
//     reverse）不是旋钮，照旧只写在 `slots.options.shape` 那串里；
//   · 预设：顶层 `presets: [{ name, shape, knobs: { <旋钮>: <值>, … } }]`。`name` 是显示名，`shape` 是形态
//     目录名（header 两者同名，hero 不同名）；
//   · 耦合（可选，header 有、hero 可以没有）：顶层 `knobCoupling: [甲, 乙]` —— 这两个旋钮的组合**必须在某个
//     预设里出现过**，否则不成立。header 是 `["logo", "menu"]`：logo=center 只能配 split / gathered / below，
//     logo=left 只能配 right / center（Chris 2026-09-27 定稿第 2 版）。topbar 不参与。
//   认不出的形状一律读成「没有」（空数组 / null），不抛：admin 那一页不该因为一个块写错了就整页倒下。
//
// 🔴 纠正时**谁让步**看刚拧的是哪一个（跟图册 `build.py` §constrain 同一套）：拧了乙 ⟹ 甲跟着改；
//    其余情况（拧了甲、或者不知道拧了谁 —— Section 渲染时就是这样）⟹ 乙跟着改。改成的值取「第一个
//    与保留方值相同的预设」里那个值：logo=center + menu=right ⟹ 第一个 logo=center 的预设是
//    logo-center-split ⟹ menu=split（验收 3）。
//
// 🔴 这份逻辑在 dashboard 里有一份 TS 抄写（`dashboard/src/pages/admin/catalogKnobs.ts`）：admin
//    是另一个构建，引不到模板里的文件。两份都只吃 manifest 给的数据，改算法要两边一起改。

const isStr = (v) => typeof v === 'string' && v.length > 0;

/** manifest → `[{ name, values }]`，按声明顺序（= 工具栏顺序）；写坏的项跳过。 */
function knobsOf(manifest) {
  const opt = manifest && manifest.slots && manifest.slots.options;
  const list = opt && Array.isArray(opt.knobs) ? opt.knobs : [];
  return list
    .filter((k) => k && isStr(k.name) && Array.isArray(k.values) && k.values.length && k.values.every(isStr))
    .map((k) => ({ name: k.name, values: [...k.values] }));
}

/** manifest → `[{ name, shape, knobs }]`；写坏的项跳过（可选的额外字段原样留着，消费端不认就不看）。 */
function presetsOf(manifest) {
  const list = manifest && Array.isArray(manifest.presets) ? manifest.presets : [];
  return list.filter((p) => p && isStr(p.name) && isStr(p.shape) && p.knobs && typeof p.knobs === 'object' && !Array.isArray(p.knobs));
}

function couplingOf(manifest) {
  const c = manifest && manifest.knobCoupling;
  return Array.isArray(c) && c.length === 2 && c.every(isStr) ? c : null;
}

/** 预设名 → 那个预设的旋钮值（副本）；不认识就 null。 */
function presetKnobs(presets, name) {
  const p = presets.find((x) => x.name === name);
  return p ? { ...p.knobs } : null;
}

/** 形态目录名 → 那个预设（一个目录一个预设）；不认识就 null。 */
function presetForShape(presets, shape) {
  return presets.find((x) => x.shape === shape) || null;
}

/**
 * 纠正。`values` 里认不出的值（不在值域里、或者缺）先落回 `base`（没给 base 就落回第一个预设）；
 * 然后按 §文件头 那条规则把耦合的两个旋钮拧成一个成立的组合。回一个新对象，不改入参。
 */
function normalizeKnobs(values, { knobs, presets, coupling, changed, base } = {}) {
  const fallback = base || (presets[0] ? { ...presets[0].knobs } : {});
  const out = {};
  for (const k of knobs) {
    const v = values && values[k.name];
    out[k.name] = k.values.includes(v) ? v : (k.values.includes(fallback[k.name]) ? fallback[k.name] : k.values[0]);
  }
  if (coupling) {
    const [a, b] = coupling;
    const holds = presets.some((p) => p.knobs[a] === out[a] && p.knobs[b] === out[b]);
    if (!holds) {
      const keep = changed === b ? b : a;
      const give = keep === a ? b : a;
      const donor = presets.find((p) => p.knobs[keep] === out[keep]);
      if (donor && donor.knobs[give] !== undefined) out[give] = donor.knobs[give];
    }
  }
  return out;
}

/** 旋钮值跟哪个预设逐个吻合就回它的名，都对不上回 `custom`。 */
function presetOf(values, { knobs, presets }) {
  const hit = presets.find((p) => knobs.every((k) => p.knobs[k.name] === values[k.name]));
  return hit ? hit.name : 'custom';
}

module.exports = { knobsOf, presetsOf, couplingOf, presetKnobs, presetForShape, normalizeKnobs, presetOf };
