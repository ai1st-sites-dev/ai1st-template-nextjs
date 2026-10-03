/**
 * items-grid.js — 条目网格（`*Columns` 旋钮的列数与断点）的唯一一份（#1537）。
 *
 * 9 个块（blog faq features gallery logos milestones pricing team testimonials）原来各自在 `block.css` 里写一遍
 * 「手机几列 / iPad 几列 / ≥992 按旋钮」，写法还分两派（4 个 CSS grid、5 个 flex + `width: calc()`）。现在块的
 * manifest 只**声明**它的网格（顶层 `itemsGrid`），规则由这里生成、拼进 `public/shapes.css` 里那个块的段首
 * （`build-blocks.js` §buildShapesCss）。块自己的 `block.css` 里不许再写列数 / 断点（`scripts/items-grid.test.js` 守）。
 *
 * ── 一条规矩 ──────────────────────────────────────────────────────────────────────────────────
 *   某个宽度上的列数 = min(旋钮的值, 这个宽度的上限)。
 *     手机（<768）上限 = `phone`、iPad（768–991）上限 = `tablet`、≥992 没有上限。
 *     `auto` 当成无穷大：手机 / iPad 取上限；≥992 = 一行均分（有几个排几个）。
 *   今天 9 个块的 `phone` 是 1 或 2、`tablet` 是 2 或 3 —— 原来各块注释里写的「手机一律一列」「gallery 手机两列」
 *   「logos iPad 三列」「milestones 手机两列、`1` 例外一列」「pricing 的 `1` 在 iPad 仍是一列」全部是这一条的特例。
 *
 * ── 实现：四种画法，一条规矩 ───────────────────────────────────────────────────────────────────
 *   规矩（几列）只有上面那一条；**怎么把「几列」画出来**按块原来那一种（`render`），一个字节不改：
 *     grid     `display: grid; grid-template-columns: repeat(var(--items-cols), minmax(0, 1fr))`（blog / gallery / logos / testimonials）
 *     flex     `display: flex; flex-wrap: wrap`，条目 `width: calc((100% - (n − 1) × 列距) / n)`，列距读块自己的变量
 *              （`gapVar`：faq --fq-gap · milestones --mi-gap · pricing --pr-gap · team --tm-gap）；`auto` = `flex: 1 1 0`
 *     percent  Bootstrap `.row` 里的条目按百分比宽（100% / 50% / 33.3333% / 25%，features 的 `.fx-grid` 是 `.row g-6`）
 *     columns  CSS 多列 `column-count`（gallery 的原图瀑布流）
 *   🔴 为什么不收成一种画法（#1537 实测）：把 flex 那 5 个块（faq / milestones / pricing / team，加上 features 的 Bootstrap 百分比）换成 grid 之后，列数在 465 格（9 块 × 每个预设 × 每个列数值
 *      × 1440 / 820 / 390）里 0 格变，但有 35 格的条目位置差了零点零几像素（全在 1440、全是 3 / 4 列或 auto：分不尽的宽度，
 *      grid 轨道、flex 的 calc、Bootstrap 的 33.3333% 各自取整不同；`flex: 1 1 0` 是先扣掉各自的内边距 / 描边再均分，grid 是轨道
 *      一样宽）⟹ 截图就不逐像素相同了，而本票 AC2 要求逐像素相同。要统一画法是一次有意的外观改动，不归本票。
 *   🔴 不引入横向负边距：5 个 flex 块的 block.css 里都写着「不用负边距 —— 390 上溢出 4px」（#1475 / #1482 量出来的）。这里一条
 *      margin 都不写；features 的 `.row` 负边距 + 条目内边距是 Bootstrap 自己的，原来就在。
 *   列距 / 行距（`gap` / `column-gap` / `row-gap` / 那几个 `--xx-gap`）**不归这里**，照旧写在各块 block.css：它们不是「几列」。
 *   列数也写进变量 `--items-cols`，块里要按列数算别的东西时读它（features 的连线长度）。
 *   📌 两处跟「一个字节不改」不完全一样的地方（#1537 QA1 指出，预设上量不出差，写在这里免得下一个人以为没有）：
 *     · testimonials 一列时，原来写 `grid-template-columns: 1fr`，现在是 `repeat(1, minmax(0, 1fr))`。`1fr` 有 min-content 下限，
 *       `minmax(0, 1fr)` 没有 ⟹ 条目里出现很长的不可断词时，两者会分叉（原来撑宽、现在压窄）。
 *     · features 原来在 list 排法下用 `--fx-cols: 1 !important` 把列数钉成 1；现在 `--items-cols` 在 list 下照样跟旋钮走（2/3/4）。
 *       今天读它的只有连线长度那条规则，而那条挂在 `[data-items-layout="grid"]` 上 ⟹ 看不出。🔴 以后谁写一条【不分排法】、
 *       又读 `--items-cols` 的规则，list 下读到的不是 1 —— 要么那条规则自己限定 grid 排法，要么给 features 加一条 capWhen。
 *
 * ── manifest 里怎么写 ─────────────────────────────────────────────────────────────────────────
 *   "itemsGrid": {
 *     "knob": "membersColumns",                 // 管列数的那个旋钮（取值从 slots.options.knobs 里读）
 *     "phone": 1, "tablet": 2,                  // 两个上限
 *     "grids": [                                // 哪些容器按它排（一个块可以有几个：testimonials 的 grid + 轮播 slide）
 *       { "container": ".tm-grid", "render": "flex", "item": ".tm-member", "gapVar": "--tm-gap" },
 *       { "container": ".gl-grid", "when": "[data-items-layout=\"grid\"][data-item-shape=\"original\"]", "render": "columns" }
 *     ],
 *     "capWhen": [ { "when": "[data-plan-style=\"divided\"]", "below": 992, "cols": 1 } ]   // 可选：某个条件下压成几列
 *   }
 *   `when` 接在 `[data-block="<块>"]` 后面（根元素上的属性条件）；`render` 缺省是 grid；flex / percent 要写 `item`
 *   （条目的块前缀 class），flex 还要写 `gapVar`（列距变量）。grid / columns 也写 `item`（条目有块前缀 class 的话）—— 生成器不用它，
 *   `scripts/items-grid.test.js` 拿它认条目（#1537 r4：没写的话后代组合 `.bl-grid .bl-post` 认不出来）。
 */
