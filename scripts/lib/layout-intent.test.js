#!/usr/bin/env node
/**
 * layout-intent.test.js — 排版意图的词表、合并规则与每一根轴的两臂（#1332）。
 *
 * 跑法:  node scripts/lib/layout-intent.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ══ 为什么这份文件存在 ══════════════════════════════════════════════════
 * 检查 ⑨ 的判据住在 `layout-intent.mjs` 里，而它平时只在**起了浏览器**的那条路上跑
 * （`theme-css-invariants.mjs`，CI 的 theme-css 那一步）。那条路一轮 4 分钟，而且它只喂得到
 * 「今天盘上真实的几何」—— 一条判据写反了（该红的读成绿）在那条路上是**看不出来的**：真实的页面
 * 本来就该绿。所以每一根轴在这里各喂一对数：一臂该绿、一臂该红，两臂读到同一个值就说明尺子坏了。
 *
 * ══ 🔴 夹具的坑 ════════════════════════════════════════════════════════
 * `judgeIntent` 回的 `checks` 是**这一格真正执行了几条断言**，正文 AC2 拿它的最小值当闸。所以每一格
 * 都要核 `checks` 里有没有那条轴的名字 —— 只核 `problems.length` 的话，一条「被跳过」的判据和一条
 * 「判过且通过」的判据长得一模一样。
 */

'use strict';

const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');
let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

let bm; let li;
try {
  bm = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
} catch (e) { die(`require block-manifest.js 失败: ${e.message}`); }

