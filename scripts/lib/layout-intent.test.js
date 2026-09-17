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
  check(INTENT_AXES.length === 5 && INTENT_AXES.join(',') === 'items,item_wrap,headline,media,columns',
    `五根轴：${INTENT_AXES.join(' / ')}`);

  // ── ② 合并规则与完整性 ───────────────────────────────────────────────
  console.log('── ② 块级默认 + 形态覆盖，合并后必须齐全');
  const m = { type: 'probe', layout_intent: { items: 'grid', item_wrap: 'avoid', headline: 'above', media: 'none', columns: 'two' }, shapes: [{ name: 'a', needs: [] }, { name: 'b', needs: [], layout_intent: { columns: 'three' } }] };
  check(bm.layoutIntentFor(m, 'a').columns === 'two', '形态没写就用块级默认（a.columns = two）');
  check(bm.layoutIntentFor(m, 'b').columns === 'three' && bm.layoutIntentFor(m, 'b').items === 'grid',
    '形态写了就覆盖那一根轴，别的轴仍取默认（b.columns = three · b.items = grid）');
  check(bm.layoutIntentFor(m, 'nope') === null, '清单里没有的形态回 null（跟「意图不全」分得开）');
  check(bm.layoutIntentProblems({ items: 'grid' }).length === 4, '只写一根轴 ⟹ 报缺 4 根');
  check(bm.layoutIntentProblems({ ...m.layout_intent, media: 'sideways' })[0].includes('"media"'),
    '词表外的值被点名（media: "sideways"）');
  check(bm.layoutIntentProblems(m.layout_intent).length === 0, '五根轴齐全且都在词表里 ⟹ 0 条');

  // ── ③ 每一根轴两臂 ───────────────────────────────────────────────────
  console.log('── ③ 每一根轴：一臂该绿、一臂该红');
  const box = (o) => ({ cls: o.cls || 'x', dom: o.dom || 0, left: o.x, right: o.x + o.w, top: o.y, bottom: o.y + (o.h || 20), width: o.w, height: o.h || 20, lines: o.lines || 1, scrollWidth: o.w, clientWidth: o.w });
  const rig = (over) => ({
    block: 'probe', shape: 's', display: 'grid', flexDirection: 'row', flexWrap: 'nowrap',
    trackCount: 2, occupied: 2, spanning: 0, placeable: 2,
    root: { left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, contentLeft: 0, contentRight: 1000, gap: 0 },
    scrollWidth: 1000, clientWidth: 1000, head: null, media: null, body: null, after: null,
    itemCls: 'probe__item', items: [], ...over,
  });
  const INTENT = { items: 'none', item_wrap: 'allow', headline: 'none', media: 'none', columns: 'two' };
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
    mediaRig(500, 200, 400, 100), { media: 'side' },
    mediaRig(0, 0, 400, 100), { media: 'side' });
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
