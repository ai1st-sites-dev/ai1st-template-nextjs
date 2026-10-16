'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// header-knobs.js —— 预设 + 旋钮的几个纯函数（#1462）：纠正不成立的组合、认出是哪个预设
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 块自己在 manifest 里声明，这里一样都不写死。位置是 PM 2026-09-27 19:01 冻结的那份（#1462 / #1463 两张票
// 共用同一套读者，写成别的形状就是两边分叉）：
//   · 旋钮：`slots.options.knobs: [{ name, values: [...] }]`，**顺序 = 控件顺序**。布尔开关（icons /
//     topbar）不是旋钮，照旧只写在 `slots.options.shape` 那串里；
//   · 预设：顶层 `presets: [{ name, shape, knobs: { <旋钮>: <值>, … }, options?: { <布尔>: true | false } }]`。
//     `name` 是显示名，`shape` 是形态目录名（header 两者同名，hero 不同名）。#1468：预设 `options` 里写了的布尔
//     「归预设管」（header 的 topbar）—— 判「是哪个预设」连它一起比；没有预设写的（icons）不参与；
//   · 🔴 #1784：**旋钮也按同一个办法分两类** —— 有预设在 `knobs` 里写到的归预设管；**没有任何预设写到的不归**
//     （header 的 logoType；#1784 r7 起 logoSize 是数字，改住 §numbersOf）。不归的那几个：判「是哪个预设」不比它、纠正时不碰它（不在耦合里）、
//     点预设时不清掉它（`region-options.js` §regionPresetPick）。判据只有 §presetKnobNamesOf 一处；
//   · 耦合（可选，header 有、hero 可以没有）：顶层 `knobCoupling: [甲, 乙]` —— 这两个旋钮的组合**必须在某个
//     预设里出现过**，否则不成立。header 是 `["logo", "menu"]`：logo=center 只能配 left / below（#1788），
//     logo=left / right 只能配 beside / center（#1468，Chris 2026-09-28）。
//     🔴 **没有任何预设用过的取值，耦合上按该旋钮的默认值（`default`，没写就是 `values[0]` —— #1481）算**（#1468）：六个预设里没有一个
//     logo=right，不这么算的话 logo=right 跟什么都「没出现过」、一律被纠正走。header 的 logo 默认是 left ⟹
//     logo=right 跟 left 配同一组 menu，让步时也从第一个 logo=left 的预设取值（logo=right + left ⟹ beside）。
//   认不出的形状一律读成「没有」（空数组 / null），不抛：admin 那一页不该因为一个块写错了就整页倒下。
//
// 🔴 纠正时**谁让步**看刚拧的是哪一个（跟图册 `build.py` §constrain 同一套）：拧了乙 ⟹ 甲跟着改；
//    其余情况（拧了甲、或者不知道拧了谁 —— Section 渲染时就是这样）⟹ 乙跟着改。改成的值取「第一个
//    与保留方值相同的预设」里那个值：logo=center + menu=beside ⟹ 第一个 logo=center 的预设是
//    logo-center ⟹ menu=left（#1462 验收 3，#1788 起）。
// 🔴 耦合里**第二个旋钮存着值域外的值**（header 的 menu：被删掉的旧值、手写坏的）⟹ 不落回形态那个预设，而是跟第一个
//    旋钮走 —— 取「第一个与它同值的预设」里那个值（#1788：logo=center ⟹ left，其余 ⟹ beside）。落回形态预设的话，
//    形态 stacked + 存着旧的 menu 就会画成 below，跟存的人想要的「logo 居中、菜单一整条」差得最远。
//
// 🔴 这份逻辑在 dashboard 里有一份 TS 抄写（`dashboard/src/pages/admin/catalogKnobs.ts`）：admin
//    是另一个构建，引不到模板里的文件。两份都只吃 manifest 给的数据，改算法要两边一起改。

const { knobDefault } = require('./block-knobs');

const isStr = (v) => typeof v === 'string' && v.length > 0;

