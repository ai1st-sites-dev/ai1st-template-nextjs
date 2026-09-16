// layout-intent.mjs — 检查 ⑨ 的探针与判据（#1332，设计文档 D15 第 3 层 / D5）。
//
// 一份 `layout_intent` 说「这个块的这一种形态该长什么样」，用五根轴上的有限词表说；这里把每个词
// 翻成一条**在真浏览器上量边界框**的断言。词表本身住在 `layout-intent-vocab.json` —— 校验器
// （`block-manifest.js`，CommonJS）和这道守卫（ESM）两边读同一份，两处各抄一份的失败方向是静默的。
//
// 🔴 为什么探针要往 `data-block-part` 包装层里下一层：`testimonials` 把它的三条评价装在
//    `<div data-block-part="testimonials-list">` 里（31 个块里只有它这么做，现取 1）。不下这一层，
//    「同级项」在它身上读到的是那个包装层本身 —— 一个成员的组，于是 `items` 那根轴对它永远退化，
//    而它恰好是本票唯一一个两种形态在五根轴上同值的块（正文 §已知盲区）。
//
// 🔴 `columns` 读的是【真正被占用的列带】，不是 `grid-template-columns` 的轨道数。两把尺在盘上
//    真的不一致，而分歧的方向正是本票要看见的那一类：`newsletter-signup/form-side` 的根有 2 条轨道，
//    而它的三个子元素全在第 0 条带里（实测 2026-09-15）—— 按轨道数判它是「两列」，读者看到的是一列。
//    轨道数照样打印出来，两者不一致的对在读数里点名（正文 §已知盲区给了它的尺寸）。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VOCAB = JSON.parse(fs.readFileSync(path.join(HERE, 'layout-intent-vocab.json'), 'utf-8'));
export const INTENT_AXES = Object.keys(VOCAB.axes);

/**
 * 在页面里量一个块。返回的东西全是数，判断一律在 node 侧做 —— 这样每一条判据的两臂都能在
 * 单元测试里喂数跑，不用起浏览器。
 */
