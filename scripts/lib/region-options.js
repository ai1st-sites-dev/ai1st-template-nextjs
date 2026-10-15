'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// region-options.js —— 顶栏 / 页脚的「底色 + 旋钮」：整站一份，存 `site/theme.json` 的 `regionOptions.<区>`（#1738）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 形状（跟编辑器 root 上的 `headerOptions` / `footerOptions` 是同一个对象，分派表 `editor-root-fields.js`）：
//   regionOptions.header = { bg?, logo?, menu?, topbar?, icons? }
//   regionOptions.footer = { bg?, layout?, brand?, form? }
// 键的名单一个都不写在这里：旋钮 / 布尔从块自己的 manifest 现取（`slots.options.knobs` / `slots.options.shape` 里的
// `: bool`），底色是 `slots.bg`（值的形状归 `contrast.js` §normalizeBg）。预设（= 形态）不在这里 —— 它是
// `regionLayout.<区>`（`editor-root-fields.js` 的 headerShape / footerShape 那两行）。
//
// 三边读同一份函数（纯函数、不读文件，浏览器也能引）：
//   · 构建（`site-regions.js` §resolveSiteRegionLayout → `regions.<区>.options`）
//   · 写盘（`editor-root.js` §checkShape 用 §regionOptionsProblems 判形状）
//   · 编辑器 / 外壳（`SiteShell.tsx` 用 §applyRegionOptions 叠进 data；Design 面板用其余几个）
// 🔴 两边各写一份就会分叉：编辑器说 Logo center，站上画成 left，而两边都不会红。

const { normalizeBg } = require('./contrast');
const { knobsOf, presetsOf, couplingOf, presetForShape, presetBooleansOf, normalizeKnobs, presetOf } = require('./header-knobs');
const { booleanOptionsOf } = require('./block-knobs');
const headerManifest = require('../../blocks/header/manifest.json');
const footerManifest = require('../../blocks/footer/manifest.json');

const MANIFESTS = { header: headerManifest, footer: footerManifest };
const REGIONS = Object.keys(MANIFESTS);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function spec(region) {
  const m = MANIFESTS[region];
  if (!m) return null;
  const presets = presetsOf(m);
  return { manifest: m, knobs: knobsOf(m), booleans: booleanOptionsOf(m), presets, coupling: couplingOf(m), owned: presetBooleansOf(presets) };
}

/**
 * 这一份里哪几格不对（空数组 = 对）：不认识的键、旋钮值不在值域里、布尔不是 true / false、底色不是合法颜色。
 * 写盘那一侧据它拒收（不是编辑器发得出来的东西），构建那一侧据 §cleanRegionOptions 丢掉坏的那几格。
 */
function regionOptionsProblems(region, v) {
  const s = spec(region);
  if (!s) return [`不认识的区：${JSON.stringify(region)}`];
  if (!isObj(v)) return [`${region} 的 options 必须是一个对象`];
  const out = [];
  for (const [k, val] of Object.entries(v)) {
    const knob = s.knobs.find((x) => x.name === k);
    if (k === 'bg') { if (normalizeBg(val) === null) out.push(`${region}.bg 不是合法颜色：${JSON.stringify(val)}`); }
    else if (knob) { if (!knob.values.includes(val)) out.push(`${region}.${k} 只能是 ${knob.values.join(' / ')}：${JSON.stringify(val)}`); }
    else if (s.booleans.includes(k)) { if (typeof val !== 'boolean') out.push(`${region}.${k} 只能是 true / false：${JSON.stringify(val)}`); }
    else out.push(`${region} 的 options 里有不认识的键：${JSON.stringify(k)}`);
  }
  return out;
}

/**
 * 只留合法的那几格（底色归一化成 §normalizeBg 的形状）；不是对象 ⟹ `{}`。
 * 🔴 #1788 —— 给了 `shape`（构建那一侧，§readRegionOptions）时，耦合里**第二个旋钮**存着值域外的字符串（顶栏 menu：被删掉的旧值、
 *    手写坏的）不丢，而是就地纠正成它该是的那个值（`header-knobs.js` §normalizeKnobs：跟第一个旋钮走，logo=center ⟹ left）。
 *    丢掉的话它就落回形态那个预设（形态 stacked ⟹ below），外壳和编辑器的 Customize 都读这一份，两边一起错。
 *    纠正成合法值写进这一份，编辑器以后存盘写回的也是合法值（写盘那一侧 §regionOptionsProblems 照旧拒收值域外的）。
 */
