// layout-intent.mjs — 检查 ⑨ 的探针与判据（#1332，设计文档 D15 第 3 层 / D5）。
//
// 一份 `layout_intent` 说「这个块的这一种形态该长什么样」，用一组轴上的有限词表说（#1332 立了五根，
// #1381 加到十二根）；这里把每个词
// 翻成一条**在真浏览器上量边界框**的断言。词表本身住在 `layout-intent-vocab.json` —— 校验器
// （`block-manifest.js`，CommonJS）和这道守卫（ESM）两边读同一份，两处各抄一份的失败方向是静默的。
//
// 🔴 为什么探针要往 `data-block-part` 包装层里下一层：`testimonials` 把它的三条评价装在
//    `<div data-block-part="testimonials-list">` 里（31 个块里只有它这么做，现取 1）。不下这一层，
//    「同级项」在它身上读到的是那个包装层本身 —— 一个成员的组，于是 `items` 那根轴对它永远退化，
//    而它恰好是 #1332 那一轮唯一一个两种形态在当时那五根轴上同值的块（#1332 正文 §已知盲区）。
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
  // 🔴 #1337 —— 「这个零件还在不在版面里」。`display: none` 的元素 `getBoundingClientRect()` 每一项
  //    都读 0，而 0 是个**合法的坐标** —— 下面按 x 归列带、数「填得满几条列带的子元素」两处都会
  //    把它当成一个真的、贴在最左边的零件。本票让空的媒体容器 `display: none` 之后这就不是假设了：
  //    实测 `content-split/media-right-alternate`（最少版 · 1280px · /allblocks.html）在两套主题上
  //    都从 ✅ 变成「该占 2 条列带，实际占 1 条」—— 那一页上这个块**只有一个**看得见的零件，
  //    两条列带没有样本可占，是 D14 第 2 条那种「可选零件缺席」，不是排错了。
  //
  // 🔴 判据是 `display === 'none'`，**不是** `getClientRects().length === 0`（检查 ⑥ 用的那把尺）。
  //    两把尺在这个文件里不通用，实测分歧就在盘上：`testimonials` 的三个直接子元素里有一个是
  //    `<div data-block-part="testimonials-list">`，它 `display: contents` —— 自己没有盒子
  //    （rects 0）而**它的孩子实实在在占着格**。拿 ⑥ 那把尺一量，这个包装层被当成「不在版面里」，
  //    `testimonials/{two-up,attribution-first}` 的 `placeable` 从 1 掉到 0，`columns` 那条严格判据
  //    （占用列带 === 声明数）当场退化成 `columns-degraded`（占用 ≤ 声明），两版夹具 × 两套主题
  //    共 8 格判据变松 —— 绿的，但量的东西少了。⑥ 问的是「画在谁前面」，一个没有盒子的元素确实
  //    没画在任何地方；这里问的是「它占没占位置」，而 `display: contents` 占了。
  const laidOut = (el) => getComputedStyle(el).display !== 'none';
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
    // 🔴 #1337 —— 只有真被排版的子元素才算占了位置。`kids` 本身**不动**：下面认 head / media /
    //    body 那几处问的是「哪个零件是它」，藏起来的容器照样是媒体容器（`mediaEl` 那一处按本票
    //    正文 §做什么 4 单独判「看不看得见」）。这里分出来的 `laid` 只喂几何。
    // 🔴 #1381 —— `display: contents` 的直接子元素自己没有盒子，它的孩子才真占着格。上一版把它
    //    当成一个占着第 0 条列带的零件，于是 `testimonials` 的 `occupied` 恒等于 1（无论那一种形态
    //    声明了几列），`placeable` 也恒等于 1 ⟹ `columns` 那条严格判据在这个块的每一种形态上都
    //    退化成「占用 ≤ 声明」。实测（azure-29 · 1280px · /allblocks.html）：two-up 的轨道读数是
    //    `[580, 580]`（两条）、六个 `testimonials__item` 分落两条带，而 `occupied` 读 1。展开之后
    //    two-up 读 2、three-up / masonry 读 3，跟它们的 `grid-template-columns` 对得上。
    //    🔴 展开的只有 `display: contents` 这一种，不是「所有包装层」：contents 的语义就是「我不生成
    //    盒子」，而一个有盒子的包装层确实占着一条列带，把它换成它的孩子会把真读数换成假读数。
    //    📌 全仓现取只有 `testimonials` 一个块有这种直接子元素（`data-block-part="testimonials-list"`）。
    //    🔴 别在这里钉行号，自己取（行号会漂）：
    //       grep -rn 'display: contents' templates/nextjs/src/app/globals.css templates/nextjs/public/base.css
    const expand = (list) => list.reduce((acc, c) => {
      const d = getComputedStyle(c).display;
      if (d === 'none') return acc;
      if (d === 'contents') return acc.concat(expand([...c.children]));
      acc.push(c); return acc;
    }, []);
    const laid = expand(kids);
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
      for (const c of laid) {
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
      for (const c of laid) bands.add(Math.round(c.getBoundingClientRect().left));
    }
    const headEl = kids.find(isHead);
    // 🔴 #1337 —— 看得见才算有图。`shapes.css` 从此让「可选图槽位没填」的媒体容器 `display: none`
    //    （元素留着，是契约 §2 给主题皮的 ::before/::after 钩子）。下面 media 轴那条「这一页上这个
    //    块没有图（可选槽为空）⟹ 报告而不判」（D14 第 2 条）本来就是为这件事写的，它只是用
    //    「元素在不在」问了「有没有图」—— 改成问「浏览器有没有给它排版」。
    //    不这么改的后果是实测过的：藏起来的容器 `getBoundingClientRect()` 全读 0 而被当成真几何，
    //    `hero/form-side` 在真站上从 ✅ 变「图该在正文下面，实际图 y 从 0 起」（反向对照见票上 AC4）。
    //    📌 只动这一处（`mediaEl`）：:112/:113/:131 那几处 `!isMedia(c)` 是在**排除**媒体容器，
    //    藏起来的容器照样不该当 bodyEl / after，语义相反，动它们是另一件事。
    const mediaEl = kids.find((c) => isMedia(c) && laidOut(c));
    const bodyEl = kids.find((c) => first(c).endsWith(V.bodySuffix))
      || kids.find((c) => !isHead(c) && !isMedia(c) && first(c) !== itemCls)
      || kids.find((c) => !isHead(c) && !isMedia(c));

    // ══ #1381 的七根新轴，取数那一半 ════════════════════════════════════════════════════════════
    // 判断一律在 node 侧（同这个文件原来的规矩），这里只回数。
    const contentBoxOf = (c) => {
      const s = getComputedStyle(c); const b = c.getBoundingClientRect();
      return {
        left: b.left + px(s.borderLeftWidth) + px(s.paddingLeft),
        right: b.right - px(s.borderRightWidth) - px(s.paddingRight),
      };
    };
    // ── align：横向对齐量在哪个零件上 ────────────────────────────────────────────────────────
    // 标题部件优先，其次**严格**的 `__body`。🔴 这里不用上面那个 `bodyEl`：它的第二、三条兜底会
    // 把「随便哪个不是标题也不是图的子元素」当正文，于是 `header` 这种既没标题也没 `__body` 的块
    // 也拿得到一个参照（实测拿到的是 `.header__bar`，而它横向填满 ⟹ 四种顶栏形态全读 stretch）。
    // 既没标题也没 `__body` 时**下沉一层**：取「零件最多的那个直接子元素」的第一个零件，并且改用
    // 那个容器自己的内容盒当分母（顶栏的 `.header__bar` 自带内边距，拿块的内容盒量会把 centered-logo
    // 和 solid-bar 都读成 start）。现取只有 5 个块既没有标题也没有 `__body`（两版夹具读数相同）：
    // announcement-bar · header · quote-form · services-list · services-nav —— 其中 header /
    // quote-form / services-list 真的下沉到了主容器的第一个零件，announcement-bar 与 services-nav
    // 连「零件 ≥2 的直接子元素」都没有 ⟹ 回 null，align 轴在它们身上【报告而不判】。
    const strictBody = kids.find((c) => first(c).endsWith(V.bodySuffix));
    let refEl = headEl || strictBody || null;
    let refFrom = headEl ? 'head' : (strictBody ? 'body' : null);
    let refBox = { left: contentLeft, right: contentRight };
    if (!refEl) {
      let host = null; let hostN = 0;
      for (const c of laid) {
        if (isMedia(c)) continue;
        const n = expand([...c.children]).length;
        if (n > hostN) { host = c; hostN = n; }
      }
      if (host && hostN >= 2) {
        const inner = expand([...host.children])[0];
        if (inner) { refEl = inner; refFrom = 'inner'; refBox = contentBoxOf(host); }
      }
    }
    // 🔴 分母是**参照零件所在的那条列带**，不是整个块的内容盒 —— 两栏块（hero/media-left 那一族）
    //    的正文只住在其中一栏里，拿整块当分母量出来永远是「偏左 628 偏右 60」这种谁都不是的读数。
    //    跨整行的零件（标题那种 `grid-column: 1 / -1`）照旧拿整个内容盒当分母。
    if (refEl && refFrom !== 'inner' && tracks.length > 1) {
      const b0 = refEl.getBoundingClientRect();
      const mid0 = (b0.left + b0.right) / 2;
      let acc0 = contentLeft; let hit = null;
      for (const t of tracks) {
        if (mid0 >= acc0 - V.slack && mid0 <= acc0 + t + V.slack) { hit = { left: acc0, right: acc0 + t }; break; }
        acc0 += t + gap;
      }
      if (hit && !spansAll(refEl) && b0.width < (contentRight - contentLeft) - V.slack * 2) refBox = hit;
    }
    // `left0` / `right0` 是**分母**（参照零件所在容器的内容盒），`left` / `right` 是零件自己的盒子。
    const alignRef = refEl ? (() => {
      const b = refEl.getBoundingClientRect();
      return {
        cls: first(refEl) || refEl.tagName.toLowerCase(), from: refFrom,
        left: b.left, right: b.right, left0: refBox.left, right0: refBox.right,
        lines: lineCount(refEl),
      };
    })() : null;

    // ── order：把零件按 (computed `order`, DOM 次序) 排一遍，跟 DOM 次序一不一样 ──────────────
    // 🔴 用的是**全部**子元素，不是 `laid`：`order` 是 CSS 属性，藏起来的零件照样带着它，而「这一页
    //    上那个可选槽填没填」在两版夹具之间是不同的 —— 只数看得见的，同一个形态在全填版和最少版会
    //    读出不同的答案（hero 的图没填时它就是这样）。
    const inverted = (list) => {
      const arr = list.map((c, i) => [parseFloat(getComputedStyle(c).order) || 0, i]);
      const sorted = arr.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
      return sorted.some((x, i) => x[1] !== i);
    };
    const itemEls = (hist.get(itemCls) || []).map(([c]) => c);
    const orderInverted = {
      root: inverted(kids), item: itemEls[0] ? inverted([...itemEls[0].children]) : false,
      // 能不能谈「次序」：块只有一个零件、项里只有一个零件时谈不上（最少版夹具上 page-header 就只剩
      // 一个 `__title`，而 `kicker-above` 靠 `order` 提上去的那个副标题**整个没有渲染**）。
      kids: kids.length, itemKids: itemEls[0] ? itemEls[0].children.length : 0,
    };

    // ── item_parts：同级项【内部】的零件是竖着堆还是横着并排 ──────────────────────────────────
    // 判据是「有没有一对零件纵向范围重叠、横向彼此不重叠」，不是「左边界有几个不同的值」：后者
    // 在居中排的项上（testimonials/single-featured 每个零件宽度不同、各自居中）会把一列读成并排。
    const partsSideBySide = (() => {
      if (!itemEls[0]) return null;
      const ps = expand([...itemEls[0].children]).map((c) => c.getBoundingClientRect());
      if (ps.length < 2) return null;
      for (let i = 0; i < ps.length; i += 1) {
        for (let j = i + 1; j < ps.length; j += 1) {
          const a = ps[i]; const b2 = ps[j];
          const vOverlap = a.top < b2.bottom - V.slack && b2.top < a.bottom - V.slack;
          const hApart = a.right <= b2.left + V.slack || b2.right <= a.left + V.slack;
          if (vOverlap && hApart) return true;
        }
      }
      return false;
    })();

    // ── inner：块的主内层容器里，零件占了几条列带 ────────────────────────────────────────────
    // 主内层容器 = 被排版的直接子元素里，**不是同级项**、有 ≥2 个被排版子元素、而且那些子元素的
    // 类名不全相同的那一个（并列取子元素最多的）。最后那条排掉的是「一串同类的东西」——
    // `.hero__band` 里六张同类的图、`.content-split__bullets` 里的 `li`：那是内容有几条，不是版式。
    const innerHostOf = (skipItems) => {
      let best = null; let bestN = 0;
      for (const c of laid) {
        if (isMedia(c) || (skipItems && first(c) === itemCls)) continue;
        const ch = expand([...c.children]);
        if (ch.length < 2) continue;
        const names = new Set(ch.map((x) => first(x) || x.tagName.toLowerCase()));
        if (names.size < 2) continue;
        if (ch.length > bestN) { best = [c, ch]; bestN = ch.length; }
      }
      return best;
    };
    const readInner = (innerHost) => (innerHost ? (() => {
      const [host, ch] = innerHost;
      const hs = getComputedStyle(host);
      const hb = contentBoxOf(host);
      const ht = hs.display === 'grid' && hs.gridTemplateColumns !== 'none'
        ? hs.gridTemplateColumns.trim().split(/\s+/).map(px) : [];
      const hgap = hs.columnGap === 'normal' ? 0 : px(hs.columnGap);
      const hband = new Set();
      if (ht.length > 0) {
        const edges = []; let acc = hb.left;
        for (const t of ht) { edges.push([acc, acc + t]); acc += t + hgap; }
        for (const c of ch) {
          const b = c.getBoundingClientRect();
          const mid = (b.left + b.right) / 2;
          let idx = edges.findIndex(([a, z]) => mid >= a - V.slack && mid <= z + V.slack);
          if (idx < 0) idx = 0;
          hband.add(idx);
        }
      } else {
        // 不是 grid：同一视觉行上并排了几个零件（纵向范围跟第一个零件重叠的那些）。
        const bs = ch.map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0 || b.height > 0);
        const first0 = bs[0];
        if (first0) {
          for (const b of bs) {
            if (b.top < first0.bottom - V.slack && first0.top < b.bottom - V.slack) hband.add(Math.round(b.left));
          }
        }
      }
      return { cls: first(host) || host.tagName.toLowerCase(), count: ch.length, bands: hband.size || 1 };
    })() : null);
    // 🔴 两份读数，因为「哪个直接子元素是同级项」这件事只有 manifest 说了算，探针说不了：
    //    `items: none` 的块上探针挑出来的那个「项」是个凑数的单件（hero 在 / 上是 `.hero__body`、
    //    在 /allblocks.html 上是 `.hero__band`），按它去排除会让同一个形态两页两个答案；而真有
    //    同级项的块**必须**排除它们，否则最少版夹具上只剩一张卡时，那张卡自己就成了主内层容器。
    //    判据那一侧按 `intent.items` 取其中一份（judgeIntent 里那段）。
    const innerReading = readInner(innerHostOf(true));
    const innerReadingFree = readInner(innerHostOf(false));

    out.push({
      alignRef, orderInverted, partsSideBySide, inner: innerReading, innerFree: innerReadingFree, trackWidths: tracks,
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
      placeable: laid.filter((c) => {
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


// ══ #1381 —— 七根新轴的「量出来是什么」，一份定义两处用 ═══════════════════════════════════════
// 判据（下面 judgeIntent 里那几段）和 manifest 的填值脚本读的是同一组函数。两边各写一遍的失败
// 方向是静默的：填进 manifest 的值跟守卫算出来的值差一点点，守卫当场红，而红的原因看起来像排版错了。
// 回 null = 这一格没有样本，判不了（调用方退化成报告）。

/** 参照零件在它那个内容盒里靠哪边。 */
export function deriveAlign(r, S = VOCAB.slack) {
  const A = r.alignRef;
  if (!A) return null;
  const room = A.right0 - A.left0;
  const S2 = Math.max(S, room * VOCAB.alignSlackRatio);
  const gapL = A.left - A.left0;
  const gapR = A.right0 - A.right;
  if (gapL <= S2 && gapR <= S2) return 'stretch';
  if (Math.abs(gapL - gapR) <= S2) return 'center';
  if (gapL <= S2) return 'start';
  if (gapR <= S2) return 'end';
  return `其它（左余 ${Math.round(gapL)} 右余 ${Math.round(gapR)}）`;
}

/** 同一视觉行上并排的同级项，纵向怎么对齐。回 null = 没有一行并排 ≥2 项。 */
export function deriveCross(r, S = VOCAB.slack) {
  const row = visualRows(r.items).find((g) => g.items.length >= 2);
  if (!row) return null;
  const hs = row.items.map((i) => i.height);
  const ts = row.items.map((i) => i.top);
  const ms = row.items.map((i) => (i.top + i.bottom) / 2);
  const span = (a) => Math.max(...a) - Math.min(...a);
  if (span(hs) <= S) return 'stretch';
  if (span(ts) <= S) return 'start';
  if (span(ms) <= S) return 'center';
  // 高矮和起点都对不齐 —— 那一行里有一项被放大或错落（gallery/featured-thumbs 的大图、
  // card-group/heading-side-staggered 的交错两列）。它是一个**读数**，不是「没量到」。
  return 'mixed';
}

/** 块自己那几条列带的宽度关系。 */
export function deriveRatio(r) {
  const t = r.trackWidths || [];
  if (t.length < 2) return 'none';
  const a = t[0]; const b = t[t.length - 1];
  if (Math.abs(a - b) <= (a + b) * VOCAB.ratioSlackRatio) return 'even';
  return a > b ? 'major-start' : 'major-end';
}

/** 图落在哪一侧。回 null = 这一页上这个块没有图。 */
export function deriveMediaSide(r) {
  if (!r.media) return null;
  const mid = (r.media.left + r.media.right) / 2;
  return mid < (r.root.contentLeft + r.root.contentRight) / 2 ? 'start' : 'end';
}

/** 零件的次序有没有被 `order` 换过（块的直接子元素 / 同级项内部，两层任一算）。 */
export function deriveOrder(r) {
  const inv = r.orderInverted || {};
  return (inv.root || inv.item) ? 'reordered' : 'dom';
}

/** 同级项内部的零件是竖着堆还是横着并排。回 null = 项里没有两个以上的零件可比。 */
export function deriveItemParts(r) {
  if (r.partsSideBySide === null || r.partsSideBySide === undefined) return null;
  return r.partsSideBySide ? 'side' : 'stack';
}

/** 主内层容器里，零件占了几条列带。回 null = 这个块没有主内层容器。 */
export function deriveInner(r, items) {
  const inner = items === 'none' ? r.innerFree : r.inner;
  if (!inner) return null;
  const NAME = ['none', 'one', 'two', 'three', 'four'];
  return inner.bands >= 5 ? 'many' : NAME[inner.bands];
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
    // 意图一个零件都没点名（announcement-bar 这类）—— 那就判块自己不溢出，
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
    // 🔴 #1381 —— 第二个退化条件：占这几条列带的是**同级项**，而这一页上项比列数还少。
    //    `placeable` 数的是「不跨列的子元素」，标题和副标题在有些形态里也算进去（testimonials/
    //    heading-side 的标题占第 1 条列带），于是最少版夹具上 placeable=3、项只有 1 个，严格判据
    //    读出「该占 3 条实际占 2 条」—— 那是没有样本，不是排错了。
    // 🔴 只收 `row` / `grid` 两种：那两种的同级项**本来就是**占着这几条列带的东西，项比列数少 ⟹
    //    有几条列带没有样本。`stack` 不是 —— 它的项是竖着堆的一列，占列带的是别的零件
    //    （contact-info/media-side-grid 是「一列联系方式 + 一张图」），按项数去退化会把一格本来
    //    判得动的严格判据无故放松（实测：不加这个限定时，全填版的 contact-info/media-side-grid
    //    从 `columns` 掉成 `columns-degraded`）。
    const itemsShort = (intent.items === 'row' || intent.items === 'grid')
      && r.items.length > 0 && r.items.length < want;
    if (r.placeable < want || itemsShort) {
      notes.push(`  ⑨ ${who}: 只有 ${r.placeable} 个不跨列的子元素 / ${r.items.length} 个同级项，填不满 ${want} 条列带 —— `
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

  // ══ #1381 的七根新轴（都只在桌面宽判 —— 上面那条 `if (phone) return` 已经把手机宽挡掉了）══════
  //
  // 为什么加它们：加之前全仓 121 个形态里有 63 个落在「五根轴上逐字相同」的撞车组里（16 个块 /
  // 23 组，复算命令在 #1381 正文）。两个形态的意图逐字相同，就意味着把其中一个的 CSS 整段删掉、
  // 让它退化成另一个，⑨ 照样全绿 —— 那一维没有任何机器在看。

  // ── align：块里的内容横向靠哪边 ──────────────────────────────────────
  // 量的是「标题部件」（没有标题就量 `__body`，两个都没有就下沉到主内层容器的第一个零件）的盒子
  // 在它那个内容盒里的左右余量。`justify-self` / `justify-items` / `max-width` 三种写法都落在这个
  // 读数上，而主题改不动它们（都在几何族里）。
  if (!r.alignRef) {
    notes.push(`  ⑨ ${who}: 找不到可以量对齐的零件（没有标题、没有 __body、也没有主内层容器），align 轴【报告而不判】`);
  } else if (r.alignRef.lines > 1
    && r.alignRef.right - r.alignRef.left >= (r.alignRef.right0 - r.alignRef.left0) - Math.max(S, (r.alignRef.right0 - r.alignRef.left0) * VOCAB.alignSlackRatio)) {
    // 🔴 文字折了行**而且**盒子已经跟容器一样宽 ⟹ 左右都没有余量可量，「靠哪边」在这一格
    //    按构造观察不到。这不是排错了，是没有样本（同 D14 第 2 条那一族的处置）。
    //    实测：`trusted-brands/two-row` 的标题是 `justify-items: center` 的收缩盒，azure-29 的
    //    2rem 标题一行装得下（左右各余 97px ⟹ 量得出居中），ember-12 的 2.25rem 装不下、折成两行
    //    并撑满 1232px ⟹ 同一个形态两套主题两个答案。字号是皮，形态改不动它。
    //    🔴 判据里那个「而且盒子已经跟容器一样宽」不能省：`max-width` 限住的标题折行之后照样比
    //    容器窄，那种情况居中仍然量得出来，省掉它会把本票要买的那条断言（把 `justify-self: center`
    //    删掉 ⟹ 当场红）一起放走。
    notes.push(`  ⑨ ${who}: .${r.alignRef.cls} 的文字折成了 ${r.alignRef.lines} 行并撑满容器，左右没有余量，align 轴【报告而不判】`);
  } else if (intent.headline !== 'none' && r.alignRef.from !== 'head') {
    // 🔴 这个形态**该有**标题（headline 轴不是 none），而这一页上它没有 —— 可选槽为空（D14 第 2 条，
    //    同 headline / media 两根轴的处置）。换成别的零件去量对齐会读出另一个答案：实测
    //    `text-block/stack` 在 /allblocks.html 上量 `.text-block__headline` 读 stretch，在 /about.html
    //    上（那一页没填标题）退到 `.text-block__body` 读 start —— 同一个形态两个答案。
    notes.push(`  ⑨ ${who}: 这一页上这个块没有标题部件（可选槽为空），align 轴【报告而不判】（D14 第 2 条）`);
  } else {
    const A = r.alignRef;
    const got = deriveAlign(r, S);
    const gapL = A.left - A.left0;
    const gapR = A.right0 - A.right;
    const room = A.right0 - A.left0;
    ok('align', got === intent.align,
      `.${A.cls}（参照取自 ${A.from}）该是 "${intent.align}"，量出来是 "${got}"：`
      + `左余 ${Math.round(gapL)}px · 右余 ${Math.round(gapR)}px · 容器内容盒 ${Math.round(room)}px`);
  }

  // ── cross：同一视觉行上并排的同级项，纵向怎么对齐 ────────────────────
  // `none` 说的是「这个形态没有『并排的同级项』这件事」（items 是 none 或 stack），它照样是一条
  // 判得动的断言。其余三个值要有一行 ≥2 项才判得了 —— 没有样本时退化成报告，同 items / columns。
  {
    const row = visualRows(r.items).find((g) => g.items.length >= 2);
    if (intent.cross === 'mixed') {
      // 🔴 `mixed` 是「这一行既不等高、也不齐顶、也不居中」—— 而落到这个桶里的形态，那个「同一行」
      //    本身就不牢：`gallery/featured-thumbs` 的大图跨两行，被按纵向重叠并进第一行；
      //    `features-grid/heading-side-staggered` 是有意错落的两列。它们的高矮还跟主题的字号有关
      //    （实测 features-grid/heading-side-staggered：azure-29 读 stretch、ember-12 读 mixed，
      //    同一份 CSS 两个答案）。所以这个取值**只用来把 manifest 上的形态分开，不判**。
      notes.push(`  ⑨ ${who}: cross 是 "mixed"（错落 / 有一项跨行），这一格的「同一行」分组本身不牢，`
        + `cross 轴【报告而不判】—— 量出来是 "${deriveCross(r, S)}"`);
    } else if (intent.cross === 'none') {
      ok('cross-none', !row,
        `manifest 说这个形态没有并排的同级项，实际有一行并排了 ${row ? row.items.length : 0} 个 .${r.itemCls}`);
    } else if (!row) {
      notes.push(`  ⑨ ${who}: 没有一行并排 ≥2 个同级项，"${intent.cross}" 没有样本，cross 轴【报告而不判】`);
    } else {
      const hs = row.items.map((i) => i.height);
      const ts = row.items.map((i) => i.top);
      const got = deriveCross(r, S);
      ok('cross', got === intent.cross,
        `同一行里的 ${row.items.length} 个 .${r.itemCls} 该按 "${intent.cross}" 对齐，量出来是 "${got}"：`
        + `高 ${hs.map(Math.round).join('/')} · 顶 ${ts.map(Math.round).join('/')}`);
    }
  }

  // ── ratio：块自己那几条列带的宽度关系 ────────────────────────────────
  {
    const t = r.trackWidths || [];
    const got = deriveRatio(r);
    // 🔴 声明了不止一条列带、而这一页上第二条没有占用者时，形态自己会把列带收回去
    //    （`§:not([data-has-helpCard]) { grid-template-columns: 1fr }` 那一族），于是轨道只剩一条。
    //    那跟「有人把两栏规则删了」读数一模一样，分开它们的是 columns 轴同一格的那个退化条件：
    //    `placeable < 声明的列数` ⟹ 那几条列带**没有样本**。两根轴用同一个退化条件，不另立判据。
    const want = intent.columns === 'many' ? 0 : VOCAB.columnCount[intent.columns];
    const colsDegraded = want > 1 && r.placeable < want;
    if (intent.ratio !== 'none' && got === 'none' && colsDegraded) {
      notes.push(`  ⑨ ${who}: 只有 ${r.placeable} 个不跨列的子元素，填不满 ${want} 条列带，形态自己把列带收成了一条 —— `
        + 'ratio 轴在这一格【报告而不判】（跟 columns 轴同一个退化条件）');
    } else {
      ok('ratio', got === intent.ratio,
        `列带宽度关系该是 "${intent.ratio}"，量出来是 "${got}"（轨道 ${t.length ? t.map(Math.round).join(' / ') : '无'}）`);
    }
  }

  // ── media_side：图落在哪一侧 ─────────────────────────────────────────
  // 只有 `media: side` 的形态判得了；其余形态这根轴该写 none，而「图根本不在侧面」这件事由 media
  // 轴自己判，这里不重复判它（重复判会让同一个错误报两遍，读的人分不清是两个问题还是一个）。
  if (intent.media !== 'side') {
    if (intent.media_side !== 'none') {
      problems.push(`⑨ ${who}: media 轴是 "${intent.media}"（图不在侧面），media_side 只能写 none，manifest 写的是 "${intent.media_side}"`);
    }
    notes.push(`  ⑨ ${who}: 这个形态的图不在侧面（media:${intent.media}），media_side 轴【报告而不判】`);
  } else if (!r.media) {
    notes.push(`  ⑨ ${who}: 这一页上这个块没有图（可选槽为空），media_side 轴【报告而不判】（D14 第 2 条）`);
  } else {
    const mid = (r.media.left + r.media.right) / 2;
    const half = (r.root.contentLeft + r.root.contentRight) / 2;
    const got = deriveMediaSide(r);
    ok('media-side', got === intent.media_side,
      `图该落在 "${intent.media_side}" 那一侧，量出来是 "${got}"：图的中线 ${Math.round(mid)}，块内容盒的中线 ${Math.round(half)}`);
  }

  // ── order：零件的视觉先后跟 DOM 先后一不一致 ────────────────────────
  // 判据读的是 `order` 这个属性在两层（块的直接子元素 / 同级项内部）上有没有把次序换掉，不是量盒子：
  // 换次序的手段在形态层就只有它，而「哪个零件视觉上在前面」按盒子量会被内容多少牵着走（同一个形态
  // 在全填版和最少版读出不同答案）。主题写不了 `order`（它在几何族里），所以这个读数只由形态层决定。
  {
    const inv = (r.orderInverted || {});
    const got = deriveOrder(r);
    const tooFew = (inv.kids || 0) < 2 && (inv.itemKids || 0) < 2;
    const where2 = inv.root && inv.item ? '块和项两层' : (inv.root ? '块这一层' : (inv.item ? '项内部' : '哪一层都没有'));
    if (tooFew && intent.order !== 'dom') {
      // 🔴 这一页上这个块只剩一个零件 ⟹ 换没换过次序按构造看不出来（D14 第 2 条那一族）。
      //    实测：`page-header/kicker-above` 靠 `order` 把副标题提到标题上面，而最少版夹具上那个
      //    副标题是空的可选槽、**元素整个没有渲染**，于是「有没有换过次序」这件事没有样本。
      notes.push(`  ⑨ ${who}: 这一页上这个块只有 ${inv.kids} 个零件（项里 ${inv.itemKids} 个），谈不上次序，order 轴【报告而不判】`);
    } else if (intent.order === 'alternate') {
      // 「按兄弟序数左右交替」的形态。第一个实例这一半判得了（它跟 reordered 同形）；翻转那一半
      // 这一页上没有第二个实例可比 —— 取数那一半一次只给一个块换形态（`theme-css-invariants.mjs`
      // 的 `judgeLayoutIntent` 用的是 `document.querySelector`），所以那一半按构造没有样本。
      ok('order-alternate-first', got === 'reordered',
        `"alternate" 的第一个实例该跟 "reordered" 同形（用 order 换过次序），量出来是 "${got}"`);
      notes.push(`  ⑨ ${who}: "alternate" 的另一半（相邻实例左右翻转）这一页上没有第二个同形态实例可比，【报告而不判】`);
    } else {
      ok('order', got === intent.order,
        `零件次序该是 "${intent.order}"，量出来是 "${got}"（换过次序的是：${where2}）`);
    }
  }

  // ── item_parts：同级项【内部】的零件是竖着堆还是横着并排 ────────────
  // 这是 #1381 正文点名必须能表达的那一根（team-grid 的 two-up vs two-up-horizontal：简介在姓名
  // 下面 vs 在姓名右边）。
  if (intent.items === 'none') {
    // 🔴 `items: none` 的块（hero / content-split 那一族）没有「同级项」这回事，探针挑出来的那个
    //    「项」是个凑数的单件 —— 而它是谁**跟这一页上哪几个可选槽填了**有关（实测：hero 在
    //    /allblocks.html 上挑中 `.hero__band`（六张并排的图 ⟹ side），在 / 上挑中 `.hero__body`
    //    （竖着堆 ⟹ stack）。同一个形态、同一套主题，两页两个答案）。所以这一族的 item_parts
    //    只做静态一致性检查：manifest 只能写 none。
    if (intent.item_parts !== 'none') {
      problems.push(`⑨ ${who}: items 轴是 "none"（这个形态没有同级项），item_parts 只能写 none，manifest 写的是 "${intent.item_parts}"`);
    }
    notes.push(`  ⑨ ${who}: 这个形态没有同级项（items:none），item_parts 轴【报告而不判】`);
  } else if (intent.item_parts === 'none') {
    // 有同级项，但项里只有一个零件（trusted-brands 的一枚 logo、page-header 的一条面包屑）。
    ok('item-parts-none', deriveItemParts(r) === null,
      `manifest 说同级项内部没有可排的零件，实际量出来是 "${deriveItemParts(r)}"（.${r.itemCls}）`);
  } else if (r.partsSideBySide === null) {
    notes.push(`  ⑨ ${who}: 同级项里没有两个以上的零件可比，item_parts 轴【报告而不判】`);
  } else {
    const got = deriveItemParts(r);
    ok('item-parts', got === intent.item_parts,
      `同级项内部的零件该是 "${intent.item_parts}"，量出来是 "${got}"（.${r.itemCls} 里有没有一对零件纵向重叠、横向分开）`);
  }

  // ── inner：块的主内层容器里，零件占了几条列带 ────────────────────────
  // 顶栏和页脚这两个外壳块的版式整个住在内层容器里（`.header__bar` / `.footer__body`），块根这一层
  // 看不到 —— 加这一根之前 footer 的三种形态、header 的四种形态在 ⑨ 眼里逐字相同。
  {
    const host = intent.items === 'none' ? r.innerFree : r.inner;
    if (intent.inner === 'none') {
      ok('inner-none', !host,
        `manifest 说这个形态没有主内层容器，实际有 .${host && host.cls}（${host && host.count} 个零件）`);
    } else if (!host) {
      notes.push(`  ⑨ ${who}: 这一页上这个块没有主内层容器（零件都不在一个容器里），inner 轴【报告而不判】`);
    } else {
      const got = deriveInner(r, intent.items);
      ok('inner', got === intent.inner,
        `主内层容器 .${host.cls} 里该占 "${intent.inner}" 条列带，量出来是 "${got}"（${host.bands} 条 · ${host.count} 个零件）`);
    }
  }

  return { checks, problems, notes, selfOverflow };
}