/** manifest → `[{ name, values }]`，按声明顺序（= 工具栏顺序）；写坏的项跳过。 */
function knobsOf(manifest) {
  const opt = manifest && manifest.slots && manifest.slots.options;
  const list = opt && Array.isArray(opt.knobs) ? opt.knobs : [];
  return list
    .filter((k) => k && isStr(k.name) && Array.isArray(k.values) && k.values.length && k.values.every(isStr))
    .map((k) => ({
      name: k.name, values: [...k.values],
      ...(isStr(k.default) && k.values.includes(k.default) ? { default: k.default } : {}),
      ...(isStr(k.label) ? { label: k.label } : {}),   // #1784：面板上的名字（Logo position / Logo / Logo size）
    }));
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

/** 归预设管的旋钮（#1784）：有预设在 `knobs` 里写到的那几个旋钮名，按第一次出现的顺序。没写到的旋钮不归预设管（文件头）。 */
function presetKnobNamesOf(presets) {
  const out = [];
  for (const p of presets) for (const key of Object.keys(p.knobs)) if (!out.includes(key)) out.push(key);
  return out;
}

/** 归预设管的布尔（#1468）：有预设在 `options` 里写了的那几个键，按第一次出现的顺序。 */
function presetBooleansOf(presets) {
  const out = [];
  for (const p of presets) {
    const o = p.options && typeof p.options === 'object' && !Array.isArray(p.options) ? p.options : {};
    for (const key of Object.keys(o)) if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** 预设名 → 那个预设写的归预设管的布尔（副本，没写的当 false）；不认识就 null。 */
function presetBooleans(presets, name) {
  const p = presets.find((x) => x.name === name);
  if (!p) return null;
  return Object.fromEntries(presetBooleansOf(presets).map((b) => [b, !!(p.options && p.options[b] === true)]));
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
  const owned = presetKnobNamesOf(presets);
  const out = {};
  const unknown = new Set();
  for (const k of knobs) {
    const v = values && values[k.name];
    // #1784 —— 不归预设管的旋钮：合法就原样带着，不合法 / 没写就不出现（不替它编一个默认 —— logoType 的默认看 brand，`brand-logo.js`）。
    // 🔴 要排在下面那行前面：它们不在耦合里，不该进 #1788 的「值域外 ⟹ 跟第一个旋钮走」。
    if (!owned.includes(k.name)) { if (k.values.includes(v)) out[k.name] = v; continue; }
    if (!k.values.includes(v) && v !== undefined) unknown.add(k.name);
    out[k.name] = k.values.includes(v) ? v : (k.values.includes(fallback[k.name]) ? fallback[k.name] : knobDefault(k));
  }
  if (coupling) {
    const [a, b] = coupling;
    // 没有预设用过的取值按默认值算（文件头 🔴）。
    const as = (name) => {
      const v = out[name];
      if (presets.some((p) => p.knobs[name] === v)) return v;
      const k = knobs.find((x) => x.name === name);
      return k ? knobDefault(k) : v;
    };
    // 第二个旋钮存着值域外的值 ⟹ 跟第一个旋钮走（文件头 🔴，#1788）。
    if (unknown.has(b)) {
      const donor = presets.find((p) => p.knobs[a] === as(a));
      if (donor && donor.knobs[b] !== undefined) out[b] = donor.knobs[b];
    }
    const holds = presets.some((p) => p.knobs[a] === as(a) && p.knobs[b] === as(b));
    if (!holds) {
      const keep = changed === b ? b : a;
      const give = keep === a ? b : a;
      const donor = presets.find((p) => p.knobs[keep] === as(keep));
      if (donor && donor.knobs[give] !== undefined) out[give] = donor.knobs[give];
    }
  }
  return out;
}

/**
 * 旋钮值 + 归预设管的布尔（`values[<布尔>]`，没写 = false）跟哪个预设逐个吻合就回它的名，都对不上回 `custom`。
 * 别的布尔（dark / icons）在 `values` 里也不看。
 */
function presetOf(values, { knobs, presets }) {
  const bools = presetBooleansOf(presets);
  const owned = presetKnobNamesOf(presets);   // 不归预设管的旋钮（#1784，logoType）不比
  const hit = presets.find((p) => knobs.every((k) => !owned.includes(k.name) || p.knobs[k.name] === values[k.name])
    && bools.every((b) => !!(p.options && p.options[b] === true) === (values[b] === true)));
  return hit ? hit.name : 'custom';
}

/**
 * #1784 r7 —— 数字范围：`slots.options.numbers: [{ name, min, max, step, default, label? }]`（顶栏的 logoSize：图高 24–80px，步长 4）。
 * 旋钮只收字符串值（§knobsOf；Go 那一侧 `catalog_admin.go` 也是 `[]string`），连续的数字放不进去，所以单独声明一张。
 * 不归预设管（没有预设能写它）。写坏的项跳过：min ≤ default ≤ max、步长 > 0、default 落在步上。
 */
function numbersOf(manifest) {
  const opt = manifest && manifest.slots && manifest.slots.options;
  const list = opt && Array.isArray(opt.numbers) ? opt.numbers : [];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  return list
    .filter((r) => r && isStr(r.name) && num(r.min) && num(r.max) && num(r.step) && num(r.default) && r.step > 0
      && r.min <= r.default && r.default <= r.max && (r.default - r.min) % r.step === 0)
    .map((r) => ({ name: r.name, min: r.min, max: r.max, step: r.step, default: r.default, ...(isStr(r.label) ? { label: r.label } : {}) }));
}

/** 这个值落不落在范围里（整数步上，两端都算）。 */
function inRange(range, v) {
  return !!range && typeof v === 'number' && Number.isFinite(v) && v >= range.min && v <= range.max && (v - range.min) % range.step === 0;
}

module.exports = {
  numbersOf, inRange,
  knobsOf, presetsOf, couplingOf, presetKnobs, presetKnobNamesOf, presetBooleansOf, presetBooleans, presetForShape, normalizeKnobs, presetOf,
};