export const INTENT_PROBE = (V) => {
  const first = (el) => (el.classList && el.classList[0]) || '';
  const isHead = (el) => V.headingSuffixes.some((s) => first(el).endsWith(s));
  const isMedia = (el) => first(el).endsWith(V.mediaSuffix);
  const px = (v) => parseFloat(v) || 0;
  // 🔴 文字占了几行，不是盒子有多高 —— 逐字照 ⑧ 那一格的理由（`height` 不在形态层能改的族里，
  //    按盒子判的话那两个块无论形态怎么排都是红的）。
  const lineCount = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = new Set([...r.getClientRects()]
      .filter((x) => x.width > 0 && x.height > 0)
      .map((x) => Math.round(x.top)));
    return tops.size || 1;
  };
  const box = (el, i) => {
    const b = el.getBoundingClientRect();
    return {
      cls: first(el) || el.tagName.toLowerCase(), dom: i,
      left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height,
      lines: lineCount(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
    };
  };
  const out = [];
  for (const el of document.querySelectorAll('[data-block]')) {
    const cs = getComputedStyle(el);
    const rb = el.getBoundingClientRect();
    const contentLeft = rb.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const contentRight = rb.right - px(cs.borderRightWidth) - px(cs.paddingRight);
    const contentTop = rb.top + px(cs.borderTopWidth) + px(cs.paddingTop);
    const contentBottom = rb.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom);
    const gap = cs.columnGap === 'normal' ? 0 : px(cs.columnGap);
    const tracks = cs.display === 'grid' && cs.gridTemplateColumns !== 'none'
      ? cs.gridTemplateColumns.trim().split(/\s+/).map(px) : [];
    const kids = [...el.children];
    const spansAll = (c) => {
      const g = getComputedStyle(c).gridColumn || '';
      return /(^|\s)1\s*\/\s*-1(\s|$)/.test(g) || g.trim() === '1 / -1';
    };
    // 同级项的候选面：根的直接子元素，外加 `data-block-part` 包装层里的一层。
    const pool = [];
    kids.forEach((c, i) => {
      pool.push([c, i]);
      if (c.hasAttribute('data-block-part')) [...c.children].forEach((g, j) => pool.push([g, i + (j + 1) / 100]));
    });
    const cand = pool.filter(([c]) => !isHead(c) && !isMedia(c));
    const hist = new Map();
    for (const [c, i] of cand) {
      const k = first(c) || c.tagName.toLowerCase();
      if (!hist.has(k)) hist.set(k, []);
      hist.get(k).push([c, i]);
    }
    // 打平手时取 DOM 靠后的那一组：同级项总排在 `__sub` / `__intro` 这类引子后面，而单项的块
    // （夹具上只放得出一张卡的 service-related-pages）两组都是 1 个，先到先得会选中引子。
    let itemCls = null; let bestN = 0; let bestDom = -1;
    for (const [k, v] of hist) {
      const dom = Math.max(...v.map(([, i]) => i));
      if (v.length > bestN || (v.length === bestN && dom > bestDom)) { bestN = v.length; bestDom = dom; itemCls = k; }
    }
    const items = (hist.get(itemCls) || []).map(([c, i]) => box(c, i));
    // 被占用的列带：把每个【不跨列】的直接子元素按中心 x 归到一条轨道上。
    let bands = new Set(); let spanning = 0;
    const room = contentRight - contentLeft;
    if (tracks.length > 0) {
      const edges = []; let acc = contentLeft;
      for (const t of tracks) { edges.push([acc, acc + t]); acc += t + gap; }
      for (const c of kids) {
        const b = c.getBoundingClientRect();
        // 🔴 跨列先看 computed `grid-column`，再看宽度。只看宽度会把 `grid-column: 1 / -1` 而**内容为空**
        //    的零件（`.hero__deco` 在首页宽 0）算成「占了一条列带」，于是「这个块凑不出第二列的零件」
        //    读成了「凑得出，只是没排开」—— 首页的 hero（没有表单）第一版就是这么被判红的。
        if (spansAll(c) || (b.width >= room - V.slack * 2 && tracks.length > 1)) { spanning += 1; continue; }
        const mid = (b.left + b.right) / 2;
        let idx = edges.findIndex(([a, z]) => mid >= a - V.slack && mid <= z + V.slack);
        if (idx < 0) idx = 0;
        bands.add(idx);
      }
      if (bands.size === 0) bands = new Set([0]);
    } else {
      for (const c of kids) bands.add(Math.round(c.getBoundingClientRect().left));
    }
    const headEl = kids.find(isHead);
    const mediaEl = kids.find(isMedia);
    const bodyEl = kids.find((c) => first(c).endsWith(V.bodySuffix))
      || kids.find((c) => !isHead(c) && !isMedia(c) && first(c) !== itemCls)
      || kids.find((c) => !isHead(c) && !isMedia(c));
    out.push({
      block: el.getAttribute('data-block'), shape: el.getAttribute('data-shape') || '(none)',
      display: cs.display, flexDirection: cs.flexDirection, flexWrap: cs.flexWrap,
      trackCount: tracks.length, occupied: bands.size, spanning,
      root: {
        left: rb.left, right: rb.right, top: rb.top, bottom: rb.bottom, width: rb.width, height: rb.height,
        contentLeft, contentRight, contentTop, contentBottom, gap,
        // 🔴 `cover` 的分母是**内容盒**，不是边框盒。块的左右内边距由主题写（间距不是几何，契约允许），
        //    形态层没法让图越过它 —— 拿边框盒当分母，azure-29 的 hero 读 1184/1280 = 92.5% 当场红，
        //    而那个块的图**已经占满了它能占的全部宽度**（实测 2026-09-15，ember-12 的内边距小所以是绿的：
        //    一条判据在两套主题上给出相反结论 ⟹ 分母选错了，不是其中一套排错了）。
        contentWidth: contentRight - contentLeft, contentHeight: contentBottom - contentTop,
      },
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      head: headEl ? box(headEl, kids.indexOf(headEl)) : null,
      after: (() => {
        const hi = headEl ? kids.indexOf(headEl) : -1;
        const a = kids.find((c, i) => i > hi && !isHead(c) && !isMedia(c));
        return a ? box(a, kids.indexOf(a)) : null;
      })(),
      media: mediaEl ? box(mediaEl, kids.indexOf(mediaEl)) : null,
      body: bodyEl ? box(bodyEl, kids.indexOf(bodyEl)) : null,
      itemCls, items,
      // `columns` 的样本量：不跨列的直接子元素有几个。比声明的列数还少 ⟹ 那几条列带**没有样本**
      // 可占，不是排错了（夹具上 service-related-pages 只有一张卡）。判据据此退化，见 judgeIntent。
      placeable: kids.filter((c) => {
        const b = c.getBoundingClientRect();
        return !(spansAll(c) || (b.width >= room - V.slack * 2 && tracks.length > 1));
      }).length,
    });
  }
  return out;
};

