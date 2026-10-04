/**
 * media-layout.js — 块级 / 块头那张图的位置（`image` / `blockImage` / `introImage` / `itemsImage` 这类旋钮）的唯一一份（#1536）。
 *
 * 6 个块（content cta features hero milestones page-header）原来各自在 `block.css` 里写一遍「图和文字怎么排」，
 * hero 还走 Bootstrap 的 `row` + `col-lg-6`，图宽各写各的（40% / 42% / 45% / 50%）。现在块的 manifest 只**声明**
 * 哪个旋钮管哪一组元素（顶层 `mediaLayout`），规则由这里生成、拼进 `public/shapes.css` 里那个块的段首
 * （`build-blocks.js` §buildShapesCss）。块自己的 `block.css` / `shape.css` 里不许再写这类规则
 * （`scripts/media-layout.test.js` 守）。
 *
 * ── 规矩（#1536 做什么 1，Chris 2026-10-02 / 2026-10-03）──────────────────────────────────────────
 *   ① DOM 里文字在前、图在后（读屏 / AI 按 DOM 读，标题先于配图）。图在哪一边全靠下面的方向规则，不靠 DOM 顺序。
 *   ② 上下叠时图和文字隔 2.5rem；left / top 图在上，right / bottom 图在下（桌面在左的，小屏就在上）。
 *   ③ ≥992 left / right 两栏，栏距 4rem，图栏宽按 GEOMETRY 算。今天是 (A)「图栏和文字栏对半分」：
 *      图 = (行宽 − 栏距) × 0.5，1440 下 1288 宽的行 ⟹ 图 612 / 文字 612，跟 hero 原来的 col-lg-6 一个像素不差。
 *      (B)「图占行宽一半」留在 GEOMETRY 里当另一个取值（Chris 没选它）；改几何 = 改这里一行。
 *
 * ── 不归这里的 ──────────────────────────────────────────────────────────────────────────────────
 *   条目层的图（blog `itemImage`、features `itemImage`）—— 那是卡片里的缩略图，不构成「文字栏 vs 图栏」，本票不动。
 *   块自己的部件跟着别的旋钮换样子（features / milestones 块头在侧列时图改竖排、top / bottom 的图限宽居中、图的比例）
 *   —— 一条一个样，留在各块 `block.css`；它们排在这段生成规则后面，照旧能盖它。
 *
 * ── manifest 里怎么写 ───────────────────────────────────────────────────────────────────────────
 *   "mediaLayout": [
 *     { "knob": "image", "row": ".co-outer", "text": ".co-frame", "media": ".co-img" }
 *   ]
 *   knob   这个块的图位旋钮名；根元素上的属性是它的 kebab 形（introImage ⟹ data-intro-image）
 *   row    装着文字和图的那一层（它的直接子元素就是 text 和 media，DOM 里 text 在前）
 *   share  可选：≥992 图栏占「行宽 − 栏距」的几成（0–1，缺省 0.5）。今天没有块写它。
 *   旋钮里 left / right / top / bottom 有哪几个就生成哪几个；none / background 不归这里。
 */
'use strict';

const CLS = /^\.[a-z][a-z0-9-]*$/;
const POSITIONS = ['left', 'right', 'top', 'bottom'];
const GAP_WIDE = '4rem';
const GAP_STACK = '2.5rem';

// 图栏宽怎么算（Chris 2026-10-03 拍板 A）。share = 图栏那一份占多少。
const GEOMETRY = {
  A: (share) => `calc((100% - ${GAP_WIDE}) * ${share})`, // 图栏和文字栏对半分（栏距不算进任何一栏）
  B: (share) => `${share * 100}%`, //                        图占行宽一半，栏距从文字栏里扣
};
const CHOSEN = 'A';