'use strict';

const BREAKPOINTS = [
  { key: 'phone', media: null },
  { key: 'tablet', media: '(min-width: 768px)' },
  { key: 'desktop', media: '(min-width: 992px)' },
];

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** 一个取值在某个宽度上排几列：数字，或 `'auto'`（≥992 一行均分）。 */
function colsAt(value, bp, caps) {
  const cap = bp === 'desktop' ? Infinity : caps[bp];
  if (value === 'auto') return cap === Infinity ? 'auto' : cap;
  const n = Number(value);
  return Math.min(n, cap);
}

/** manifest → 它的网格声明（没有就是 null）；形状写坏了抛错（构建当场红，不静默跳过）。 */
function itemsGridOf(manifest, block) {
  const g = manifest && manifest.itemsGrid;
  if (g === undefined) return null;
  const bad = (m) => { throw new Error(`blocks/${block}/manifest.json itemsGrid: ${m}`); };
  if (!g || typeof g !== 'object') bad('必须是对象');
  const knobs = Object.values(manifest.slots || {}).flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : []));
  const knob = knobs.find((k) => k.name === g.knob);
  if (!knob) bad(`knob "${g.knob}" 不在 slots.*.knobs 里`);
  for (const k of ['phone', 'tablet']) if (!Number.isInteger(g[k]) || g[k] < 1) bad(`${k} 必须是 ≥1 的整数`);
  for (const v of knob.values) if (v !== 'auto' && !/^[1-9][0-9]*$/.test(v)) bad(`旋钮 ${g.knob} 的取值 "${v}" 不是列数也不是 auto`);
  if (!Array.isArray(g.grids) || !g.grids.length) bad('grids 至少一个');
  for (const x of g.grids) {
    if (!x || typeof x.container !== 'string' || !/^\.[a-z][a-z0-9-]*$/.test(x.container)) bad(`container 必须是一个块前缀 class（读到 ${JSON.stringify(x && x.container)}）`);
    if (x.when !== undefined && (typeof x.when !== 'string' || !/^(\[[^\]]+\]|:not\(\[[^\]]+\]\))+$/.test(x.when))) bad(`when 只能是根元素上的属性条件（读到 ${JSON.stringify(x.when)}）`);
    if (x.render !== undefined && !['grid', 'flex', 'percent', 'columns'].includes(x.render)) bad('render 只能是 grid / flex / percent / columns');
    if ((x.render === 'flex' || x.render === 'percent') && (typeof x.item !== 'string' || !/^\.[a-z][a-z0-9-]*$/.test(x.item))) bad(`render ${x.render} 要写 item（条目的块前缀 class）`);
    if (x.render === 'flex' && (typeof x.gapVar !== 'string' || !/^--[a-z][a-z0-9-]*$/.test(x.gapVar))) bad('render flex 要写 gapVar（列距变量，如 --tm-gap）');
    if ((x.render === 'columns' || x.render === 'percent') && knob.values.includes('auto')) bad(`render ${x.render} 不支持 auto`);
  }
  for (const c of g.capWhen || []) {
    if (!c || typeof c.when !== 'string' || !/^(\[[^\]]+\])+$/.test(c.when)) bad('capWhen.when 只能是根元素上的属性条件');
    if (c.below !== 768 && c.below !== 992) bad('capWhen.below 只能是 768 / 992');
    if (!Number.isInteger(c.cols) || c.cols < 1) bad('capWhen.cols 必须是 ≥1 的整数');
  }
  return { ...g, values: knob.values.slice(), attr: `data-${kebab(g.knob)}` };
}

