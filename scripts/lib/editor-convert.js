'use strict';

// editor-convert.js —— 页面 JSON ⇄ Puck Data（#1404）。**纯函数、零 require**：编辑器页的服务端那一半
// （构建时）用它生成初始数据，客户端那一半（存盘时）用它写回，`editor-roundtrip.test.js` 在 node 里
// 用它跑往返守卫 —— 三处是同一份字节。
//
// ── 存盘的底一律是【文件里那一份】─────────────────────────────────────────────────────────────────
// config 里的页面是归一化之后的（`blocks.js` §normalizeLocalePages：共用块注进来、补 id / role /
// weight、按 weight 重排、列表槽位升格）。写回那一份就是把共用块抄进这一页、把老站形状静默改掉
// （`editor-page.js` 文件头）。所以每个 Puck 条目带着它在原始数组里的那一条（`_src.entry`），存盘
// 时只把字段上的值合回那一条，其余键原样。
//
// ── 一个 Puck 条目 ─────────────────────────────────────────────────────────────────────────────
//   { type, props: { id, <每个字段一个 prop>, _shape, _src } }
//   · 字段 prop 的值取自**原始** data（不是归一化后的）—— 往返无损的前提。
//   · `_shape`   形态下拉。
//   · `_src`     没有字段、老板改不到：
//       at       它在原始数组里的下标；-1 = 这一页的文件里没有它（按 `visibility` 注进来的共用块）
//       entry    原始那一条的副本（新插入的块没有 `_src`）
//       locked   共用块（`{ref}` 条目或 `visibility` 注入）—— 内容 / 位置归 #1406，这里只读、不许动
//       view     归一化之后的那一块（画布照它渲染：`data-shape` / `data-has-*` / 升格后的列表）
//       weight   它在构建里的有效权重（锁住的块拿它当锚点，见 §assignWeights）
//       shape0   画布一打开时它戴的形态（`_shape` 没改过就不写 `shape`，否则往返会多出一个键）
//       pid      打开时的 Puck id —— 复制出来的条目 id 不同，据此认出它是一个**新**块

