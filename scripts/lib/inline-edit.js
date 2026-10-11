'use strict';

// inline-edit.js —— #1657 画布里点字直接改：「点到的这段字，对的是 Puck 数据里的哪一格」。
//
// 画布上每段可改的字挂着 `data-slot`（`headline`、`eyebrow.text`、`items.1.title`），由各块组件写，
// `scripts/block-slots.test.js` 守着它跟 §editableSlotPaths 两个方向对齐。点击层（EditorApp §InlineEditLayer）
// 拿到被点的元素之后，问这里一句：写回 Puck 的哪条路径、能不能打字、出不出 AI 按钮。纯函数，不碰 DOM、不碰 Puck。
//
// 🔴 `data-slot` 里的列表序号是**画布上的**序号，不是数据里的：faq 先筛掉空问题、hero 的按钮先筛再截到上限，
//    然后才 `map((it, i) => … data-slot={`items.${i}.question`})`。所以序号不能直接当数据下标用 ——
//    按**这段字的内容**在数据那一列里找回真实下标：恰好一项对得上才算数，零项或多项都不让改（不猜着写）。
//    同一个 `data-slot` 在一页里出现两次（faq 的问答在两种排版里各写了一次）走的也是这一条。
//    顶层 / 对象里的字没有序号，也要内容对得上：块对这段字做过加工（拼了别的字、换了格式）时，
//    把画布上的样子写回数据就是写错，同样不让改。只出 AI 按钮、不打字的那种（`content.body`）不比 —— 见下。
//
// #1693 —— 图片格（`entry.image`，画布上是 `<img data-slot="items.2.image">`）同一条规矩，「内容」换成图的地址：
//    调用方把 `<img>` 的 `src` 当 `text` 交进来，跟数据里那一项的 `imageUrl` 比（gallery 先筛掉没图的项，序号同样不可信）。
//
// 🔴 两种块点不动（画布上照样有 `data-slot`）：
//    · 列表写成引用的（`items: { source: "services" }`）：判据是展开时写下的 `data._sourced`（item-sources.js），
//      调用方把那份标记的键（槽名）交进来。打字会把引用覆盖成一份写死的数组。
//    · 锁住的块（`_src.locked`）：存盘时原样留着，打的字会没了。

/** 比较用：空白折成一个空格、去掉两头。数字照 `String()` 比（评分 4.9 画出来就是 "4.9"）。 */
function norm(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  return String(v).replace(/\s+/g, ' ').trim();
}