/** 项按视觉行分组 —— 垂直范围有重叠的算同一行（逐字照 ⑧ 的 `rowLines`，理由同一条：等高不是同行的判据）。 */
export function visualRows(items, slack = VOCAB.slack) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.top - b.top)) {
    const g = rows[rows.length - 1];
    if (g && it.top < g.bottom - slack) { g.items.push(it); g.bottom = Math.max(g.bottom, it.bottom); }
    else rows.push({ items: [it], bottom: it.bottom });
  }
  return rows;
}

/**
 * 判一格：一个块、一种形态、一个视口。回 { checks, problems, notes }。
 *   checks   这一格**真正执行了**几条断言（0 条 ⟹ 调用方判红，正文 AC2）
 *   problems 断言不成立的话说人话
 *   notes    退化 / 打印出来但不判的读数
 */
export function judgeIntent(r, intent, { phone, where, arm }) {
  const S = VOCAB.slack;
  const checks = []; const problems = []; const notes = [];
  const who = `${r.block}/${r.shape}（${arm} · ${phone ? VOCAB.phoneWidth : VOCAB.desktopWidth}px · ${where}）`;
  const ok = (name, cond, say) => { checks.push(name); if (!cond) problems.push(`⑨ ${who}: ${say}`); };

  // 🔴 ⑨ 判的是**这段意图点名的零件**，两个视口都判：它们得留在块自己的内容盒里。
  //    named = 意图说「有」的那些零件（items / 标题 / 图）。
  const named = [];
  if (intent.items !== 'none') named.push(...r.items);
  if (intent.headline !== 'none' && r.head) named.push(r.head);
  if (intent.media !== 'none' && r.media) named.push(r.media);
  const outside = named.filter((i) => i.right > r.root.contentRight + S || i.left < r.root.contentLeft - S);
  if (named.length > 0) {
    ok('parts-inside', outside.length === 0,
      `${outside.length} 个零件伸到块的内容盒外面（${outside.map((i) => `${i.cls} 右边到 ${Math.round(i.right)}，盒子到 ${Math.round(r.root.contentRight)}`).join('；')}）`);
  } else {
    // 意图一个零件都没点名（divider / announcement-bar 这类）—— 那就判块自己不溢出，
    // 这样每一格仍然至少有一条断言（正文 AC2 的下限：0 条 = 什么都没判）。
    ok('no-overflow', r.scrollWidth <= r.clientWidth + S,
      `块自己横向溢出了（scrollWidth ${Math.round(r.scrollWidth)} > clientWidth ${Math.round(r.clientWidth)}）`);
  }
  // 🔴 块自身的横向溢出**报而不判**，而且报的时候带上尺寸 —— 它的产生者在形态层之外（实测：首页的
  //    hero 在 375 下 388/375，`.hero__body` 的左右内边距 40+40 加上两个按钮的 min-content 284 = 364 >
  //    轨道 327，`media-cover` 和 `form-side` **两种形态读到同一个数**，所以没有任何形态改得动它）。
  //    判它会让 ⑨ 对一件它管不着的事报红；不报它则是另一种错，所以印出来并在汇总里给出总数。
  const selfOverflow = r.scrollWidth > r.clientWidth + S;
  if (selfOverflow && named.length > 0) {
    notes.push(`  📌 ⑨ ${who}: 块自己横向溢出 ${Math.round(r.scrollWidth - r.clientWidth)}px`
      + `（scrollWidth ${Math.round(r.scrollWidth)} / clientWidth ${Math.round(r.clientWidth)}）——`
      + ' 这个读数**报而不判**：形态层改不动它（见 layout-intent.mjs 里那段实测），汇总行给总数');
  }

  if (phone) {
    notes.push(`  ⑨ ${who}: 手机宽只判「意图点名的零件留在块的内容盒里」—— 列与并排在这个宽度上本来就该塌掉（正文 §3）`);
    return { checks, problems, notes, selfOverflow };
  }

  // ── items ────────────────────────────────────────────────────────────
  const rows = visualRows(r.items);
  const xs = new Set(r.items.map((i) => Math.round(i.left)));
  if (intent.items === 'none') {
    ok('items-none', r.items.length < 2,
      `manifest 说这个块没有同级项，实际有 ${r.items.length} 个同类的 .${r.itemCls}`);
  } else if (r.items.length < 2) {
    notes.push(`  ⑨ ${who}: 只有 ${r.items.length} 个同级项（.${r.itemCls}）—— "${intent.items}" 的「至少两项」没有样本，`
      + '退化成「不溢出 + 项不伸出容器」，这一格的 items 轴【报告而不判】（正文 §3，承 #1321 / #1324）');
  } else if (intent.items === 'row' || intent.items === 'grid') {
    const sideBySide = rows.some((g) => g.items.length >= 2);
    ok(`items-${intent.items}`, sideBySide && xs.size >= 2,
      `manifest 说同级项该${intent.items === 'row' ? '横排' : '成网格'}，实际 ${rows.length} 行 / ${xs.size} 个不同的 x`
      + ' —— 没有任何一行放得下两项，它们是一项一行堆下来的');
    if (intent.items === 'row') {
      ok('row-one-line', rows.length === 1,
        `"row" 在桌面宽下该是一行，实际 ${rows.length} 行`);
    }
  } else if (intent.items === 'stack') {
    ok('items-stack', xs.size === 1 && rows.length === r.items.length,
      `manifest 说同级项该纵向一列，实际 ${xs.size} 个不同的 x / ${rows.length} 行（共 ${r.items.length} 项）`);
  }

  // ── item_wrap ────────────────────────────────────────────────────────
  if (intent.item_wrap === 'avoid' && r.items.length > 0) {
    const need = r.items.reduce((s, i) => s + i.width, 0) + r.root.gap * Math.max(0, r.items.length - 1);
    const roomLeft = (r.root.contentRight - r.root.contentLeft) - need;
    const folded = r.items.filter((i) => i.lines > 1);
    if (roomLeft > S) {
      ok('item-wrap-avoid', folded.length === 0,
        `容器还剩 ${Math.round(roomLeft)}px 余宽，却有 ${folded.length} 个项的文字折成了多行`
        + `（${folded.map((i) => `${i.cls} ${i.lines} 行`).join('、')}）—— 这正是 #1320 截图里那种折行`);
    } else {
      notes.push(`  ⑨ ${who}: 容器没有余宽（差 ${Math.round(-roomLeft)}px），"avoid" 的前提不成立，这一格【报告而不判】`);
    }
  }

  // ── headline ─────────────────────────────────────────────────────────
  // 「标题该在谁上面 / 谁旁边」里的那个「谁」：有同级项就是第一项，没有就是**标题之后**的第一个
  // 内容元素。🔴 「之后」是 DOM 次序，不是位置 —— page-header 的面包屑排在标题**前面**，拿它当参照
  // 会让 stack-left 和 title-side 两种形态都读出 `??`（第一版就是这么读的，实测）。
  const ref = (intent.items !== 'none' && r.items.length > 0)
    ? [...r.items].sort((a, b) => a.dom - b.dom)[0]
    : (r.after || r.body);
  if (intent.headline === 'none') {
    ok('headline-none', !r.head, `manifest 说这个形态没有标题部件，实际有 .${r.head && r.head.cls}`);
  } else if (!r.head) {
    // 🔴 设计文档 D14 第 2 条：可选零件缺席不算 HTML 不同，「形态要能应付缺席」。标题是可选槽的块
    //    （text-block 在 /about.html 上就没有标题）这一格**报告而不判** —— 全填版的夹具页每个槽都填了，
    //    那里才是判这根轴的地方。判它等于把「这一页没填这个槽」说成排版错了。
    notes.push(`  ⑨ ${who}: 这一页上这个块没有标题部件（可选槽为空），headline 轴【报告而不判】（D14 第 2 条）`);
  } else if (!ref) {
    notes.push(`  ⑨ ${who}: 有标题但没有可比的第一项 / 正文，headline 轴【报告而不判】`);
  } else if (intent.headline === 'above') {
    ok('headline-above', r.head.bottom <= ref.top + S,
      `标题该在第一项上面，实际标题 y ${Math.round(r.head.top)}–${Math.round(r.head.bottom)}，`
      + `第一项 .${ref.cls} y ${Math.round(ref.top)}`);
    // 🔴 AC4 —— 只对 above 收紧检查 ⑥，而且只管「标题 vs 第一项」这一对。⑥ 明写块【内部】用
    //    `order` 重排部件合法（`theme-css-invariants.mjs` §⑥），媒体的 order 不在这条射程里。
    ok('headline-dom-order', r.head.dom < ref.dom,
      `标题在 DOM 里排在第一项 .${ref.cls} 之后（DOM 次序 ${r.head.dom} vs ${ref.dom}）——`
      + ' 视觉上在上面而读屏 / 搜索引擎先读到项，是 D14 那条边界');
  } else if (intent.headline === 'below') {
    // 🔴 #1340 —— 这一支是 `above` 的镜像，但**故意不配 DOM 次序那条断言**。`above` 那边查
    //    `head.dom < ref.dom` 是因为「视觉在上、读屏后读到」是 D14 的边界；而 `below` 这一族
    //    （`page-header/kicker-above`）恰恰是**有意**让标题在 DOM 里排第一、靠 `order` 视觉下移，
    //    副标题当眉题排在它上面（`sheet-recipes.js` 那张表的注释逐字这么写）。给它配一条
    //    「DOM 里也要在后面」的断言就是把这个形态本身判成错的。
    ok('headline-below', r.head.top >= ref.bottom - S,
      `标题该在第一项下面，实际标题 y 从 ${Math.round(r.head.top)} 起，`
      + `第一项 .${ref.cls} y ${Math.round(ref.top)}–${Math.round(ref.bottom)}`);
  } else if (intent.headline === 'side') {
    const overlap = r.head.top < ref.bottom - S && ref.top < r.head.bottom - S;
    ok('headline-side', r.head.right <= ref.left + S && overlap,
      `标题该与第一项并排，实际标题 x ${Math.round(r.head.left)}–${Math.round(r.head.right)} / y ${Math.round(r.head.top)}–${Math.round(r.head.bottom)}，`
      + `第一项 .${ref.cls} x ${Math.round(ref.left)} / y ${Math.round(ref.top)}–${Math.round(ref.bottom)}`);
  }

  // ── media ────────────────────────────────────────────────────────────
  if (intent.media === 'none') {
    ok('media-none', !r.media, `manifest 说这个块没有图，实际有 .${r.media && r.media.cls}`);
  } else if (!r.media) {
    notes.push(`  ⑨ ${who}: 这一页上这个块没有图（可选槽为空），media 轴【报告而不判】（D14 第 2 条，同上）`);
  } else if (intent.media === 'cover') {
    const cw = r.root.contentWidth || r.root.width;
    const ch = r.root.contentHeight || r.root.height;
    ok('media-cover', r.media.width >= cw * VOCAB.coverWidthRatio
      && r.media.height >= ch * VOCAB.coverHeightRatio,
      `图该铺满块，实际宽 ${Math.round(r.media.width)}/${Math.round(cw)}`
      + `（要 ≥${Math.round(VOCAB.coverWidthRatio * 100)}% 的内容盒宽）· 高 ${Math.round(r.media.height)}/${Math.round(ch)}`
      + `（要 ≥${Math.round(VOCAB.coverHeightRatio * 100)}%）`);
  } else if (!r.body) {
    notes.push(`  ⑨ ${who}: 有图但没有可比的正文部件，media 轴【报告而不判】`);
  } else if (intent.media === 'side') {
    const overlap = r.media.top < r.body.bottom - S && r.body.top < r.media.bottom - S;
    ok('media-side', Math.round(r.media.left) !== Math.round(r.body.left) && overlap,
      `图该与文并排，实际图 x ${Math.round(r.media.left)} / y ${Math.round(r.media.top)}–${Math.round(r.media.bottom)}，`
      + `正文 .${r.body.cls} x ${Math.round(r.body.left)} / y ${Math.round(r.body.top)}–${Math.round(r.body.bottom)}`);
  } else if (intent.media === 'above') {
    ok('media-above', r.media.bottom <= r.body.top + S,
      `图该在正文上面，实际图 y 到 ${Math.round(r.media.bottom)}，正文 .${r.body.cls} 从 ${Math.round(r.body.top)} 起`);
  } else if (intent.media === 'below') {
    ok('media-below', r.media.top >= r.body.bottom - S,
      `图该在正文下面，实际图 y 从 ${Math.round(r.media.top)} 起，正文 .${r.body.cls} 到 ${Math.round(r.body.bottom)}`);
  }

  // ── columns（只在桌面宽判，正文 §3）────────────────────────────────────
  if (intent.columns === 'many') {
    ok('columns-many', r.display === 'flex' && r.flexDirection === 'row' && r.flexWrap === 'wrap',
      `"many" 说列数由内容定（横排条），实际 display:${r.display} / ${r.flexDirection} / ${r.flexWrap}`);
  } else {
    const want = VOCAB.columnCount[intent.columns];
    if (r.placeable < want) {
      notes.push(`  ⑨ ${who}: 只有 ${r.placeable} 个不跨列的子元素，填不满 ${want} 条列带 —— `
        + '这是**没有样本**不是排错了，退化成「占用的列带 ≤ 声明数」，这一格的 columns 轴【报告而不判】'
        + '（正文 §3，承 #1321 / #1324）');
      ok('columns-degraded', r.occupied <= want,
        `退化判据都没过：占了 ${r.occupied} 条列带，比声明的 ${want} 条还多`);
    } else {
    ok('columns', r.occupied === want,
      `该占 ${want} 条列带（"${intent.columns}"），实际占 ${r.occupied} 条`
      + `（根上声明了 ${r.trackCount} 条轨道${r.spanning ? `，另有 ${r.spanning} 个跨列子元素` : ''}）`);
    }
    if (r.trackCount > 0 && r.trackCount !== r.occupied) {
      notes.push(`  📌 ⑨ ${who}: 根上声明了 ${r.trackCount} 条轨道而只有 ${r.occupied} 条被占用 ——`
        + ' 这个读数打印出来【不判】（正文 §已知盲区：多声明的空轨道不是本票的判据）');
    }
  }
  return { checks, problems, notes, selfOverflow };
}