const knobsOf = (manifest) => Object.values(manifest.slots || {}).flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : []));
const attrOf = (knob) => `data-${knob.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** manifest → 它的图位声明（没有就是 []）；形状写坏了抛错（构建当场红，不静默跳过）。 */
function mediaLayoutOf(manifest, block) {
  const L = manifest && manifest.mediaLayout;
  if (L === undefined) return [];
  const bad = (m) => { throw new Error(`blocks/${block}/manifest.json mediaLayout: ${m}`); };
  if (!Array.isArray(L) || !L.length) bad('必须是非空数组');
  const knobs = knobsOf(manifest);
  const seen = new Set();
  return L.map((e, i) => {
    if (!e || typeof e !== 'object') bad(`[${i}] 必须是对象`);
    const knob = knobs.find((k) => k.name === e.knob);
    if (!knob) bad(`[${i}].knob：块没有叫 ${JSON.stringify(e.knob)} 的旋钮`);
    if (seen.has(e.knob)) bad(`[${i}].knob：${e.knob} 写了两次`);
    seen.add(e.knob);
    for (const k of ['row', 'text', 'media']) if (typeof e[k] !== 'string' || !CLS.test(e[k])) bad(`[${i}].${k} 必须是一个块前缀 class（读到 ${JSON.stringify(e[k])}）`);
    if (e.share !== undefined && !(typeof e.share === 'number' && e.share > 0 && e.share < 1)) bad(`[${i}].share 必须是 0–1 之间的数`);
    const positions = POSITIONS.filter((p) => knob.values.includes(p));
    if (!positions.includes('left') || !positions.includes('right')) bad(`[${i}]：旋钮 ${e.knob} 至少要有 left / right`);
    return { knob: e.knob, attr: attrOf(e.knob), row: e.row, text: e.text, media: e.media, share: e.share === undefined ? 0.5 : e.share, positions };
  });
}

/** 一个块的图位 CSS（没有声明就是空串）。规则全部以 `[data-block="<块>"]` 开头（build-blocks.js 的归属检查照样过）。 */
function mediaLayoutCss(manifest, block, geometry = CHOSEN) {
  const L = mediaLayoutOf(manifest, block);
  if (!L.length) return '';
  const width = GEOMETRY[geometry];
  if (!width) throw new Error(`media-layout.js：没有叫 ${geometry} 的几何`);
  const rule = (sels, decls) => `${sels.join(',\n')} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`;
  const media = (q, rules) => `@media ${q} {\n${rules.map((r) => r.replace(/^/gm, '  ')).join('\n')}\n}`;
  const out = [`/* 图的位置（${L.map((e) => e.knob).join(' / ')}）—— 由 scripts/block-build/media-layout.js 生成，别在 block.css 里写 */`];
  for (const e of L) {
    const at = (p, el) => `[data-block="${block}"][${e.attr}="${p}"] ${el}`;
    const each = (ps, el) => ps.map((p) => at(p, el));
    const first = ['left', 'top'].filter((p) => e.positions.includes(p)); // 图在上：DOM 里图在后，所以列反向
    out.push(rule(each(e.positions, e.row), ['display: flex', 'flex-direction: column', `gap: ${GAP_STACK}`]));
    out.push(rule(each(first, e.row), ['flex-direction: column-reverse']));
    out.push(rule([...each(e.positions, e.text), ...each(e.positions, e.media)], ['min-width: 0']));
    out.push(media('(min-width: 992px)', [
      rule(each(['left', 'right'], e.row), ['flex-direction: row', 'align-items: center', `gap: ${GAP_WIDE}`]),
      rule([at('left', e.row)], ['flex-direction: row-reverse']),
      rule(each(['left', 'right'], e.media), [`flex: 0 0 ${width(e.share)}`]),
      rule(each(['left', 'right'], e.text), ['flex: 1 1 0']),
    ]));
  }
  return out.join('\n');
}

module.exports = { mediaLayoutOf, mediaLayoutCss, attrOf, GEOMETRY, CHOSEN, GAP_WIDE, GAP_STACK };
