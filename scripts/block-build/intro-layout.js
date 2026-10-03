/**
 * intro-layout.js — 块头排版（`introAlign` / `introPosition` 两个旋钮）的唯一一份（#1535）。
 *
 * 11 个块（blog contact faq features gallery logos milestones pricing reviews team testimonials）原来各自在 `block.css`
 * 里抄一遍同一套规则，各块只差几个参数（侧列 33.33% 还是 41.67%、要不要 sticky、主列叫什么）。现在块的 manifest 只
 * **声明**它的块头（顶层 `introLayout`），规则由这里生成、拼进 `public/shapes.css` 里那个块的段首
 * （`build-blocks.js` §buildShapesCss）。块自己的 `block.css` 里不许再写块头排版（`scripts/intro-layout.test.js` 守）。
 *
 * ── 规矩（照 #1486 T6.1）────────────────────────────────────────────────────────────────────────
 *   introAlign    块头的字 left / center / right；center 在 ≥992 最宽 80% 居中，<992 与 left / right 都是 100%。
 *   introPosition left / right（≥992）= 块头一列（`side`）+ 主列（100% − side），块头列 sticky；right 行反向。
 *                 小屏：left / top 块头在上，right / bottom 块头在下（frame 列反向）。侧列里块头的字不限宽。
 *   跟随（`follow`）：块自己的部件按 introAlign 摆 —— 三种样子，各块只点名部件：
 *     justify  按钮行 / 评分条：center → justify-content: center，right → flex-end
 *     margin   卡片 / 表单：center → 左右 auto，right → 左 auto
 *     text     一行字：center → text-align: center，right → end
 *
 * ── 不归这里的 ──────────────────────────────────────────────────────────────────────────────────
 *   块自己的部件跟着块头的开关**换布局**（pricing 的亮点在 center 时换两列 / 四列网格、features / milestones 块头图在
 *   侧列时改竖排、reviews 块头在上下时网格最多 4 列、logos 的 row 排法在侧列时靠左、contact 的 beside、faq 的 help
 *   在侧列时归零）—— 一条一个样，没有族，留在各块 `block.css`。哪几条是这一类，`intro-layout.test.js` 里有逐条清单。
 *
 * ── manifest 里怎么写 ───────────────────────────────────────────────────────────────────────────
 *   "introLayout": {
 *     "text": ".bl-intro-text",                 // 块头的字（introAlign 管它）
 *     "frame": ".bl-frame",                     // ↓ 四个一起写或一起不写：不写 = 这个块的 introPosition 不是 left/right/top/bottom（contact）
 *     "introCol": ".bl-introcol",
 *     "mainCol": ".bl-itemscol",
 *     "side": "33.3333%",                       // ≥992 块头列宽；主列 = 100% − side
 *     "sticky": true,                           // 可选，缺省 true；logos 不 sticky
 *     "stackGap": "2rem",                       // 可选：块头叠在主列下面时（bottom、<992 的 right）跟主列隔多少（testimonials）
 *     "follow": [                               // 可选
 *       { "target": ".fx-ctas", "by": "justify" },
 *       { "target": ".ct-sidecol .ct-form", "by": "margin", "when": "[data-side-position=\"bottom\"]" },
 *       { "target": ".pr-billing-wrap", "by": "text", "positions": ["top", "bottom"] }
 *     ]
 *   }
 *   `when` 接在 `[data-block="<块>"]` 后面（根元素上的属性条件）；`positions` = 只在这几个 introPosition 下跟。
 */
'use strict';

const CLS = /^\.[a-z][a-z0-9-]*$/;
const PATH = /^\.[a-z][a-z0-9-]*( \.[a-z][a-z0-9-]*)*$/;
const PCT = /^\d+(\.\d+)?%$/;
const BY = {
  justify: { center: ['justify-content: center'], right: ['justify-content: flex-end'] },
  margin: { center: ['margin-inline-start: auto', 'margin-inline-end: auto'], right: ['margin-inline-start: auto'] },
  text: { center: ['text-align: center'], right: ['text-align: end'] },
};

const knobsOf = (manifest) => Object.values(manifest.slots || {}).flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : []));

