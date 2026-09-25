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
//       locked   不许动的块：清单里没有的类型（`UNKNOWN_TYPE`）、在原始 JSON 里定位不到的块
//       shared   #1406：站级共用块的 id（`{ref}` 条目或按 `visibility` 注入）；不是共用块时为 null。
//                它的字住在 `site-blocks.json`（§puckSharedChanges 算出要写回的那几处），位置写在这一页
//                （`{ref}` + `weight`），删除看它是怎么出现在这一页的（§puckSharedChanges 文件头那张表）
//       sharedData 共用块打开时块库文件里那一份 `data`（它的字段 prop 就是按它取的）；不是共用块时为 null
//       view     归一化之后的那一块（画布照它渲染：`data-shape` / `data-has-*` / 升格后的列表）
//       weight   它在构建里的有效权重（锁住的块拿它当锚点，见 §assignWeights）
//       shape0   画布一打开时它戴的形态（解析后的值，恒非空 —— 判「钉住没有」用 `entry.shape`，#1443）
//       pid      打开时的 Puck id —— 复制出来的条目 id 不同，据此认出它是一个**新**块

const ITEM_ORIG = '__orig';

// 页面上有、而这个站的组件清单里没有的块（区块库删掉了它的类型，老页面 JSON 里还留着）。
// 构建对它只打一行 `Unknown block type` 就跳过（`SectionRenderer`），编辑器也不许因为它打不开 ——
// 画布上一个锁住的占位，存盘时那一条原样留在原位（#1404 QA1 r1）。
const UNKNOWN_TYPE = '__unknown-block';
const UNKNOWN_COMPONENT = { type: UNKNOWN_TYPE, label: 'Unknown section', fields: [], carried: [], shapes: [], defaultShape: null, themeShape: null, fallbackShape: null };

// #1443 —— 形态下拉里「跟着主题走」那一项的值。`_shape` 是它 ⟹ 这个块在页面 JSON 里**没有** `shape` 键
// （存盘时删掉，§entryOf）；是别的非空串 ⟹ 钉住那个形态。新插的块默认也是它（`EditorApp.tsx` §buildConfig）。
const THEME_DEFAULT = '';

function slotFilled(v) {
  return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
}

/**
 * #1443 —— 画布上这一块戴哪个形态：跟构建 `block-shape.js` §shapeForBlock 同一套取值，只是原料从 schema 来
 * （本文件零 require）。点名的（`pinned`，页面 JSON 的 `shape`）优先，没点名用主题选择单那一格；点名的形态
 * 不在下拉里（候选 / 清单里没有）或缺它 `needs` 的槽位 ⟹ 落回 manifest 默认。
 * 🔴 `data` 要传这个块**当前的**内容（画布上那份）：按空 data 算（schema 的 `defaultShape`）会把 needs 门控的
 *    形态算掉，hero / content-split 上画错。`component.shapes` 已去掉候选，needs 与 manifest 同一份
 *    （`block-catalog.js` 的 pairs）⟹ 「不在 shapes 里」= §shapeForBlock 的「候选」+「清单里没有」两条。
 * 守卫：`editor-roundtrip.test.js` ⑦c 逐主题 × 逐块 × 逐形态跟 §shapeForBlock 对拍。
 */
function canvasShape(component, pinned, data) {
  const name = typeof pinned === 'string' && pinned ? pinned : component.themeShape;
  if (!name) return component.fallbackShape || undefined;
  const sh = (component.shapes || []).find((x) => x.name === name);
  const d = isPlainObject(data) ? data : {};
  if (!sh || !(sh.needs || []).every((slot) => slotFilled(d[slot]))) return component.fallbackShape || undefined;
  return name;
}

/**
 * #1445 —— 一个块的形态下拉选项：`Theme default` + `component.shapes`（已去掉候选）。`current`（这一块的 `_shape`）
 * 是个不在清单里的名字（老数据 / 后来退役或改成候选的形态）⟹ 再多一项只显示它的名字、标 `(retired)`。
 * 不补这一项时，React 受控 `<select>` 的值配不上任何 `<option>` 就退到第一项 ⟹ 框里写着 `Theme default`，
 * 而这块其实钉着别的（Chromium 实测 `selectedIndex = 0`，不是空白）；老板点 `Theme default` 也没反应（值没变，不发 change）。
 * 🔴 这一项的值就是那个名字本身，不许做成 `THEME_DEFAULT`：不碰它直接存 ⟹ `shape` 原样（§entryOf 按当前值写）。
 *    Puck 的选项没有 disabled；「不可再选」靠的是它只跟着当前值出现 —— 选了别的，它就不在选项里了。
 */