function cleanRegionOptions(region, v, shape) {
  const s = spec(region);
  if (!s || !isObj(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    const knob = s.knobs.find((x) => x.name === k);
    if (k === 'bg') { const bg = normalizeBg(val); if (bg !== null) out.bg = bg; }
    else if (knob) { if (knob.values.includes(val)) out[k] = val; }
    else if (s.booleans.includes(k) && typeof val === 'boolean') out[k] = val;
  }
  const second = s.coupling && s.knobs.find((x) => x.name === s.coupling[1]);
  if (shape !== undefined && second && typeof v[second.name] === 'string' && !second.values.includes(v[second.name])) {
    out[second.name] = effectiveRegionKnobs(region, shape, { ...out, [second.name]: v[second.name] })[second.name];
  }
  return out;
}

/**
 * `theme.json` 解析后的那个对象 → `{ header, footer }`，各是清洗过的一份（没写 = `{}`）。
 * `shapes` = 各区实际用的形态（`{ header: 'stacked', … }`）—— 纠正值域外的耦合旋钮要用（§cleanRegionOptions）。
 */
function readRegionOptions(themeMeta, shapes = {}) {
  const raw = isObj(themeMeta) && isObj(themeMeta.regionOptions) ? themeMeta.regionOptions : {};
  return Object.fromEntries(REGIONS.map((r) => [r, cleanRegionOptions(r, raw[r], isObj(shapes) ? shapes[r] : undefined)]));
}

/**
 * 外壳 data（`shell-data.js` 派生的那一份）叠上这一区的底色 + 旋钮：`bg` 换成存下的那个，旋钮 / 布尔并进 `data.options`。
 * 没存东西 ⟹ 原样回（同一个对象），站上一个字节不变。
 */
function applyRegionOptions(data, opts) {
  if (!isObj(opts) || !Object.keys(opts).length) return data;
  const { bg, ...knobs } = opts;
  const out = { ...(isObj(data) ? data : {}) };
  if (bg !== undefined) out.bg = bg;
  if (Object.keys(knobs).length) out.options = { ...(isObj(out.options) ? out.options : {}), ...knobs };
  return out;
}

/**
 * 实际生效的旋钮 + 归预设管的布尔：形态（= 预设）给底，存下的那几格盖上去，再纠正一次 —— 跟两个块的 Section §resolveKnobs
 * 同一条路（同一份 `header-knobs.js`）。
 */
function effectiveRegionKnobs(region, shape, opts) {
  const s = spec(region);
  if (!s) return {};
  const hit = presetForShape(s.presets, shape) || s.presets[0] || null;
  const base = hit ? { ...hit.knobs } : {};
  const o = isObj(opts) ? opts : {};
  const given = Object.fromEntries(s.knobs.filter((k) => o[k.name] !== undefined).map((k) => [k.name, o[k.name]]));
  const knobs = normalizeKnobs({ ...base, ...given }, { knobs: s.knobs, presets: s.presets, coupling: s.coupling, base });
  const bools = Object.fromEntries(s.owned.map((b) => [b, typeof o[b] === 'boolean' ? o[b] : !!(hit && hit.options && hit.options[b] === true)]));
  return { ...knobs, ...bools };
}

/** 这一区现在是哪个预设（对不上任何一个 = `custom`）。Design 面板 Layout 页亮哪一格就看它。 */
function regionPresetName(region, shape, opts) {
  const s = spec(region);
  if (!s) return 'custom';
  return presetOf(effectiveRegionKnobs(region, shape, opts), { knobs: s.knobs, presets: s.presets });
}

/**
 * Layout 页点了一个预设：形态换成它，存下的旋钮和归预设管的布尔清掉（= 照那个预设画）；底色和别的布尔（`icons`）留着。
 * 跟页面块点预设同一个意思（`block-knobs.js` §presetClickProps：排法整组换成预设的，颜色以外的不动）。
 * @returns {{ shape: string, options: object } | null}  名字对不上任何预设 ⟹ null
 */
function regionPresetPick(region, name, opts) {
  const s = spec(region);
  const p = s ? s.presets.find((x) => x.name === name) : null;
  if (!p) return null;
  const out = { ...(isObj(opts) ? opts : {}) };
  for (const k of s.knobs) delete out[k.name];
  for (const b of s.owned) delete out[b];
  return { shape: p.shape, options: out };
}

/**
 * Customize 页拧了一个旋钮 / 勾了一个布尔：先按「刚拧的是它」纠正耦合的那一对（顶栏 logo × menu，`header-knobs.js` 文件头），
 * 再把纠正后的整组旋钮写进去 —— 只写拧的那一个的话，渲染时按 logo 为准纠正，menu=below 会被改回 beside（#1738 验收 3）。
 */
function regionKnobChange(region, shape, opts, key, value) {
  const s = spec(region);
  const out = { ...(isObj(opts) ? opts : {}) };
  if (!s) return out;
  if (s.booleans.includes(key)) { out[key] = value === true; return out; }
  if (!s.knobs.some((k) => k.name === key)) return out;
  const cur = effectiveRegionKnobs(region, shape, opts);
  const knobs = normalizeKnobs({ ...cur, [key]: value }, { knobs: s.knobs, presets: s.presets, coupling: s.coupling, changed: key, base: cur });
  for (const k of s.knobs) out[k.name] = knobs[k.name];
  return out;
}

/**
 * Customize 页出哪几个旋钮：去掉「单凭它就认得出是哪个预设」的那一个（页脚的 `layout`：三个预设三个值，它就是预设本身，
 * 在 Layout 页选）。顶栏的 logo / menu 都不是（各预设里重复），全出。按谓词算，不写名单。
 */
function customizeKnobNames(region) {
  const s = spec(region);
  if (!s) return [];
  return s.knobs
    .filter((k) => !(s.presets.length > 1 && new Set(s.presets.map((p) => p.knobs[k.name])).size === s.presets.length))
    .map((k) => k.name);
}

module.exports = {
  REGIONS, regionOptionsProblems, cleanRegionOptions, readRegionOptions, applyRegionOptions,
  effectiveRegionKnobs, regionPresetName, regionPresetPick, regionKnobChange, customizeKnobNames,
};