const ITEM_ORIG = '__orig';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function has(o, k) {
  return isPlainObject(o) && Object.prototype.hasOwnProperty.call(o, k);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── 一个槽位的值 → Puck prop ──────────────────────────────────────────────────────────────────
function toProp(field, value) {
  switch (field.control) {
    case 'text':
      return value;
    case 'object': {
      const out = {};
      for (const { sub } of field.subs) out[sub] = isPlainObject(value) ? value[sub] : undefined;
      return out;
    }
    case 'list':
      // 每项整份带着（`id` / `rating` / `imageUrl` 这些没有字段的键也在里面），Puck 只编辑其中的 `sub`。
      // 不是对象的项（畸形数据）原样包起来，存盘时原样还原。
      return Array.isArray(value) ? value.map((it) => (isPlainObject(it) ? clone(it) : { [ITEM_ORIG]: clone(it) })) : [];
    case 'strings':
      return Array.isArray(value) ? value.map((it) => (typeof it === 'string' ? { value: it } : { [ITEM_ORIG]: clone(it) })) : [];
    default:
      throw new Error(`editor-convert: 不认识的控件 ${field.control}`);
  }
}

function emptyish(v) {
  return v === undefined || v === '' || v === null;
}

// ── Puck prop → 合回原始 data 的那一个槽位 ────────────────────────────────────────────────────
// 🔴 「原来没有这个键、现在是空的」一律不写 —— Puck 的输入框对 undefined 显示空串，老板点开又关掉
//    不该让文件多出一个 `"subheadline": ""`。
function mergeSlot(data, field, prop) {
  const slot = field.slot;
  const before = has(data, slot) ? data[slot] : undefined;
  let next;
  switch (field.control) {
    case 'text':
      if (deepEqual(prop, before)) return;
      if (emptyish(prop) && !has(data, slot)) return;
      data[slot] = prop === undefined ? '' : prop;
      return;
    case 'object': {
      const base = isPlainObject(before) ? { ...before } : {};
      let touched = false;
      for (const { sub } of field.subs) {
        const v = isPlainObject(prop) ? prop[sub] : undefined;
        if (deepEqual(v, base[sub])) continue;
        if (emptyish(v) && !has(base, sub)) continue;
        base[sub] = v === undefined ? '' : v;
        touched = true;
      }
      if (!touched) return;
      data[slot] = base;
      return;
    }
    case 'list':
      next = (Array.isArray(prop) ? prop : []).map((it) => {
        if (has(it, ITEM_ORIG)) return clone(it[ITEM_ORIG]);
        const out = {};
        for (const [k, v] of Object.entries(it || {})) {
          if (k.startsWith('_puck')) continue; // Puck 自己的簿记键（若有）不进文件
          out[k] = v;
        }
        return out;
      });
      break;
    case 'strings':
      next = (Array.isArray(prop) ? prop : []).map((it) => (has(it, ITEM_ORIG) ? clone(it[ITEM_ORIG]) : (it && typeof it.value === 'string' ? it.value : '')));
      break;
    default:
      throw new Error(`editor-convert: 不认识的控件 ${field.control}`);
  }
  if (deepEqual(next, before)) return;
  if (next.length === 0 && !has(data, slot)) return;
  data[slot] = next;
}

function schemaIndex(schema) {
  const m = new Map();
  for (const c of schema.components) m.set(c.type, c);
  return m;
}

/** 一条原始条目的字段 prop（给初始数据用，也给画布判「这个字段老板改过没有」用）。 */
function fieldProps(component, data) {
  const out = {};
  for (const f of component.fields) out[f.slot] = toProp(f, has(data, f.slot) ? data[f.slot] : undefined);
  return out;
}

/**
 * 字段 prop 合回一份 data，回新的一份（`base` 不动）。画布用它渲染老板改过的字段，跟存盘同一个合法。
 */
function dataFromProps(component, base, props) {
  const data = isPlainObject(base) ? clone(base) : {};
  for (const f of component.fields) mergeSlot(data, f, props[f.slot]);
  return data;
}

/**
 * 页面 JSON → Puck Data。
 *
 * @param {object}   args
 * @param {object}   args.raw      文件里那一份页面 JSON
 * @param {object[]} args.blocks   同一页归一化之后的块，**构建里的顺序**（画布顺序 = 页面顺序）
 * @param {Array<{at:number, writable:boolean, reason:string}>} args.located
 *                                 `editor-page.js` §locateInRaw 对 `blocks` 逐个的答案
 * @param {object}   args.schema   `editor-schema.js` §editorSchema 的产物
 * @param {number[]} [args.weights] 每块在构建里的有效权重（与 `blocks` 对齐）
 */
function pageToPuck({ raw, blocks, located, schema, weights }) {
  const idx = schemaIndex(schema);
  const arr = rawArray(raw);
  const content = [];
  blocks.forEach((view, i) => {
    const loc = located[i] || { at: -1, writable: false, reason: 'not-found' };
    const component = idx.get(view.type);
    if (!component) {
      throw new Error(`editor-convert: 页面上有块 ${JSON.stringify(view.type)}，编辑器的组件清单里没有它`);
    }
    const entry = loc.at >= 0 && arr ? arr[loc.at] : undefined;
    const locked = !loc.writable;
    // 锁住的块字段显示归一化后的内容（它的字不在这一页的文件里）；可写的块显示文件里的原值。
    const data = locked ? (view.data || {}) : ((entry && entry.data) || {});
    const pid = typeof view.id === 'string' && view.id ? view.id : `${view.type}-${i}`;
    const shape0 = typeof view.shape === 'string' && view.shape ? view.shape : (component.defaultShape || '');
    const item = {
      type: view.type,
      props: {
        id: pid,
        ...fieldProps(component, data),
        _shape: shape0,
        _src: {
          at: loc.at,
          entry: clone(entry === undefined ? null : entry),
          locked,
          reason: loc.reason || '',
          view: clone(view),
          weight: weights && typeof weights[i] === 'number' ? weights[i] : null,
          shape0,
          pid,
        },
      },
    };
    if (locked) {
      item.readOnly = { _shape: true };
      // 子字段要单独点名（Puck 的键：对象 `slot.sub`、数组每项 `slot[*].sub`），只锁顶层的话
      // 对象里的输入框照样能改。
      for (const f of component.fields) {
        item.readOnly[f.slot] = true;
        if (f.control === 'object') for (const { sub } of f.subs) item.readOnly[`${f.slot}.${sub}`] = true;
        if (f.control === 'list') for (const { sub } of f.subs) item.readOnly[`${f.slot}[*].${sub}`] = true;
        if (f.control === 'strings') item.readOnly[`${f.slot}[*].value`] = true;
      }
    }
    content.push(item);
  });
  return { root: { props: {} }, content };
}

function rawKey(raw) {
  return raw && Array.isArray(raw.sections) && !has(raw, 'blocks') ? 'sections' : 'blocks';
}

function rawArray(raw) {
  const a = raw && raw[rawKey(raw)];
  return Array.isArray(a) ? a : null;
}

// ── 一个 Puck 条目 → 原始数组里的一条 ─────────────────────────────────────────────────────────
function entryOf(item, component, { isCopy, newId }) {
  const src = item.props._src;
  // 锁住的块原样（注入的那种不进文件）。复制一个共用块会在这一页造出第二条同 id 的 `{ref}`
  // （构建当场报 id 撞车）—— 权限上已经关了复制，这里再兜一次：复制品不落盘。
  if (src && src.locked) return !isCopy && src.entry ? clone(src.entry) : null;
  const base = src && src.entry ? clone(src.entry) : { type: item.type };
  if (isCopy || !src) {
    // 新块 / 复制出来的块：id 另起（`blocks.js` 要求一页之内 id 唯一；老 sections 形状本来就不写 id）。
    if (newId) base.id = newId; else delete base.id;
    delete base.weight;
  }
  const data = isPlainObject(base.data) ? base.data : {};
  for (const f of component.fields) mergeSlot(data, f, item.props[f.slot]);
  // 新块一律带 `data`（哪怕是空的）—— 页面 JSON 里每个块都有这个键，别造一种新形状。
  if (isPlainObject(base.data) || Object.keys(data).length > 0 || !src) base.data = data;
  const shape = item.props._shape;
  const shape0 = src ? src.shape0 : component.defaultShape;
  if (typeof shape === 'string' && shape && shape !== shape0) base.shape = shape;
  return base;
}

// ── 权重：画布顺序 → `weight` ──────────────────────────────────────────────────────────────────
//
// 🔴 刻度沿用 `blocks.js` §effectiveWeight 的 `位置 × 10`：站级共用块按它自己的 `weight` 插进页面，
//    换了刻度，它的相对位置就漂了。
// 🔴 按 `visibility` 注进来的共用块不在这一页的文件里、位置也不归这里改 ⟹ 它们是**锚点**：页面自己的
//    块在两个锚点之间先试 `画布下标 × 10`，放不下（会越过锚点）才在那一段里均匀插值 —— 保证重建之后
//    的顺序 = 画布顺序。
// @param slots  画布顺序的 `{ anchor: number|null }`
function assignWeights(slots) {
  const out = new Array(slots.length).fill(null);
  let i = 0;
  while (i < slots.length) {
    if (slots[i].anchor !== null) { i += 1; continue; }
    let j = i;
    while (j < slots.length && slots[j].anchor === null) j += 1;
    const lo = i > 0 ? slots[i - 1].anchor : -Infinity;
    const hi = j < slots.length ? slots[j].anchor : Infinity;
    const n = j - i;
    const plain = [];
    for (let k = i; k < j; k += 1) plain.push(k * 10);
    const fits = plain.every((w) => w > lo && w < hi);
    for (let k = 0; k < n; k += 1) {
      let w;
      if (fits) w = plain[k];
      else if (lo === -Infinity) w = hi - 10 * (n - k);
      else if (hi === Infinity) w = lo + 10 * (k + 1);
      else w = lo + ((hi - lo) * (k + 1)) / (n + 1);
      out[i + k] = w;
    }
    i = j;
  }
  return out;
}

/**
 * Puck Data → 页面 JSON。回新的一份，`raw` 不动。
 *
 * `initial` 是画布打开时那一份 Puck Data（`pageToPuck` 的产物）。要它是因为两件事只有打开时才知道：
 *   · 画布顺序变没变 —— 🔴 要跟**整张画布**比，含注入的共用块：只比这一页自己的条目会漏掉「块被拖到
 *     一个共用块另一侧」（自己那几条相对顺序没变，而重建后它回到原处）。
 *   · 哪几条原始条目上过画布 —— 没上过的（引用了一个已不存在的共用块，构建跳过它）不归老板删，
 *     原样留在原来的相对位置；上过画布、现在不在的，是老板删的。
 *
 * 顺序没变、没增没删 ⟹ 一个 `weight` 都不写（只改一个字不该让整页多出权重）。
 * 顺序变了 / 增删过 ⟹ 数组按画布顺序重排，并按 §assignWeights 给每一条（含 `{ref}`）写 `weight`。
 */
function puckToPage({ raw, data, initial, schema, slug }) {
  const idx = schemaIndex(schema);
  const next = clone(raw);
  const key = rawKey(next);
  const orig = rawArray(next) || [];
  const content = (data && data.content) || [];
  if (!initial || !Array.isArray(initial.content)) throw new Error('editor-convert: puckToPage 要打开时那一份 Puck Data（initial）');
  const opening = initial.content;

  const shown = new Set();
  for (const it of opening) {
    const src = it && it.props && it.props._src;
    if (src && src.at >= 0) shown.add(src.at);
  }
  const usedIds = new Set(orig.map((e) => (e && typeof e.id === 'string' ? e.id : null)).filter(Boolean));
  const seen = new Set();
  const out = []; // { entry, anchor, fromAt }
  let fresh = 0;
  for (const item of content) {
    const component = idx.get(item.type);
    if (!component) throw new Error(`editor-convert: Puck 里有组件 ${JSON.stringify(item.type)}，清单里没有它`);
    const src = item.props && item.props._src;
    const isCopy = !!src && (item.props.id !== src.pid || (src.at >= 0 && seen.has(src.at)));
    if (src && src.at >= 0 && !isCopy) seen.add(src.at);
    let newId = null;
    if ((isCopy || !src) && key === 'blocks') {
      const stem = `${String(slug || 'page').replace(/\//g, '-')}-${item.type}-`;
      let n = orig.length + fresh;
      while (usedIds.has(stem + n)) n += 1;
      newId = stem + n;
      usedIds.add(newId);
      fresh += 1;
    }
    const entry = entryOf(item, component, { isCopy, newId });
    const injected = src && src.locked && src.at < 0;
    out.push({ entry, anchor: injected ? (typeof src.weight === 'number' ? src.weight : null) : null, fromAt: src && !isCopy ? src.at : -1 });
  }

  // 结构变没变：整张画布的 id 序列跟打开时逐个相同（复制品 / 新块的 id 不同，删掉的少一个）。
  const idsNow = content.map((it) => it && it.props && it.props.id);
  const idsThen = opening.map((it) => it && it.props && it.props.id);
  const unchanged = idsNow.length === idsThen.length && idsNow.every((id, k) => id === idsThen[k]);

  let arr;
  if (unchanged) {
    arr = orig.map((e, at) => {
      const o = out.find((x) => x.fromAt === at);
      return o ? o.entry : e;
    });
  } else {
    const slots = out.map((o) => ({ anchor: o.anchor }));
    const w = assignWeights(slots);
    const placed = [];
    out.forEach((o, k) => {
      if (!o.entry) return; // 按 `visibility` 注进来的共用块：不在这一页的文件里
      o.entry.weight = w[k];
      placed.push(o);
    });
    arr = placed.map((o) => o.entry);
    // 没在画布上出现过的原始条目：跟在它原来前一条后面。
    orig.forEach((e, at) => {
      if (shown.has(at)) return;
      let pos = 0;
      for (let p = at - 1; p >= 0; p -= 1) {
        const k = placed.findIndex((o) => o.fromAt === p);
        if (k >= 0) { pos = arr.indexOf(placed[k].entry) + 1; break; }
      }
      arr.splice(pos, 0, clone(e));
    });
  }
  next[key] = arr;
  return next;
}

module.exports = { pageToPuck, puckToPage, fieldProps, dataFromProps, assignWeights, deepEqual, ITEM_ORIG };