/** manifest → 它的块头声明（没有就是 null）；形状写坏了抛错（构建当场红，不静默跳过）。 */
function introLayoutOf(manifest, block) {
  const L = manifest && manifest.introLayout;
  if (L === undefined) return null;
  const bad = (m) => { throw new Error(`blocks/${block}/manifest.json introLayout: ${m}`); };
  if (!L || typeof L !== 'object') bad('必须是对象');
  const knobs = knobsOf(manifest);
  const align = knobs.find((k) => k.name === 'introAlign');
  const pos = knobs.find((k) => k.name === 'introPosition');
  if (!align) bad('块没有 introAlign 旋钮');
  for (const v of ['left', 'center', 'right']) if (!align.values.includes(v)) bad(`introAlign 少了 ${v}`);
  if (typeof L.text !== 'string' || !CLS.test(L.text)) bad(`text 必须是一个块前缀 class（读到 ${JSON.stringify(L.text)}）`);
  const cols = ['frame', 'introCol', 'mainCol'];
  const hasFrame = cols.some((k) => L[k] !== undefined);
  if (hasFrame) {
    for (const k of cols) if (typeof L[k] !== 'string' || !CLS.test(L[k])) bad(`${k} 必须是一个块前缀 class（读到 ${JSON.stringify(L[k])}）`);
    if (!pos) bad('写了 frame 但块没有 introPosition 旋钮');
    for (const v of ['left', 'right', 'top', 'bottom']) if (!pos.values.includes(v)) bad(`introPosition 少了 ${v}（frame 那套规则按 left / right / top / bottom 写）`);
    if (typeof L.side !== 'string' || !PCT.test(L.side) || !(parseFloat(L.side) > 0 && parseFloat(L.side) < 100)) bad('side 必须是 0–100 之间的百分数');
    if (L.sticky !== undefined && typeof L.sticky !== 'boolean') bad('sticky 只能是 true / false');
    if (L.stackGap !== undefined && (typeof L.stackGap !== 'string' || !/^\d+(\.\d+)?rem$/.test(L.stackGap))) bad('stackGap 必须是 rem 长度');
  } else {
    for (const k of ['side', 'sticky', 'stackGap']) if (L[k] !== undefined) bad(`${k} 要跟 frame / introCol / mainCol 一起写`);
  }
  for (const f of L.follow || []) {
    if (!f || typeof f.target !== 'string' || !PATH.test(f.target)) bad(`follow.target 必须是块前缀 class（可以带后代，读到 ${JSON.stringify(f && f.target)}）`);
    if (!BY[f.by]) bad(`follow.by 只能是 ${Object.keys(BY).join(' / ')}`);
    if (f.when !== undefined && (typeof f.when !== 'string' || !/^(\[[^\]]+\])+$/.test(f.when) || /data-intro-/.test(f.when))) bad('follow.when 只能是根元素上的属性条件（不含 data-intro-*）');
    if (f.positions !== undefined) {
      if (!pos || !Array.isArray(f.positions) || !f.positions.length || f.positions.some((p) => !pos.values.includes(p))) bad('follow.positions 必须是 introPosition 的取值');
    }
  }
  return { ...L, sticky: L.sticky !== false, follow: L.follow || [], hasFrame };
}

/** 一个块的块头排版 CSS（没有声明就是空串）。规则全部以 `[data-block="<块>"]` 开头（build-blocks.js 的归属检查照样过）。 */
function introLayoutCss(manifest, block) {
  const L = introLayoutOf(manifest, block);
  if (!L) return '';
  const R = `[data-block="${block}"]`;
  const A = (v) => `${R}[data-intro-align="${v}"]`;
  const P = (v) => `${R}[data-intro-position="${v}"]`;
  const rule = (sels, decls) => `${sels.join(',\n')} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`;
  const media = (q, rules) => `@media ${q} {\n${rules.map((r) => r.replace(/^/gm, '  ')).join('\n')}\n}`;
  const out = [`/* 块头排版（introAlign${L.hasFrame ? ' / introPosition' : ''}）—— 由 scripts/block-build/intro-layout.js 生成，别在 block.css 里写 */`];

  // introAlign：块头的字 + 跟随的部件。
  out.push(rule([`${A('center')} ${L.text}`], ['text-align: center']));
  out.push(rule([`${A('right')} ${L.text}`], ['text-align: end']));
  for (const v of ['center', 'right']) {
    for (const f of L.follow) {
      const sel = (p) => `${R}${f.when || ''}[data-intro-align="${v}"]${p ? `[data-intro-position="${p}"]` : ''} ${f.target}`;
      out.push(rule(f.positions ? f.positions.map(sel) : [sel()], BY[f.by][v]));
    }
  }
  out.push(media('(min-width: 992px)', [rule([`${A('center')} ${L.text}`], ['width: 100%', 'max-width: 80%', 'margin-inline: auto'])]));

  // introPosition：frame 的方向 + ≥992 两列。
  if (L.hasFrame) {
    const lr = (el) => [`${P('left')} ${el}`, `${P('right')} ${el}`];
    out.push(rule([`${P('bottom')} ${L.frame}`], ['flex-direction: column-reverse']));
    if (L.stackGap) out.push(rule([`${P('bottom')} ${L.introCol}`], [`margin-top: ${L.stackGap}`]));
    const narrow = [rule([`${P('right')} ${L.frame}`], ['flex-direction: column-reverse'])];
    if (L.stackGap) narrow.push(rule([`${P('right')} ${L.introCol}`], [`margin-top: ${L.stackGap}`]));
    out.push(media('(max-width: 991.98px)', narrow));
    const main = `${Number((100 - parseFloat(L.side)).toFixed(4))}%`;
    out.push(media('(min-width: 992px)', [
      rule(lr(L.introCol), ['flex: 0 0 auto', `width: ${L.side}`, ...(L.sticky ? ['position: sticky', 'top: 2rem', 'align-self: flex-start'] : [])]),
      rule(lr(L.mainCol), ['flex: 0 0 auto', `width: ${main}`]),
      rule(lr(L.text), ['max-width: none', 'margin: 0']),
      rule([`${P('right')} ${L.frame}`], ['flex-direction: row-reverse']),
    ]));
  }
  return out.join('\n');
}

module.exports = { introLayoutOf, introLayoutCss, BY };