function getAt(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 不改原对象，回一份把 `path` 那一格换成 `value` 的新对象（沿路的对象 / 数组都是新的）。 */
function setAt(obj, path, value) {
  if (!path.length) return value;
  const [k, ...rest] = path;
  const base = obj !== null && typeof obj === 'object' ? obj : (typeof k === 'number' ? [] : {});
  const copy = Array.isArray(base) ? base.slice() : { ...base };
  copy[k] = setAt(base[k], rest, value);
  return copy;
}

/** `items.2.title` → 去掉序号的那条（跟 block-manifest.js §stripSlotIndex 同一个规矩）。 */
function stripIndex(attr) {
  return String(attr).split('.').filter((seg) => !/^\d+$/.test(seg)).join('.');
}

/**
 * 被点的那一段字 → 写回哪里。
 *
 * @param {object}   args
 * @param {{ inline: Array<{path:string, typing:boolean, ai:boolean}> }} args.component  editor-schema 里这一块
 * @param {object}   args.props      Puck 里这一块的 props（字段 prop 跟 data 同形：`props.items[1].title`）
 * @param {string}   args.slot       元素上的 `data-slot`
 * @param {string}   args.text       元素现在显示的字（`textContent`，不是 `innerText` —— 后者会带上 CSS 的大写变换）；图片格是 `<img>` 的 `src`
 * @param {string[]} [args.sourced]  这一块展开时写下的 `_sourced` 的键（写成引用的槽名）
 * @param {boolean}  [args.locked]   这一块是锁住的（`_src.locked`）
 * @returns {{ ok: true, path: (string|number)[], name: string, value: string, typing: boolean, ai: boolean, image: boolean }
 *          | { ok: false, why: 'unknown'|'sourced'|'locked'|'mismatch'|'ambiguous', slot?: string }}
 *   `name` = 数据里的路径（真实下标），交给 AI 接口的字段名就是它。图片格的 `value` 是现在那张图的地址。
 */
function resolveInlineSlot({ component, props, slot, text, sourced = [], locked = false }) {
  const segs = String(slot || '').split('.').filter(Boolean);
  const entry = component && Array.isArray(component.inline)
    ? component.inline.find((e) => e.path === stripIndex(slot))
    : undefined;
  if (!segs.length || !entry) return { ok: false, why: 'unknown' };
  if (locked) return { ok: false, why: 'locked' };
  if (sourced.includes(segs[0])) return { ok: false, why: 'sourced', slot: segs[0] };
  const shown = norm(text);
  // 比内容用的那一格：字就是它自己；图片格是那个图片对象的 `imageUrl`。
  const key = (v) => (entry.image ? norm(v !== null && typeof v === 'object' ? v.imageUrl : undefined) : norm(v));
  const nums = segs.map((s, i) => (/^\d+$/.test(s) ? i : -1)).filter((i) => i >= 0);
  let path;
  if (nums.length === 0) {
    path = segs;
    // 不就地打字的那种（`content.body`：画布上是排过版的段落 / 列表，跟 markdown 原文按构造对不上）不比：
    // 它不会把画布上的字写回去，AI 改的是数据里那一份。
    if ((entry.typing !== false || entry.image) && key(getAt(props, path)) !== shown) return { ok: false, why: 'mismatch' };
  } else if (nums.length === 1) {
    const at = nums[0];
    const list = getAt(props, segs.slice(0, at));
    const rest = segs.slice(at + 1);
    if (!Array.isArray(list)) return { ok: false, why: 'mismatch' };
    const hits = [];
    list.forEach((item, j) => { if (key(getAt(item, rest)) === shown) hits.push(j); });
    if (hits.length === 0) return { ok: false, why: 'mismatch' };
    if (hits.length > 1) return { ok: false, why: 'ambiguous' };
    path = [...segs.slice(0, at), hits[0], ...rest];
  } else if (nums.length === 2) {
    // #1686 —— 列表项里再套一列字（`plans.0.features.2`、`items.1.bullets.0`）：两层序号都是画布上的（套餐、每一行都先筛过），
    //    同一条规矩扩到两层 —— 在外层每一项的那一列里逐行比内容，全块恰好一行对得上才算数（两个套餐里有一字不差的同一行 ⟹ 不让改）。
    const [a, b] = nums;
    const list = getAt(props, segs.slice(0, a));
    const mid = segs.slice(a + 1, b);
    const rest = segs.slice(b + 1);
    if (!Array.isArray(list)) return { ok: false, why: 'mismatch' };
    const hits = [];
    list.forEach((item, i) => {
      const inner = getAt(item, mid);
      if (Array.isArray(inner)) inner.forEach((x, j) => { if (key(getAt(x, rest)) === shown) hits.push([i, j]); });
    });
    if (hits.length === 0) return { ok: false, why: 'mismatch' };
    if (hits.length > 1) return { ok: false, why: 'ambiguous' };
    path = [...segs.slice(0, a), hits[0][0], ...mid, hits[0][1], ...rest];
  } else {
    return { ok: false, why: 'ambiguous' };
  }
  const value = entry.image ? getAt(props, [...path, 'imageUrl']) : getAt(props, path);
  return {
    ok: true,
    path,
    name: path.join('.'),
    value: value === undefined || value === null ? '' : String(value),
    typing: entry.typing !== false,
    ai: entry.ai !== false,
    image: entry.image === true,
  };
}

/** 就地打出来的字 → 存进数据的样子：单行字段，换行（粘贴进来的）折成空格。 */
function typedValue(text) {
  return String(text || '').replace(/\r?\n/g, ' ');
}

module.exports = { resolveInlineSlot, setAt, getAt, stripIndex, typedValue, norm };