(async () => {
  try {
    li = await import(path.join(NEXT, 'scripts', 'lib', 'layout-intent.mjs'));
  } catch (e) { die(`import layout-intent.mjs 失败: ${e.message}`); }

  const { judgeIntent, VOCAB, INTENT_AXES } = li;
  if (typeof judgeIntent !== 'function') die('layout-intent.mjs 没导出 judgeIntent');

  // ── ① 一份词表，两处读 ────────────────────────────────────────────────
  console.log('── ① 词表只有一份');
  check(JSON.stringify(bm.LAYOUT_INTENT_VOCAB.axes) === JSON.stringify(VOCAB.axes),
    '校验器（block-manifest.js）与守卫（layout-intent.mjs）读到的是同一份词表');
  // 🔴 别把轴的条数写死成一个字面量再断言它自己 —— 那样加一根轴就得回来改两处。这里断言的是
  //    「顺序与内容」：#1332 立的那五根在前、#1381 加的七根在后，而条数由这张表自己说了算。
  const AXES_1332 = ['items', 'item_wrap', 'headline', 'media', 'columns'];
  const AXES_1381 = ['align', 'cross', 'ratio', 'media_side', 'order', 'item_parts', 'inner'];
  check(INTENT_AXES.join(',') === AXES_1332.concat(AXES_1381).join(','),
    `${INTENT_AXES.length} 根轴：${INTENT_AXES.join(' / ')}`);

  // ── ② 合并规则与完整性 ───────────────────────────────────────────────
  console.log('── ② 块级默认 + 形态覆盖，合并后必须齐全');
  const FULL = {
    items: 'grid', item_wrap: 'avoid', headline: 'above', media: 'none', columns: 'two',
    align: 'stretch', cross: 'stretch', ratio: 'even', media_side: 'none', order: 'dom', item_parts: 'stack', inner: 'none',
  };
  const m = { type: 'probe', layout_intent: FULL, shapes: [{ name: 'a', needs: [] }, { name: 'b', needs: [], layout_intent: { columns: 'three' } }] };
  check(bm.layoutIntentFor(m, 'a').columns === 'two', '形态没写就用块级默认（a.columns = two）');
  check(bm.layoutIntentFor(m, 'b').columns === 'three' && bm.layoutIntentFor(m, 'b').items === 'grid',
    '形态写了就覆盖那一根轴，别的轴仍取默认（b.columns = three · b.items = grid）');
  check(bm.layoutIntentFor(m, 'nope') === null, '清单里没有的形态回 null（跟「意图不全」分得开）');
  check(bm.layoutIntentProblems({ items: 'grid' }).length === INTENT_AXES.length - 1,
    `只写一根轴 ⟹ 报缺 ${INTENT_AXES.length - 1} 根`);
  check(bm.layoutIntentProblems({ ...m.layout_intent, media: 'sideways' })[0].includes('"media"'),
    '词表外的值被点名（media: "sideways"）');
  check(bm.layoutIntentProblems(m.layout_intent).length === 0, '每根轴都在、且都在词表里 ⟹ 0 条');

  // ── ③ 每一根轴两臂 ───────────────────────────────────────────────────
  console.log('── ③ 每一根轴：一臂该绿、一臂该红');
  const box = (o) => ({ cls: o.cls || 'x', dom: o.dom || 0, left: o.x, right: o.x + o.w, top: o.y, bottom: o.y + (o.h || 20), width: o.w, height: o.h || 20, lines: o.lines || 1, scrollWidth: o.w, clientWidth: o.w });
  const rig = (over) => ({
    block: 'probe', shape: 's', display: 'grid', flexDirection: 'row', flexWrap: 'nowrap',
    trackCount: 2, occupied: 2, spanning: 0, placeable: 2,
    root: { left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, contentLeft: 0, contentRight: 1000, gap: 0 },
    scrollWidth: 1000, clientWidth: 1000, head: null, media: null, body: null, after: null,
    itemCls: 'probe__item', items: [],
    // #1381 的七根新轴，默认是「这一格什么都量不到」：没有可量对齐的零件、没换过次序、
    // 项里没有第二个零件、没有主内层容器、根上没有轨道。逐根轴的两臂在下面单独喂。
    alignRef: null, orderInverted: { root: false, item: false, kids: 2, itemKids: 2 },
    partsSideBySide: null, inner: null, innerFree: null, trackWidths: [],
    ...over,
  });
  const INTENT = {
    items: 'none', item_wrap: 'allow', headline: 'none', media: 'none', columns: 'two',
    align: 'stretch', cross: 'stretch', ratio: 'none', media_side: 'none', order: 'dom', item_parts: 'none', inner: 'none',
  };
  const run = (r, intent) => judgeIntent(r, { ...INTENT, ...intent }, { phone: false, where: '/probe', arm: '两臂' });
  const arm = (label, axis, greenR, greenI, redR, redI) => {
    const g = run(greenR, greenI); const b2 = run(redR, redI);
    const named = (x) => x.checks.some((c) => c.startsWith(axis));
    if (!named(g) || !named(b2)) { bad(`${label}：那根轴的断言没被执行（绿臂 ${g.checks.join(',')} · 红臂 ${b2.checks.join(',')}）`); return; }
    // 🔴 红臂只要求 ≥1 条，不要求恰好 1 条：`items:row` 一个词挂着**两条**断言（横排 + 桌面宽下只有
    //    一行），一项一行的那一臂两条都该红。写死「恰好 1 条」会把一条判据判成失败（第一版就是）。
    check(g.problems.length === 0 && b2.problems.length >= 1,
      `${label}：该绿的 ${g.problems.length} 条 / 该红的 ${b2.problems.length} 条${b2.problems.length ? ` —— “${b2.problems[0].slice(0, 80)}…”` : ''}`);
  };
  const twoItems = (sameRow) => [box({ cls: 'probe__item', dom: 1, x: 0, y: 0, w: 400 }),
    box({ cls: 'probe__item', dom: 2, x: sameRow ? 500 : 0, y: sameRow ? 0 : 100, w: 400 })];
  arm('items:row', 'items',
    rig({ items: twoItems(true) }), { items: 'row' },
    rig({ items: twoItems(false) }), { items: 'row' });
  arm('items:grid', 'items',
    rig({ items: twoItems(true) }), { items: 'grid' },
    rig({ items: twoItems(false) }), { items: 'grid' });
  arm('items:stack', 'items',
    rig({ items: twoItems(false) }), { items: 'stack' },
    rig({ items: twoItems(true) }), { items: 'stack' });
  arm('items:none', 'items',
    rig({ items: [box({ x: 0, y: 0, w: 400 })] }), { items: 'none' },
    rig({ items: twoItems(true) }), { items: 'none' });
  arm('item_wrap:avoid', 'item-wrap',
    rig({ items: [box({ cls: 'probe__item', x: 0, y: 0, w: 100, lines: 1 })] }), { item_wrap: 'avoid' },
    rig({ items: [box({ cls: 'probe__item', x: 0, y: 0, w: 100, lines: 2 })] }), { item_wrap: 'avoid' });
  const headRig = (hy, iy, hx, ix) => rig({
    head: box({ cls: 'probe__headline', dom: 0, x: hx, y: hy, w: 300 }),
    items: [box({ cls: 'probe__item', dom: 1, x: ix, y: iy, w: 400 })],
  });
  arm('headline:above', 'headline-above',
    headRig(0, 100, 0, 0), { headline: 'above', items: 'stack' },
    headRig(100, 0, 0, 0), { headline: 'above', items: 'stack' });
  arm('headline:side', 'headline-side',
    headRig(0, 0, 0, 400), { headline: 'side', items: 'stack' },
    headRig(0, 100, 0, 0), { headline: 'side', items: 'stack' });
  const mediaRig = (mx, my, mw, mh) => rig({
    media: box({ cls: 'probe__media', dom: 0, x: mx, y: my, w: mw, h: mh }),
    body: box({ cls: 'probe__body', dom: 1, x: 0, y: 200, w: 400, h: 100 }),
  });
  arm('media:cover', 'media-cover',
    mediaRig(0, 0, 1000, 400), { media: 'cover' },
    mediaRig(0, 0, 300, 100), { media: 'cover' });
  arm('media:side', 'media-side',
    mediaRig(500, 200, 400, 100), { media: 'side', media_side: 'end' },
    mediaRig(0, 0, 400, 100), { media: 'side', media_side: 'start' });
  arm('media:above', 'media-above',
    mediaRig(0, 0, 400, 100), { media: 'above' },
    mediaRig(0, 400, 400, 100), { media: 'above' });
  arm('media:below', 'media-below',
    mediaRig(0, 400, 400, 100), { media: 'below' },
    mediaRig(0, 0, 400, 100), { media: 'below' });
  arm('columns:two', 'columns',
    rig({ occupied: 2, placeable: 2 }), { columns: 'two' },
    rig({ occupied: 1, placeable: 2 }), { columns: 'two' });
  arm('columns:many', 'columns-many',
    rig({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' }), { columns: 'many' },
    rig({ display: 'flex', flexDirection: 'column', flexWrap: 'wrap' }), { columns: 'many' });

  // ── ③b #1381 的七根新轴，每根同样两臂 ────────────────────────────────
  console.log('── ③b #1381 加的七根轴：一臂该绿、一臂该红');
  // align —— 参照零件在它那个内容盒里的左右余量。三种取值各一对。
  const alignRig = (l, r2, lines = 1) => rig({ alignRef: { cls: 'probe__headline', from: 'head', left: l, right: r2, left0: 0, right0: 1000, lines } });
  arm('align:stretch', 'align', alignRig(0, 1000), { align: 'stretch' }, alignRig(300, 700), { align: 'stretch' });
  arm('align:center', 'align', alignRig(300, 700), { align: 'center' }, alignRig(0, 400), { align: 'center' });
  arm('align:start', 'align', alignRig(0, 400), { align: 'start' }, alignRig(600, 1000), { align: 'start' });
  // 🔴 「折了行而且撑满容器」那一格是**报告而不判**，不是判过 —— 分开它们的只有 checks 里有没有
  //    `align`。只看 problems 的话，被跳过和判过且通过长得一模一样（本文件头注那条坑）。
  check(!run(alignRig(0, 1000, 2), { align: 'center' }).checks.includes('align')
    && run(alignRig(0, 1000, 1), { align: 'center' }).checks.includes('align'),
    'align：文字折行且盒子跟容器一样宽 ⟹ 跳过；同一个盒子只占一行 ⟹ 照判（trusted-brands/two-row 的形状）');
  check(run(alignRig(0, 400, 2), { align: 'start' }).checks.includes('align'),
    'align：折了行但盒子比容器窄（max-width 限住的那种）⟹ 仍然判，跳过的条件里那个「而且」不能省');

  // cross —— 同一视觉行里的同级项纵向怎么对齐。
  const rowOf = (hs) => rig({ items: hs.map((h, i) => box({ cls: 'probe__item', dom: i + 1, x: i * 300, y: 0, w: 280, h })) });
  arm('cross:stretch', 'cross', rowOf([200, 200]), { cross: 'stretch', items: 'grid' }, rowOf([200, 120]), { cross: 'stretch', items: 'grid' });
  arm('cross:start', 'cross', rowOf([200, 120]), { cross: 'start', items: 'grid' }, rowOf([200, 200]), { cross: 'start', items: 'grid' });
  arm('cross:none', 'cross-none',
    rig({ items: [box({ cls: 'probe__item', x: 0, y: 0, w: 400 })] }), { cross: 'none' },
    rowOf([200, 200]), { cross: 'none' });
  check(!run(rowOf([200, 120]), { cross: 'mixed', items: 'grid' }).checks.includes('cross'),
    'cross：声明 mixed 的格子【报告而不判】（错落 / 有一项跨行时「同一行」这个分组本身不牢）');

  // ratio —— 块自己那几条列带的宽度关系。
  const trk = (t) => rig({ trackWidths: t });
  arm('ratio:even', 'ratio', trk([500, 500]), { ratio: 'even' }, trk([700, 300]), { ratio: 'even' });
  arm('ratio:major-start', 'ratio', trk([700, 300]), { ratio: 'major-start' }, trk([300, 700]), { ratio: 'major-start' });
  arm('ratio:major-end', 'ratio', trk([300, 700]), { ratio: 'major-end' }, trk([500, 500]), { ratio: 'major-end' });
  arm('ratio:none', 'ratio', trk([]), { ratio: 'none' }, trk([500, 500]), { ratio: 'none' });
  check(!run(rig({ trackWidths: [], placeable: 1 }), { ratio: 'major-end', columns: 'two' }).checks.includes('ratio'),
    'ratio：声明两栏而这一页只有 1 个不跨列的零件 ⟹ 形态自己把列带收成一条，跟 columns 同一个退化条件，报告而不判');

  // media_side —— 图落在哪一侧（只有 media:side 判得了）。
  // 🔴 两臂只换「图在左还是在右」，图与文始终真并排 —— 否则 `media: side` 那条会替 media_side 开火，
  //    红臂就分不出是哪一根轴红的。
  const sideRig = (mx, bx) => rig({
    media: box({ cls: 'probe__media', dom: 0, x: mx, y: 0, w: 400, h: 200 }),
    body: box({ cls: 'probe__body', dom: 1, x: bx, y: 0, w: 400, h: 200 }),
  });
  arm('media_side:start', 'media-side',
    sideRig(0, 500), { media: 'side', media_side: 'start' },
    sideRig(500, 0), { media: 'side', media_side: 'start' });
  arm('media_side:end', 'media-side',
    sideRig(500, 0), { media: 'side', media_side: 'end' },
    sideRig(0, 500), { media: 'side', media_side: 'end' });
  check(run(rig({}), { media: 'below', media_side: 'start' }).problems.some((x) => x.includes('只能写 none')),
    'media_side：图不在侧面却写了 start ⟹ 静态一致性检查点名它');

  // order —— 零件的次序有没有被 `order` 换过（块这一层 / 项内部，两层任一算）。
  const ord = (root, item) => rig({ orderInverted: { root, item, kids: 3, itemKids: 3 } });
  arm('order:dom', 'order', ord(false, false), { order: 'dom' }, ord(true, false), { order: 'dom' });
  arm('order:reordered', 'order', ord(true, false), { order: 'reordered' }, ord(false, false), { order: 'reordered' });
  check(run(ord(false, true), { order: 'reordered' }).problems.length === 0,
    'order：只有【项内部】换过次序也算 reordered（testimonials/attribution-first 就是这一种）');
  arm('order:alternate', 'order-alternate-first', ord(true, false), { order: 'alternate' }, ord(false, false), { order: 'alternate' });
  check(!run(rig({ orderInverted: { root: false, item: false, kids: 1, itemKids: 0 } }), { order: 'reordered' }).checks.includes('order'),
    'order：这一页上块只剩一个零件 ⟹ 换没换过次序按构造看不出来，报告而不判（page-header/kicker-above 的最少版）');

  // item_parts —— 同级项内部的零件是竖着堆还是横着并排。
  const parts = (v) => rig({ partsSideBySide: v, items: twoItems(true) });
  arm('item_parts:side', 'item-parts', parts(true), { item_parts: 'side', items: 'grid' }, parts(false), { item_parts: 'side', items: 'grid' });
  arm('item_parts:stack', 'item-parts', parts(false), { item_parts: 'stack', items: 'grid' }, parts(true), { item_parts: 'stack', items: 'grid' });
  arm('item_parts:none', 'item-parts-none', parts(null), { item_parts: 'none', items: 'grid' }, parts(false), { item_parts: 'none', items: 'grid' });
  check(!run(parts(true), { item_parts: 'none', items: 'none' }).checks.includes('item-parts'),
    'item_parts：items 是 none 的块只做静态检查，不判几何（探针挑出来的那个「项」是凑数的单件）');

  // inner —— 主内层容器里零件占了几条列带（顶栏 / 页脚的版式整个住在这一层）。
  const innerRig = (bands) => rig({ inner: { cls: 'probe__body', count: 4, bands }, innerFree: { cls: 'probe__body', count: 4, bands } });
  arm('inner:four', 'inner', innerRig(4), { inner: 'four' }, innerRig(3), { inner: 'four' });
  arm('inner:three', 'inner', innerRig(3), { inner: 'three' }, innerRig(4), { inner: 'three' });
  arm('inner:many', 'inner', innerRig(6), { inner: 'many' }, innerRig(4), { inner: 'many' });
  arm('inner:none', 'inner-none', rig({}), { inner: 'none' }, innerRig(3), { inner: 'none' });
  check(run(rig({ inner: null, innerFree: { cls: 'probe__body', count: 4, bands: 3 } }), { inner: 'three', items: 'none' }).problems.length === 0,
    'inner：items 是 none 的块读【不排除同级项】那一份（hero 在两页上挑中的「项」不是同一个零件）');

  // ── ④ 阅读顺序：只对 headline:above 收紧，且不碰媒体的 order ─────────────
  console.log('── ④ 阅读顺序（AC4）');
  const domOk = run(rig({ head: box({ cls: 'probe__headline', dom: 0, x: 0, y: 0, w: 300 }), items: [box({ cls: 'probe__item', dom: 1, x: 0, y: 100, w: 400 })] }), { headline: 'above', items: 'stack' });
  const domBad = run(rig({ head: box({ cls: 'probe__headline', dom: 5, x: 0, y: 0, w: 300 }), items: [box({ cls: 'probe__item', dom: 1, x: 0, y: 100, w: 400 })] }), { headline: 'above', items: 'stack' });
  check(domOk.problems.length === 0 && domBad.problems.length === 1 && domBad.problems[0].includes('DOM'),
    `视觉在上而 DOM 在后 ⟹ 红并点名（${domBad.problems.length} 条）`);
  // 🔴 同一轮里证明它**没有**把媒体的 `order` 判红：检查 ⑥ 明文放行块内部件用 order 重排，
  //    而 hero/form-side 今天就是拿 order:4 把图放到最下面的。
  const mediaOrder = run(rig({
    media: box({ cls: 'hero__media', dom: 1, x: 0, y: 400, w: 1000, h: 100 }),
    body: box({ cls: 'hero__body', dom: 2, x: 0, y: 0, w: 400, h: 100 }),
  }), { media: 'below', headline: 'none', items: 'none' });
  check(mediaOrder.problems.length === 0 && mediaOrder.checks.includes('media-below'),
    'DOM 里图在正文【前面】而视觉在下面（hero/form-side 的 order:4）⟹ media:below 判过且不红');

  // ── ⑤ 手机宽只判「零件留在盒子里」，而且仍然至少一条断言 ────────────────
  console.log('── ⑤ 手机宽（正文 §3 / AC2 的下限）');
  const ph = (r, i) => judgeIntent(r, { ...INTENT, ...i }, { phone: true, where: '/p', arm: '两臂' });
  const phoneOk = ph(rig({ items: [box({ cls: 'probe__item', x: 0, y: 0, w: 400 })] }), { items: 'grid' });
  const phoneBad = ph(rig({ items: [box({ cls: 'probe__item', x: 0, y: 0, w: 1400 })] }), { items: 'grid' });
  check(phoneOk.checks.length >= 1 && phoneBad.problems.length === 1,
    `手机宽仍执行 ${phoneOk.checks.length} 条断言，零件伸出盒子时红（${phoneBad.problems.length} 条）`);
  check(ph(rig({}), { items: 'none', headline: 'none', media: 'none' }).checks.length >= 1,
    '一个零件都没点名的块（announcement-bar 这类）退回判「块自己不溢出」，所以没有 0 条断言的格子');

  // ── ⑥ 盘上每一对的意图都是合法的 ───────────────────────────────────────
  // 🔴 这里原来打的是写死的「盘上的 50 对」（#1332 落地那天的真值），而断言用的是现算的 `pairs`
  //    —— 两个数会分家，#1340 交付后真值是 83。改成先数再打，谁加形态都不用再回来改这一行。
  let pairs = 0; let broken = 0;
  const manifests = [...bm.loadManifests()];
  console.log(`── ⑥ 盘上的 ${manifests.reduce((n, [, mm]) => n + (mm.shapes || []).length, 0)} 对`);
  for (const [t, mm] of manifests) {
    for (const sh of mm.shapes || []) {
      pairs += 1;
      const gaps = bm.layoutIntentProblems(bm.layoutIntentFor(mm, sh.name));
      if (gaps.length) { broken += 1; bad(`${t}/${sh.name}: ${gaps.join('；')}`); }
    }
  }
  check(broken === 0, `${pairs} 个 (块,形态) 对，意图全部齐全且合法`);

  console.log(`\n══ layout-intent.test.js: ${pass} 过 · ${fail} 失败 ══`);
  process.exit(fail ? 1 : 0);
})();