/** 一个块的条目网格 CSS（没有声明就是空串）。规则全部以 `[data-block="<块>"]` 开头（build-blocks.js 的归属检查照样过）。 */
function itemsGridCss(manifest, block) {
  const g = itemsGridOf(manifest, block);
  if (!g) return '';
  const caps = { phone: g.phone, tablet: g.tablet };
  const out = [`/* 条目网格（${g.knob}：手机 ≤${g.phone} · iPad ≤${g.tablet} · ≥992 按旋钮）—— 由 scripts/block-build/items-grid.js 生成，别在 block.css 里写 */`];
  const rule = (sel, decls) => `${sel} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`;
  for (const grid of g.grids) {
    const render = grid.render || 'grid';
    const root = `[data-block="${block}"]${grid.when || ''}`;
    const at = (v) => `${root}${v === undefined ? '' : `[${g.attr}="${v}"]`}`;
    const C = (v) => `${at(v)} ${grid.container}`;
    const I = (v) => `${at(v)} ${grid.item}`;
    const pct = (n) => `${Number((100 / n).toFixed(4))}%`; // 100% / 50% / 33.3333% / 25%（features 原来写的就是这几个字面量）
    const base = () => {
      const cols = `--items-cols: ${g.phone}`;
      if (render === 'grid') return [rule(C(), [cols, 'display: grid', 'grid-template-columns: repeat(var(--items-cols), minmax(0, 1fr))'])];
      if (render === 'columns') return [rule(C(), [cols, 'column-count: var(--items-cols)'])];
      if (render === 'flex') {
        return [rule(C(), [cols, 'display: flex', 'flex-wrap: wrap']),
          rule(I(), ['flex: 0 0 auto', `width: calc((100% - (var(--items-cols) - 1) * var(${grid.gapVar})) / var(--items-cols))`])];
      }
      return [rule(C(), [cols]), rule(I(), ['flex: 0 0 auto', `width: ${pct(g.phone)}`])];
    };
    const one = (v, n) => {
      if (n === 'auto') {
        if (render === 'grid') return [rule(C(v), ['grid-template-columns: none', 'grid-auto-flow: column', 'grid-auto-columns: minmax(0, 1fr)'])];
        return [rule(I(v), ['flex: 1 1 0', 'width: auto'])];
      }
      const out2 = [rule(C(v), [`--items-cols: ${n}`])];
      if (render === 'percent') out2.push(rule(I(v), [`width: ${pct(n)}`]));
      return out2;
    };
    const prev = {};
    for (const { key, media } of BREAKPOINTS) {
      const rules = key === 'phone' ? base() : [];
      for (const v of g.values) {
        const n = colsAt(v, key, caps);
        if (n === prev[v]) continue;
        prev[v] = n;
        if (key === 'phone' && n === g.phone) continue; // 同段首那条
        rules.push(...one(v, n));
      }
      if (!rules.length) continue;
      out.push(media ? `@media ${media} {\n${rules.map((r) => r.replace(/^/gm, '  ')).join('\n')}\n}` : rules.join('\n'));
    }
    for (const c of g.capWhen || []) {
      const r = [rule(`${root}${c.when} ${grid.container}`, [`--items-cols: ${c.cols}`])];
      if (render === 'percent') r.push(rule(`${root}${c.when} ${grid.item}`, [`width: ${pct(c.cols)}`]));
      out.push(`@media (max-width: ${c.below - 0.02}px) {\n${r.map((x) => x.replace(/^/gm, '  ')).join('\n')}\n}`);
    }
  }
  return out.join('\n');
}

module.exports = { itemsGridOf, itemsGridCss, colsAt, BREAKPOINTS };