function shapeOptions(component, current) {
  const shapes = component.shapes || [];
  const options = [
    { value: THEME_DEFAULT, label: 'Theme default' },
    ...shapes.map((s) => ({ value: s.name, label: s.needs && s.needs.length ? `${s.name} (needs ${s.needs.join(', ')})` : s.name })),
  ];
  if (typeof current === 'string' && current !== THEME_DEFAULT && !shapes.some((s) => s.name === current)) {
    options.push({ value: current, label: `${current} (retired)` });
  }
  return options;
}

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
  m.set(UNKNOWN_TYPE, UNKNOWN_COMPONENT);
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
function pageToPuck({ raw, blocks, located, schema, weights, siteBlocks }) {
  const idx = schemaIndex(schema);
  const arr = rawArray(raw);
  const lib = isPlainObject(siteBlocks) ? siteBlocks : {};
  const content = [];
  blocks.forEach((view, i) => {
    const loc = located[i] || { at: -1, writable: false, reason: 'not-found' };
    const known = idx.get(view.type);
    const unknown = !known || view.type === UNKNOWN_TYPE;
    const component = unknown ? UNKNOWN_COMPONENT : known;
    const entry = loc.at >= 0 && arr ? arr[loc.at] : undefined;
    // #1406 —— 共用块：块库里真有它（`visibility` 注入的 id 就是块库的键；`{ref}` 条目的 id 就是 ref）。
    const sharedId = !unknown && loc.reason === 'shared' && typeof view.id === 'string' && isPlainObject(lib[view.id]) ? view.id : null;
    const locked = unknown || (!loc.writable && !sharedId);
    // 共用块的字段显示**块库文件里**那一份（存盘时改动合回的就是它，往返才无损）；锁住的块显示归一化后的
    // 内容（它的字不在这一页的文件里）；可写的块显示文件里的原值。
    const data = sharedId ? (lib[sharedId].data || {}) : locked ? (view.data || {}) : ((entry && entry.data) || {});
    const pid = typeof view.id === 'string' && view.id ? view.id : `${view.type}-${i}`;
    const shape0 = typeof view.shape === 'string' && view.shape ? view.shape : (component.defaultShape || '');
    // #1443 —— 下拉显示的是**页面 JSON 里点没点名**，不是解析后的形态（`shape0` 恒非空，拿它就分不出
    // 「钉住了」和「跟着主题」）。共用块 / 锁住的块形态只读，照旧显示它戴着的那个。
    const pinned = entry && typeof entry.shape === 'string' && entry.shape ? entry.shape : THEME_DEFAULT;
    const item = {
      type: component.type,
      props: {
        id: pid,
        ...fieldProps(component, data),
        _shape: sharedId || locked ? shape0 : pinned,
        _src: {
          at: loc.at,
          entry: clone(entry === undefined ? null : entry),
          locked,
          shared: sharedId,
          // 共用块的字段是按它取的（块库文件里那一份 data）：画布判「这个字段改过没有」要跟同一份比（EditorApp §CanvasBlock）。
          sharedData: sharedId ? clone(lib[sharedId].data || {}) : null,
          reason: unknown ? 'unknown-type' : (loc.reason || ''),
          view: clone(view),
          weight: weights && typeof weights[i] === 'number' ? weights[i] : null,
          shape0,
          pid,
        },
      },
    };
    if (sharedId) {
      // 形态不在本票：写在 `{ref}` 上是「只这一页」（#1350），写进块库是「所有页」—— 两种意思要另定。
      item.readOnly = { _shape: true };
    } else if (locked) {
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
function entryOf(item, component, { isCopy, newId, promote }) {
  const src = item.props._src;
  // 锁住的块原样（注入的那种不进文件）。复制一个共用块会在这一页造出第二条同 id 的 `{ref}`
  // （构建当场报 id 撞车）—— 权限上已经关了复制，这里再兜一次：复制品不落盘。
  if (src && src.locked) return !isCopy && src.entry ? clone(src.entry) : null;
  // #1406 共用块：这一页只写它的 `{ref}`（字在块库里，§puckSharedChanges 另算）。
  //   · 这一页本来就有那条 `{ref}` → 原样（`weight` 由 puckToPage 按画布顺序改）
  //   · 按 `visibility` 注进来、老板把它挪了（`promote`）→ 新加一条 `{ref}`：它压过块自带的位置（`blocks.js`
  //     §normalizeLocalePages 那条「ref 赢」）
  //   · 按 `visibility` 注进来、没挪 → 不进文件（位置照块自带的 weight，是 puckToPage 的锚点）
  if (src && src.shared) {
    if (isCopy) return null;
    if (src.entry) return clone(src.entry);
    return promote ? { ref: src.shared } : null;
  }
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
  // #1443 —— 判据是 `_shape` 的**当前值**，不是「这次改过没有」：存盘之后 `_src.entry` 不刷新（`EditorApp.tsx`
  // 存盘成功只并 root），按事件判的话连存两次，第二次会从 `clone(src.entry)` 把刚删掉的 `shape` 带回来。
  //   · 非空 → 钉住它（打开时就钉着的块原样写回同一个值，往返无损）
  //   · `THEME_DEFAULT` → 底稿那条钉着形态就删键（不是写成空串）；底稿那条的 `shape` 本来就不是非空串
  //     （没有这个键 / 一个构建不认的值）就原样不动 —— 老板没碰过的块一个字节都不变
  const shape = item.props._shape;
  if (typeof shape === 'string' && shape) base.shape = shape;
  else if (typeof base.shape === 'string' && base.shape) delete base.shape;
  return base;
}

// ── 权重：画布顺序 → `weight` ──────────────────────────────────────────────────────────────────
//
// 🔴 刻度沿用 `blocks.js` §effectiveWeight 的 `位置 × 10`：站级共用块按它自己的 `weight` 插进页面，
//    换了刻度，它的相对位置就漂了。
// 🔴 按 `visibility` 注进来的共用块不在这一页的文件里、位置也不归这里改 ⟹ 它们是**锚点**：页面自己的
//    块在两个锚点之间先试 `画布下标 × 10`，放不下（会越过锚点）才在那一段里均匀插值 —— 保证重建之后
//    的顺序 = 画布顺序。
// 📌 做不到的一格（QA1 r1 低）：两个注入块 weight 相等、老板把页面块拖到它俩中间。没有一个数严格落在
//    两者之间，而平手时按 `__order` 排、页面条目恒在注入块之前 ⟹ 它重建后排到这两个锚点前面。要两个
//    站级块同权、又都按 visibility 注进同一页才会碰到；真要治得改锚点自己的 weight，那是 #1406 的地盘。
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
function puckToPage({ raw, data, initial, schema, slug, moved }) {
  // #1406 —— `moved`：老板在画布上拖过的块（Puck id）。按 `visibility` 注进来的共用块只有被拖过的才写成
  // 这一页的 `{ref}`；没拖过的仍是锚点 —— 顺着别的块的挪动把它也写成 ref，会让「从块库的 visibility 里撤掉
  // 这一页」从此对这一页失效（ref 那条来路还留着它）。
  const movedIds = new Set(Array.isArray(moved) ? moved : moved instanceof Set ? [...moved] : []);
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
    const promote = !!src && !!src.shared && src.at < 0 && !isCopy && movedIds.has(item.props.id);
    const entry = entryOf(item, component, { isCopy, newId, promote });
    const injected = src && (src.locked || src.shared) && src.at < 0 && !promote;
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

// ── #1406 站级共用块 ────────────────────────────────────────────────────────────────────────────
//
// 一个共用块出现在一页上有两条来路（`blocks.js` §normalizeLocalePages，两条是「或」）：
//   ① 这一页写了 `{ "ref": "<id>" }`      ② 块库里它的 `visibility` 列了这一页（或 `"*"`）
// 编辑器对它的三种动作各落到对的文件：
//   改内容   → `site-blocks.json` 里那个块的 `data`（§puckSharedChanges 的 `data`）；这一页不变
//   挪位置   → 这一页的 `{ref}` + `weight`（puckToPage；注进来的块被拖过就新加一条 `{ref}`）
//   删除     → 看它是怎么来的：
//                只在 ② → 从 `visibility` 里移除这一页（§puckSharedChanges 的 `unlist`）
//                只在 ① → 只拿掉这一页的 `{ref}`（puckToPage），块库一个字节不动
//                两条都有 → 两个都做
//              块本身永远留在块库里（别的页可能还在用）。🔴 不用 `hidden`（它由 #1411 退役）。
//   `"*"` 的块不许删（Chris 2026-09-23）：`"*"` 是「所有页，含以后新建的」，删掉它 = 每一页都撤掉，展开成清单
//   又会让以后的新页不再带它。编辑器把删除按钮关掉；这里再兜一次（抛错，存盘不发出去）。
// 🔴 字符串 `visibility` 跟构建一样当没写（`blocks.js` 那条 note：整个字段被忽略）：它不算「列了这一页」，
//    存盘也不碰它。

/** 这个块的 `visibility`：是数组才算数（跟 `blocks.js` §visibilityMatches 同一个判法）。 */
function visibilityOf(b) {
  return isPlainObject(b) && Array.isArray(b.visibility) ? b.visibility : null;
}

/**
 * 编辑器那句「这个块在 N 个页面上」的 N。
 * @param {{ siteBlocks: object, refs?: Record<string, string[]>, slugs?: string[], id: string }} a
 *   `refs` / `slugs` 来自底稿（`editor-page.js` §sharedRefs）。`slugs` 缺时 `visibility` 里的页不过滤。
 * @returns {{ all: boolean, pages: number }}  `all` = `visibility` 含 `"*"`（「所有页面」，不写数字）
 *   N = `visibility` 列的页（这种语言真有的那些 —— 构建丢掉不存在的）∪ 用 `{ref}` 指着它的页。
 */
function sharedReach({ siteBlocks, refs, slugs, id }) {
  const vis = visibilityOf(isPlainObject(siteBlocks) ? siteBlocks[id] : null);
  if (vis && vis.includes('*')) return { all: true, pages: 0 };
  const known = Array.isArray(slugs) ? new Set(slugs) : null;
  const pages = new Set();
  for (const s of vis || []) if (typeof s === 'string' && (!known || known.has(s))) pages.add(s);
  for (const s of (isPlainObject(refs) && Array.isArray(refs[id]) ? refs[id] : [])) pages.add(s);
  return { all: false, pages: pages.size };
}

/** 这个共用块能不能从这一页删掉（`"*"` 的不能，见上面那段）。 */
function sharedRemovable(siteBlocks, id) {
  const vis = visibilityOf(isPlainObject(siteBlocks) ? siteBlocks[id] : null);
  return !(vis && vis.includes('*'));
}

/**
 * 这一次存盘要写回块库的那几处 → `{ <块 id>: { data?: { <改过的字段>: <新值> }, unlist?: true } }`（一处都没有 ⟹ `{}`）。
 *   · `data`    **只带老板改过的那几个字段**（顶层 slot），站里的脚本把它们合进**磁盘上现在那一份** `data`
 *               （§applySharedChanges）。没改过的字段不交 —— 编辑器开着的时候别处（AI 聊天 / 检查器 / 另一页的
 *               编辑器）改过的字，不会被画布上打开时那一份悄悄冲掉（#1406 QA2 r1 的 F；跟 #1405 外壳四样
 *               逐字段交、#1409 baseHash 是同一个病）。
 *   · `was`     #1420：跟 `data` 同一批字段，各自「画布是按哪个值取的」（打开时 / 上次存成功时）。只用来判
 *               「这一笔盖掉了别处刚改过的同一个字段」并告诉老板；不参与合并（§applySharedChanges 不读它）。
 *   · `unlist`  老板在这一页把它删了、而它的 `visibility` 数组里列了这一页 ⟹ 站里的脚本从数组里移除这一页
 * 「删了」= 打开时画布上有它（按 Puck id 认），现在没有。
 * 🔴 「改过没有」跟**画布的字段是按哪一份取的**比（`own[id]`，没有就是打开时的 `_src.sharedData`），不跟
 *    `siteBlocks` 比：`siteBlocks` 是存盘后 dashboard 重取的那份（算 N、判删除用），它会带着别处的改动，
 *    跟它比就会把「别人改了」读成「老板改了」。`own` 由 §sharedOwnAfter 在每次存盘成功后往前推。
 * @param {{ data: object, initial: object, siteBlocks: object, schema: object, slug: string, own?: Record<string, object> }} a
 */
function puckSharedChanges({ data, initial, siteBlocks, schema, slug, own }) {
  const idx = schemaIndex(schema);
  const lib = isPlainObject(siteBlocks) ? siteBlocks : {};
  const now = new Map();
  for (const it of (data && data.content) || []) {
    const src = it && it.props && it.props._src;
    if (src && src.shared && it.props.id === src.pid) now.set(src.pid, it);
  }
  const out = {};
  for (const it of (initial && initial.content) || []) {
    const src = it && it.props && it.props._src;
    if (!src || !src.shared) continue;
    const id = src.shared;
    const b = lib[id];
    if (!isPlainObject(b)) continue;
    const cur = now.get(src.pid);
    if (!cur) {
      if (!sharedRemovable(lib, id)) throw new Error('editor-convert: 这个共用块在所有页面上，不能只从这一页拿掉');
      const vis = visibilityOf(b);
      if (vis && vis.includes(slug)) out[id] = { ...(out[id] || {}), unlist: true };
      continue;
    }
    const component = idx.get(cur.type);
    if (!component) continue;
    const basis = sharedBasis(src, own);
    const patch = changedSharedSlots(component, basis, cur.props);
    if (patch) {
      // #1420 —— 每个改过的字段「画布是按哪个值取的」一起交（basis 里没有这个字段 ⟹ 不写这个键 = 「本来没有」）。
      // 站里的脚本拿它跟磁盘上现在那个值比：不一样 ⟹ 别处在这期间改过同一个字段，照旧后存的赢，但要告诉老板。
      const was = {};
      for (const slot of Object.keys(patch)) if (has(basis, slot)) was[slot] = clone(basis[slot]);
      out[id] = { ...(out[id] || {}), data: patch, was };
    }
  }
  return out;
}

/** 画布上这个共用块的字段是按哪一份 `data` 取的：存成功过就是存完那一份（`own`），否则是打开时那份。 */
function sharedBasis(src, own) {
  const o = isPlainObject(own) ? own[src.shared] : undefined;
  return isPlainObject(o) ? o : (isPlainObject(src.sharedData) ? src.sharedData : {});
}

/** 跟 `basis` 比改过的顶层字段 → `{ slot: 新值 }`；一个都没改 ⟹ null。判法跟画布同一个（EditorApp §CanvasBlock）。 */
function changedSharedSlots(component, basis, props) {
  const initialProps = fieldProps(component, basis);
  const merged = dataFromProps(component, basis, props);
  let patch = null;
  for (const f of component.fields) {
    if (deepEqual(props[f.slot], initialProps[f.slot])) continue;
    if (!has(merged, f.slot) || deepEqual(merged[f.slot], basis[f.slot])) continue;
    (patch || (patch = {}))[f.slot] = clone(merged[f.slot]);
  }
  return patch;
}

/**
 * 存盘成功之后，画布上每个共用块的字段「是按哪一份取的」往前推一步：`own[id]` = 原来那份合上这次交出去的字段。
 * 下一次 §puckSharedChanges 跟它比 —— 不然这一次改过的字会在之后每一次存盘里再交一遍（盖掉别处在两次存盘
 * 之间对同一字段的改动）。回新的一份。
 */
function sharedOwnAfter({ initial, own, changes }) {
  const next = { ...(isPlainObject(own) ? own : {}) };
  for (const it of (initial && initial.content) || []) {
    const src = it && it.props && it.props._src;
    if (!src || !src.shared) continue;
    const c = isPlainObject(changes) ? changes[src.shared] : undefined;
    if (!isPlainObject(c) || !isPlainObject(c.data)) continue;
    next[src.shared] = { ...clone(sharedBasis(src, next)), ...clone(c.data) };
  }
  return next;
}

/**
 * 一次存盘成功之后，把送出去的那几处合进编辑器手上的块库底（下一次存盘跟它比）。站里的脚本做的是同一件事
 * （`lib/shared-blocks-write.js` §applySharedChanges 调的就是这一个函数）—— 两边不各写一份。回新的一份。
 */
function applySharedChanges(siteBlocks, changes, slug) {
  const next = clone(isPlainObject(siteBlocks) ? siteBlocks : {});
  for (const [id, c] of Object.entries(changes || {})) {
    const b = next[id];
    if (!isPlainObject(b) || !isPlainObject(c)) continue;
    // `data` 只带改过的字段（§puckSharedChanges）：合进现在这一份，没点名的字段原样。
    if (isPlainObject(c.data)) b.data = { ...(isPlainObject(b.data) ? b.data : {}), ...clone(c.data) };
    if (c.unlist === true && Array.isArray(b.visibility) && !b.visibility.includes('*')) {
      b.visibility = b.visibility.filter((s) => s !== slug);
    }
  }
  return next;
}

// ── #1405 外壳四样：站级文件的现值 ⇄ Puck root ───────────────────────────────────────────────────
//
// 🔴 root 字段**不整份写回**（票正文做什么 7）：打开时记下的初值是 `initial.root.props`，存盘时逐字段比，
//    只把改过的交出去。整份写回的话，编辑器开着的时候别处（AI 聊天 / 换装弹窗 / 另一种语言的编辑器）
//    改过的公告条文字、顶栏形态会被打开时那一份悄悄冲掉 —— 跟 #1409 r2 在页面文件上修的是同一个病。

/** 链接的规范形：两格都空 = 没有链接（`null`）。站里的写盘那一侧用同一条（`editor-root.js` §normLink）。 */
function normRootLink(v) {
  if (!isPlainObject(v)) return null;
  const label = typeof v.label === 'string' ? v.label : '';
  const href = typeof v.href === 'string' ? v.href : '';
  return label || href ? { label, href } : null;
}

/**
 * 站级文件的现值 → Puck root 的 props。Puck 的 object 字段要一个对象，所以没有链接时给两格空串。
 * @param {{ layout: string, headerShape: string, footerShape: string, topbarMessage: string, topbarLink: { label: string, href: string } | null }} values
 */
function rootToPuck(values) {
  const link = normRootLink(values && values.topbarLink);
  return {
    layout: values.layout,
    headerShape: values.headerShape,
    footerShape: values.footerShape,
    topbarMessage: typeof values.topbarMessage === 'string' ? values.topbarMessage : '',
    topbarLink: link || { label: '', href: '' },
  };
}

/**
 * 这一次存盘里 root 改了哪几个字段 → `{ 字段: 新值 }`（一个都没改 ⟹ `{}`）。
 * · 比的字段照 `schema.root.fields`（分派表），不在这里另列。
 * · 布局自己钉了页脚形态时（`pinsFooter`）不交 `footerShape`：那个下拉是灰的，它的值画不出来（做什么 8）。
 */
function puckRootChanges({ initial, now, schema }) {
  const a = (initial && initial.root && initial.root.props) || {};
  const b = (now && now.root && now.root.props) || {};
  const norm = (field, v) => (field === 'topbarLink' ? normRootLink(v) : v);
  const out = {};
  for (const { field } of schema.root.fields) {
    const next = norm(field, b[field]);
    if (next === undefined) continue;
    if (!deepEqual(next, norm(field, a[field]))) out[field] = next;
  }
  const layout = (schema.root.layouts || []).find((l) => l.id === (b.layout !== undefined ? b.layout : a.layout));
  if (layout && layout.pinsFooter) delete out.footerShape;
  return out;
}

// ── #1410 AI 改完之后的撤销历史 ───────────────────────────────────────────────────────────────────
//
// AI 改的是磁盘；改完 dashboard 重取一份底稿递进来（`reason: ai`），编辑器换上新的一份。共用块的字住在
// `site-blocks.json`，**不归 Puck 的撤销管**（票正文做什么 7）：撤销只退这一页的页面 JSON，共用块在任何一步
// 历史里都得是**当前**的内容 —— 不然撤销一步，画布上的共用块退回旧字，而网站上是新字（PM 三审技术须知）。
// 所以每来一份新底稿，历史里每一条快照中的共用块都换成新底稿里那一块。
//
// 🔴 换进去的是新底稿里**整个条目**（字段 prop 和 `_src` 一起）：`_src.sharedData` 是 §puckSharedChanges 判
//    「老板改过没有」的底，字段和底来自同一份 ⟹ 比出来的差是 0，Save 不会因为这次替换多写块库。只换字段、
//    留着旧 `_src` 的话，换进去的新字会被读成「老板改的」，Save 把 AI 的字又写一遍（碰巧无害）或者在别处又改过
//    之后把它盖回去（有害）。
// 📌 代价（交接时单独量过）：老板更早手改过、已经存下去的共用块，那一步撤销换完之后是「撤了跟没撤一样」——
//    那一步的前后两张快照里它都是当前内容。

/** 画布上的共用块条目，按 Puck id。复制品（id ≠ pid）不算：它不落盘（§entryOf）。 */
function sharedItemsById(data) {
  const out = new Map();
  for (const it of (data && data.content) || []) {
    const src = it && it.props && it.props._src;
    if (src && src.shared && it.props.id === src.pid) out.set(it.props.id, it);
  }
  return out;
}

/**
 * 这一份新底稿里，哪几个共用块的字跟 `prev`（手上那一份）不一样了 —— 回块库 id 的数组（排好序）。
 * 判据是块库里那份 `data`（`_src.sharedData`），不是字段 prop：老板没存的手改不算「底稿变了」。
 */
function sharedChangedIds(prev, next) {
  const before = sharedItemsById(prev);
  const ids = new Set();
  for (const [pid, it] of sharedItemsById(next)) {
    const old = before.get(pid);
    if (old && !deepEqual(old.props._src.sharedData, it.props._src.sharedData)) ids.add(it.props._src.shared);
  }
  return [...ids].sort();
}

/**
 * `data` 里每个共用块换成 `next` 里同一个 Puck id 的那一块（整个条目，见上）。别的条目、顺序、root 原样。
 * 一个都没换 ⟹ 回 `data` 本身（调用方据此判断要不要动历史）。
 */
function withSharedFrom(data, next) {
  const fresh = sharedItemsById(next);
  let hit = false;
  const content = ((data && data.content) || []).map((it) => {
    const src = it && it.props && it.props._src;
    if (!src || !src.shared || it.props.id !== src.pid) return it;
    const n = fresh.get(it.props.id);
    if (!n || deepEqual(n, it)) return it;
    hit = true;
    return clone(n);
  });
  return hit ? { ...data, content } : data;
}

/**
 * AI 改完、新底稿到了：撤销历史怎么动（EditorApp 照这个回答做，`editor-ai-history.test.js` 跑的是同一个函数）。
 *
 *   pageChanged  这一页的页面 JSON 变了没有 —— 判据是底稿的 `hash`（文件字节的 sha256）跟手上那个比，不是
 *                「Puck Data 变没变」：共用块的字变了 Puck Data 也会变，而那不是这一页的改动（票正文做什么 5 / 7）
 *   record       要不要把新底稿记成撤销历史里的一步 = pageChanged
 *   histories    每一条快照的共用块换成新底稿里的那一块（§withSharedFrom）
 *   current      手上画布那一份，同样换好共用块（只在不 record 时用来换画布；record 时画布换成 next）
 *   sharedIds    字变了的共用块
 *   mixed        页面和共用块都变了 ⟹ 撤销只退页面那半，状态栏要多说一句（做什么 7 的 📌）
 *
 * @param {{ current: object, histories: {state:{data:object}}[], next: object, hash: string, nextHash: string }} a
 */
function aiBaselineStep({ current, histories, next, hash, nextHash }) {
  const pageChanged = typeof nextHash === 'string' && nextHash !== hash;
  const sharedIds = sharedChangedIds(current, next);
  const mapped = (histories || []).map((h) => {
    const data = h && h.state && h.state.data;
    if (!data) return h;
    const d2 = withSharedFrom(data, next);
    if (d2 === data) return h;
    // 🔴 换了 data 的那一条**不许带着原来的 `indexes`**：Puck 0.23 的 `set`（setHistories / 撤销 / 前进都走它，
    //    `reducer/actions/set.ts`）见到 state 里有 `indexes` 就直接用、不按 data 重建 —— 留着旧的，节点索引就还指着
    //    换之前的那些块。拿掉它，Puck 按新 data 重建一份。
    const { indexes: _stale, ...rest } = h.state; // eslint-disable-line no-unused-vars
    return { ...h, state: { ...rest, data: d2 } };
  });
  return {
    pageChanged,
    record: pageChanged,
    histories: mapped,
    current: withSharedFrom(current, next),
    sharedIds,
    mixed: pageChanged && sharedIds.length > 0,
  };
}

module.exports = {
  UNKNOWN_TYPE, pageToPuck, puckToPage, fieldProps, dataFromProps, assignWeights, deepEqual, ITEM_ORIG, rootToPuck, puckRootChanges,
  sharedReach, sharedRemovable, puckSharedChanges, sharedOwnAfter, applySharedChanges,
  aiBaselineStep, THEME_DEFAULT, canvasShape, shapeOptions,
};
