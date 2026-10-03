#!/usr/bin/env node
/**
 * items-grid.test.js — 条目网格只剩一份（#1537）：`*Columns` 的列数与断点只在 `scripts/block-build/items-grid.js` 里。
 *
 *   node scripts/items-grid.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ① 射程从数据派生，不用名单：凡 manifest 里有名字含 `columns` 的旋钮的块（今天 9 个，四种名字：itemsColumns ×6 ·
 *    statsColumns · plansColumns · membersColumns），都必须写 `itemsGrid`、而且管的就是那个旋钮。
 * ② 块自己的 CSS（`blocks/<块>/block.css` + `<形态>/shape.css`）里不许再有列数 / 断点规则。两种旧写法都认：
 *      CSS grid 那派   —— `grid-template-columns: repeat(…)`、`column-count`
 *      flex 那派       —— 声明 `--xx-cols`、`width` / `flex` / `flex-basis` 里用 `var(--xx-cols)`
 *    外加：选择器里点名这个块的列数属性（`[data-items-columns=…]` 等）、又写宽度 / 列数的规则。
 *    🔴 r2（QA2 打回）：上面三种只认【词汇】，而列数可以用字面值写出来，所以再加一层【按位置判】：manifest 的 itemsGrid
 *    已经声明了每个网格的 `container` / `item`，落在它们身上的声明才看。
 *    🔴 r3（QA2 第二次打回）：r2 在位置那一层仍按【值的写法】判（N 条一样的轨道 · 带 % 又带 / 的 calc），于是 `grid` /
 *    `grid-template` 简写、`calc(33.333% - gap)`、乘法、`.tm-grid > *` 六条全溜过去 —— 每轮补的都是上一轮被点名的那几种。
 *    现在按【属性族 + 位置】判（细则在 placedWhy 上面）：
 *      位置      container = 最后一个复合选择器带 container 的 class；item = 带 item 的 class、或 container 的直接子元素
 *                （`> *` · `> li` · `> :nth-child(…)`）、或 container 里不带 class 的元素；`:is()` / `[class~=…]` / CSS 嵌套都展开；
 *                扫【所有】块的 CSS（别的块写 `[data-block="team"] .tm-grid` 一样算）。生成器不管的排法（blog featured / list、
 *                logos row —— 从 itemsGrid 的 `when` 派生）不归这里。
 *      container 定轨道 / 多列 / 换画法的属性【写了就算】，值不看；flex / 百分比画法的列距对不上宽度算式也算。
 *      item      宽度族按比例算（带 % 或 vw / cqw 这类相对单位，整值不是 100%）· 跨列 · flex / 百分比画法的左右外边距和 box-sizing。
 *    放行的是剩下的形状：条目宽 0 / auto / 100% / 固定长度 · basis 不按比例的 flex · 行距 · 对齐 · grid 画法的列距 ·
 *    `grid-auto-flow: dense`。⑤ 里有一组「必须不红」的反向对照，证明判法没放宽到见什么拦什么。
 *    🔴 r4（QA2 第三次打回，PM 2026-10-03 裁定「最小收口」）：这道守卫防的是【以后有人按习惯又在 block.css 里写一条列数规则】，
 *    不是【有人刻意绕过它】—— 按词法 / 选择器判的 CSS 守卫对后者按构造封闭不了。所以 AC3 的判据是一份可枚举的语料
 *    （QA1 / QA2 r3 那两张表），不是「任何会改列数的写法都抓得住」。r4 收了四类自然写法：
 *      · 属性条件不带值 / 部分匹配（`[data-items-layout]` · `^=` · `*=`）—— r3 只认精确相等，把它们当「别的排法」放行（admits）；
 *      · flex / 百分比画法的条目写固定长度（`width: 30rem` · `min-width: 28rem` · `flex: 0 0 22rem`）—— 一律算（flexItemSizes）；
 *      · grid 画法的四个块补上 `item`（blog `.bl-post` · gallery `.gl-item` · testimonials `.tn-item`），后代组合
 *        `.bl-grid .bl-post` 跟 flex 那 5 个块一样认得出（logos 的条目没有 class，见下面边界第 4 条）；
 *      · `grid-column` / `grid-row` 整族【出】射程（ITEM_SPAN_PROPS 上面写着为什么）—— 这是 r4 唯一一格有意的「r3 红 → r4 绿」。
 *
 * ── 守不住的边界（点名到形状；这些写法写进 block.css，这道守卫不红）──────────────────────────────────
 *   1. 不写容器类也不写条目类，靠 data 属性去够：`[data-block="team"] [data-part="member"] { width: … }`（QA2 r3 的 Z3）。
 *      仓里写条目一律用块前缀类，`data-part` 是给编辑器和测试认位置的。
 *   2. 从 Bootstrap 的类去够：`.fx-itemsgrid .row > * { width: 33.3333% }`（QA2 r3 的 Z6；features 的容器 `.fx-grid` 也带 `.row`）。
 *      同类：只靠结构 `[data-block="team"] .tm-memberscol > div > div`。
 *   3. `grid-column` / `grid-row` 整族（span 是版式，见上）。代价：grid 画法里 `.bl-grid > * { grid-column: span 2 }` 会把一行 3 个变成 1 个，
 *      这道守卫不管。🔴 别把它改回「只在没有 :first-child / :nth-child 限定时才算」—— 每多一维条件就是下一轮的新入口（PM 裁定原话）。
 *   4. logos 的条目是不带 class 的 `<div data-part="item">`，`itemsGrid` 写不了 `item`。`.lo-grid > div` / `.lo-grid div` 照样按
 *      「直接子元素 / 容器里不带 class 的元素」认得出；剩下的写法只有第 1 条那一种。
 *   5. flex / 百分比画法的条目上这三种形状放行（flexItemSizes 上面写着为什么）：`min-*: 0`、固定长度的 `max-*`、`width` / `inline-size: 100%`。
 *      其中后两种在多列的场合也会改一行排几个（`max-width: 10rem` 让条目变窄、一行多排；`width: 100%` 让一行只排一个）——
 *      放行它们是因为今天各有正确的用法（pricing 单套餐宽卡 `max-width: 56rem` + `width: 100%`、features list `width: 100%`），
 *      而它们都只在「一列」的场合出现。
 *   6. 块的 CSS 以外不扫：主题 CSS、`src/app/globals.css`、`scripts/lib/site-css.js` 拼的全站规则。今天这些地方 0 处提到 9 个块的网格 class。
 * ③ 一条规矩的读数：列数 = min(旋钮值, 上限)。下表是各块原来 block.css 注释里写的规矩（逐块抄的，不从生成器反推），
 *    含 PM 点名的两个「一列」例外：pricing `plansColumns=1`、milestones `statsColumns=1` 在 768–991 仍是一列。
 * ④ 生成出来的 CSS 只用逻辑属性（RTL 站 shapes.css 不过 RTLCSS，#1473）。
 * ⑤ 故意改坏：往 block.css 里塞一条列数规则、删掉一个块的声明 —— 各自当场红、点名文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { itemsGridOf, itemsGridCss, colsAt } = require('./block-build/items-grid');

const BLOCKS = path.resolve(__dirname, '..', 'blocks');
let pass = 0;
let fail = 0;
const check = (ok, msg) => { if (ok) { pass += 1; console.log(`  ✅ ${msg}`); } else { fail += 1; console.log(`  ❌ ${msg}`); } };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
function readBlocks() {
  const out = [];
  for (const b of fs.readdirSync(BLOCKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const mf = path.join(BLOCKS, b, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const css = [];
    const add = (p) => { if (fs.existsSync(p)) css.push({ file: path.relative(path.resolve(BLOCKS, '..'), p), text: fs.readFileSync(p, 'utf8') }); };
    add(path.join(BLOCKS, b, 'block.css'));
    for (const d of fs.readdirSync(path.join(BLOCKS, b), { withFileTypes: true })) if (d.isDirectory()) add(path.join(BLOCKS, b, d.name, 'shape.css'));
    out.push({ block: b, manifest, css });
  }
  return out;
}
const columnsKnobOf = (manifest) => Object.values(manifest.slots || {})
  .flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : [])).find((k) => /columns/i.test(k.name));

/** ①：该写声明的块都写了、管的是那个旋钮。 */
function declarationProblems(blocks) {
  const out = [];
  for (const { block, manifest } of blocks) {
    const k = columnsKnobOf(manifest);
    if (!k) { if (manifest.itemsGrid) out.push(`${block}：没有列数旋钮却写了 itemsGrid`); continue; }
    if (!manifest.itemsGrid) { out.push(`blocks/${block}/manifest.json：有列数旋钮 ${k.name} 却没写 itemsGrid`); continue; }
    if (manifest.itemsGrid.knob !== k.name) out.push(`blocks/${block}/manifest.json：itemsGrid.knob 是 ${manifest.itemsGrid.knob}，列数旋钮是 ${k.name}`);
    try { itemsGridOf(manifest, block); } catch (e) { out.push(e.message); }
  }
  return out;
}

/** 按顶层（括号 / 方括号 / 引号之外）切。 */
function splitTop(s, isSep) {
  const out = []; let cur = ''; let depth = 0; let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === '\\') { cur += s[++i] || ''; } else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    const sep = depth === 0 ? isSep(s, i) : 0;
    if (sep) { out.push({ text: cur, sep: s.slice(i, i + sep) }); cur = ''; i += sep - 1; continue; }
    cur += ch;
  }
  out.push({ text: cur, sep: null });
  return out;
}
/** 复合选择器 → 它正面写着的 class、属性条件（不进 :not / :has），以及是不是伪元素。 */
function compound(text) {
  const c = { classes: new Set(), attrs: [], pseudoEl: /::|:(before|after|first-line|first-letter|marker)\b/i.test(text), bare: true };
  const walk = (t) => {
    // 去掉 :not(...) / :has(...)（里面写的是「不是谁」「含着谁」，不是它自己）；:is / :where / :matches 拆开进来
    let rest = '';
    for (let i = 0; i < t.length; i += 1) {
      const m = /^:(not|has|is|where|matches|nth-[a-z-]+)\(/i.exec(t.slice(i));
      if (m) {
        let d = 0; let j = i + m[0].length - 1;
        for (; j < t.length; j += 1) { if (t[j] === '(') d += 1; else if (t[j] === ')') { d -= 1; if (d === 0) break; } }
        const inner = t.slice(i + m[0].length, j);
        if (/^(is|where|matches)$/i.test(m[1])) for (const one of splitTop(inner, (s, k) => (s[k] === ',' ? 1 : 0))) if (!/[\s>+~]/.test(one.text.trim())) walk(one.text.trim());
        i = j; continue;
      }
      rest += t[i];
    }
    for (const m of rest.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) { c.classes.add(`.${m[1]}`); c.bare = false; }
    if (/#[_a-zA-Z]/.test(rest.replace(/\[[^\]]*\]/g, ''))) c.bare = false;
    for (const m of rest.matchAll(/\[\s*([\w-]+)\s*(?:([~|^$*]?)=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*(?:[is])?\s*\]/g)) {
      const val = m[3] ?? m[4] ?? m[5] ?? null;
      c.attrs.push([m[1], val, m[2] || '']); // [名字, 值（不带值 = null）, 运算符（'' = 精确相等）]
      if (m[1] === 'class' && val) for (const w of val.split(/\s+/).filter(Boolean)) { c.classes.add(`.${w}`); c.bare = false; } // [class~="tm-grid"] / [class*="tm-member"]
    }
  };
  walk(text);
  return c;
}
/** 选择器（逗号列表）→ 每一支 = 复合选择器数组，每个带它前面那个组合符（' ' / '>' / '+' / '~'）。 */
function branchesOf(selector) {
  return splitTop(selector, (s, i) => (s[i] === ',' ? 1 : 0)).map(({ text }) => {
    const parts = splitTop(text.trim(), (s, i) => {
      const m = /^\s*[>+~]\s*|^\s+/.exec(s.slice(i));
      return m ? m[0].length : 0;
    });
    let comb = null;
    return parts.filter((p) => p.text.trim() || p.sep).map((p) => { const c = { ...compound(p.text.trim()), comb }; comb = p.sep ? (p.sep.trim() || ' ') : null; return c; }).filter((c, k, a) => true);
  });
}

/** 规则的完整选择器：CSS 嵌套（`.tm-grid { & > * { … } }`、`.tm-grid { > * { … } }`）按父规则展开；@media / @supports 不改选择器。 */
function selectorOf(node) {
  const rule = node && node.parent;
  if (!rule || rule.type !== 'rule') return '';
  const own = splitTop(rule.selector.replace(/\s+/g, ' '), (t, i) => (t[i] === ',' ? 1 : 0)).map((x) => x.text.trim());
  let up = rule.parent;
  while (up && up.type !== 'rule' && up.type !== 'root') up = up.parent;
  if (!up || up.type !== 'rule') return own.join(', ');
  const parents = splitTop(selectorOf({ parent: up }), (t, i) => (t[i] === ',' ? 1 : 0)).map((x) => x.text.trim());
  return parents.flatMap((ps) => own.map((o) => (o.includes('&') ? o.replace(/&/g, ps) : `${ps} ${o}`))).join(', ');
}

/** 一个网格声明的 `when` 里正面写着的属性条件（`[data-items-layout="grid"]:not(…)` → [['data-items-layout','grid']]）。 */
const whenAttrs = (when) => (when ? branchesOf(when).flatMap((b) => b.flatMap((c) => c.attrs)) : []);

/**
 * r3：这一支选择器落在哪个声明过的网格上、当什么角色（'container' / 'item' / null）。
 *   container  最后一个复合选择器带 container 的 class
 *   item       最后一个复合选择器带 item 的 class；或者它是 container 的【直接子元素】（`.tm-grid > *` · `> li` · `> :nth-child(3n)`
 *              —— 网格 / flex 的条目按定义就是容器的直接子元素）；或者它不带 class / id、又在 container 里面（`.tm-grid li`）
 *   伪元素（::before / ::after）两种都不算。
 * 网格只在生成器管着的那几种排法上算数：同一个 container 的声明全都写了 `when`、而且某个属性（例如 `data-items-layout`）
 * 每一条都正面写着 ⟹ 这一支写着那个属性的【别的值】（blog 的 featured / list、logos 的 row）就不归这里 —— 那种排法下列数旋钮
 * 本来就不生效（生成器不给它写规则），它自己的两栏 `7fr 5fr`、竖排 flex 是它自己的样子。从 manifest 派生，不点名。
 */
/**
 * r4（QA2 r3 的 Z4b）：选择器上的属性条件 `[n op v]` 能不能匹配到根元素上的值 `w`。r3 只认精确相等，于是不带值的
 * `[data-items-layout]`（匹配【所有】排法，grid 也在内）、`^=` / `*=` 这类部分匹配都被判成「别的排法」放行了。
 * 判不准时往「在射程内」那边判：守卫多看一条，代价是有人来解释；少看一条，代价是列数被悄悄改掉。
 */
function admits(op, v, w) {
  if (v === null) return true;
  const a = String(v).toLowerCase();
  const b = String(w).toLowerCase();
  if (op === '^') return b.startsWith(a);
  if (op === '$') return b.endsWith(a);
  if (op === '*') return b.includes(a);
  if (op === '~') return b.split(/\s+/).includes(a);
  if (op === '|') return b === a || b.startsWith(`${a}-`);
  return b === a;
}
function roleOf(branch, grids) {
  const last = branch[branch.length - 1];
  if (!last || last.pseudoEl) return null;
  const attrs = branch.flatMap((c) => c.attrs);
  const inScope = (container) => {
    const same = grids.filter((g) => g.container === container);
    if (same.some((g) => !g.when)) return true;
    const sets = same.map((g) => whenAttrs(g.when));
    const names = [...new Set(sets.flat().map(([n]) => n))].filter((n) => sets.every((a) => a.some(([m]) => m === n)));
    return names.every((n) => attrs.every(([m, v, op]) => m !== n || sets.some((a) => a.some(([k, w]) => k === n && admits(op, v, w)))));
  };
  for (const g of grids) {
    if (!inScope(g.container)) continue;
    if (last.classes.has(g.container)) return { role: 'container', g };
    const prev = branch[branch.length - 2];
    if ((g.item && last.classes.has(g.item))
      || (last.comb === '>' && prev && prev.classes.has(g.container))
      || (last.bare && branch.slice(0, -1).some((c) => c.classes.has(g.container)))) return { role: 'item', g };
  }
  return null;
}

/**
 * r3（QA2 第二次打回）：按【属性族 + 位置】判，不按值的写法判。r2 是逐种写法认（N 条一样的轨道 · 带 % 又带 / 的 calc …），
 * 于是简写（`grid` / `grid-template`）、`calc(33.333% - gap)`、乘法、`> *` 一样溜过去 —— 每轮补的都是上一轮被点名的那几种。
 *   container 上  这一族属性【写了就算】（值怎么写都不看）：定轨道的 `grid-template-columns` / `grid-template` / `grid` /
 *                 `grid-template-areas` / `grid-auto-columns`，多列的 `columns` / `column-count` / `column-width`，换画法的
 *                 `display` / `flex-wrap` / `flex-flow` / `flex-direction`；`grid-auto-flow` 只算带 column 的（dense / row 不定列数）。
 *                 ——「几列」以及「怎么把几列画出来」都归生成器，块自己再写一条就是在跟它抢。
 *   item 上       宽度族（`width` / `inline-size` / `min-` / `max-` 两种 / `flex-basis` / `flex` 的 basis）只要按容器或视口的
 *                 比例算（带 `%`，或 `vw` / `cqw` / `cqi` 这类相对单位），而且整值不是 `100%`，就是列宽 —— 不再要求非得有 `/`；
 *                 r4：flex / 百分比画法的条目，宽度族不论比例还是固定长度都算（见 flexItemSizes）；跨列的 `grid-column` 那一族不算（见 ITEM_SPAN_PROPS）。
 * 放行的是剩下的：grid / 多列画法的条目宽 `0` / `auto` / `100%` / 固定长度（轨道由容器定，条目宽改不了列数）· `grid-auto-flow: dense`。
 */
const CONTAINER_PROPS = /^(grid-template-columns|grid-template|grid|grid-template-areas|grid-auto-columns|columns|column-count|column-width|display|flex-wrap|flex-flow|flex-direction)$/;
const ITEM_WIDTH_PROPS = /^(width|inline-size|min-width|min-inline-size|max-width|max-inline-size|flex-basis|flex)$/;
// r4（PM 2026-10-03 裁定）：`grid-column` / `grid-row` 整族出射程 —— 轨道数由生成器在【容器】上定，`span` 是条目占几条轨道，
// 那是版式不是列数（gallery mosaic 第一张 `grid-column: span 2` 是逐字抄自参考实现的有意设计）。这里只拿它在 ② 的旁证里列出来。
const ITEM_SPAN_PROPS = /^(grid-column|grid-column-start|grid-column-end|grid-row|grid-row-start|grid-row-end|grid-area)$/;
const RELATIVE = /%|\d(vw|vi|svw|lvw|dvw|svi|lvi|dvi|cqw|cqi|cqmin|cqmax|vmin|vmax)\b/i;
function proportional(prop, raw) {
  let v = raw.replace(/!important/i, '').trim();
  if (prop === 'flex') v = v.replace(/^(-?\d*\.?\d+\s+){1,2}/, ''); // 去掉 grow / shrink，剩 basis
  return v !== '100%' && RELATIVE.test(v);
}
/**
 * r4（QA2 r3 的 Z1 / Z2 / Z7，PM 2026-10-03 裁定）：flex / 百分比这两种画法里，一行排几个 = 容器宽 ÷ 条目宽。条目宽一旦
 * 比生成器算出来的那一格宽就换行（`width: 30rem` 在 1440 宽的 team 上把一行 4 个挤成 2 个），所以这两种画法下条目的
 * `width` / `inline-size` / `min-*` / `flex-basis` / `flex` 【不论比例还是固定长度】都算；`flex` 简写不管写什么都算
 * （`flex: 1 1 0` 正是生成器自己拿来做「auto = 一行均分」的那一条）。
 * 只放行三种形状，都是量过不会让一行多排或少排的：
 *   `max-*` 写固定长度（rem / px）—— PM 裁定放行；按比例的 `max-*` 仍按上面 proportional 那条算。
 *   `min-width: 0` / `min-inline-size: 0` —— 只会让条目【能】比内容窄，不会把它撑宽（今天 faq / milestones / pricing / team 各一条）。
 *   `width: 100%` / `inline-size: 100%` —— 一行一个，等于生成器在一列时写的那个值（`pct(1)`）。今天两条：features 的 list 排法、
 *     pricing 的 `plansColumns=1` 单套餐宽卡，都是一列的场合。🔴 它在多列的场合也会放行（例如 team 3 列时写 `.tm-member { width: 100% }`
 *     会变成一列）—— 写在文件头「守不住的边界」里。
 */
const ZERO = /^-?0*\.?0+[a-z%]*$/i;
function flexItemSizes(prop, raw) {
  const v = raw.replace(/!important/i, '').trim();
  if (prop === 'flex' || prop === 'flex-basis' || prop === 'width' || prop === 'inline-size') {
    return !((prop === 'width' || prop === 'inline-size') && v === '100%');
  }
  if (prop === 'min-width' || prop === 'min-inline-size') return !ZERO.test(v);
  return false; // max-*：按比例的那种交给 proportional
}
/** 外边距声明里横向那几段（不是横向的外边距回 null）：`margin` 简写按 1 / 2 / 3 / 4 个值取左右。 */
function horizontalMargins(prop, raw) {
  const v = raw.replace(/!important/i, '').trim();
  const parts = splitTop(v, (t, i) => (/\s/.test(t[i]) ? 1 : 0)).map((x) => x.text).filter(Boolean);
  if (prop === 'margin') return parts.length === 1 ? [parts[0]] : parts.length < 4 ? [parts[1]] : [parts[1], parts[3]];
  if (prop === 'margin-inline') return parts;
  if (/^margin-(inline-start|inline-end|left|right)$/.test(prop)) return [parts[0]];
  return null;
}
function placedWhy(sel, prop, v, grids) {
  for (const branch of branchesOf(sel)) {
    const r = roleOf(branch, grids);
    if (!r) continue;
    if (r.role === 'container') {
      if (prop === 'grid-auto-flow') { if (/\bcolumn\b/.test(v)) return `网格容器 ${r.g.container} 上写了 grid-auto-flow: column（= 有几个排几列）`; continue; }
      if (CONTAINER_PROPS.test(prop)) return `网格容器 ${r.g.container} 上写了 ${prop}（定列数 / 换画法归生成器）`;
      // flex / 百分比那两种画法：条目宽是「(100% − 列距) / n」算出来的，列距对不上就挤掉一列
      const flexy = r.g.render === 'flex' || r.g.render === 'percent';
      if (flexy && (prop === 'gap' || prop === 'column-gap')) {
        const parts = splitTop(v.replace(/!important/i, '').trim(), (t, i) => (/\s/.test(t[i]) ? 1 : 0)).map((x) => x.text).filter(Boolean);
        const col = prop === 'gap' ? (parts[1] || parts[0]) : parts[0];
        const ok = r.g.render === 'flex' ? col === `var(${r.g.gapVar})` : /^(0[a-z%]*|normal)$/.test(col || '');
        if (!ok) return `${r.g.render} 画法的容器 ${r.g.container} 列距写成 ${col}（${r.g.render === 'flex' ? `宽度按 var(${r.g.gapVar}) 算，列距只能是它` : 'Bootstrap 百分比宽不留列距'}）`;
      }
    } else {
      const flexy = r.g.render === 'flex' || r.g.render === 'percent';
      if (ITEM_WIDTH_PROPS.test(prop) && flexy && flexItemSizes(prop, v)) return `${r.g.render} 画法的条目上写了 ${prop}: ${v}（这两种画法里一行排几个就是条目宽度算出来的，宽度归生成器）`;
      if (ITEM_WIDTH_PROPS.test(prop) && proportional(prop, v)) return `条目的 ${prop} 按比例算（= 列宽）`;
      if (flexy) {
        if (prop === 'box-sizing') return `${r.g.render} 画法的条目上写了 box-sizing（宽度算式按 border-box）`;
        const h = horizontalMargins(prop, v);
        if (h && h.some((x) => !/^(0[a-z%]*|auto)$/.test(x))) return `${r.g.render} 画法的条目左右外边距 ${h.join(' / ')}（一行的宽度按 0 算，多出来就挤掉一列）`;
      }
    }
  }
  return null;
}
const allGridsOf = (list) => list.flatMap((b) => ((b.manifest.itemsGrid && Array.isArray(b.manifest.itemsGrid.grids)) ? b.manifest.itemsGrid.grids : []));

/** ② 的旁证：落在声明过的网格上、属于上面那几族的声明（不论放不放行）逐条列出；再数一下因为「别的排法」不归这里的有几条。 */
function placedSeen(list) {
  const grids = allGridsOf(list);
  const seen = [];
  const otherLayout = [];
  const fam = (prop) => CONTAINER_PROPS.test(prop) || ITEM_WIDTH_PROPS.test(prop) || ITEM_SPAN_PROPS.test(prop)
    || /^(grid-auto-flow|gap|column-gap|box-sizing|margin|margin-inline|margin-inline-start|margin-inline-end|margin-left|margin-right)$/.test(prop);
  for (const { css } of list) {
    for (const { file, text } of css) {
      postcss.parse(text, { from: file }).walkDecls((d) => {
        const sel = selectorOf(d);
        const prop = d.prop.toLowerCase();
        if (!fam(prop)) return;
        const line = `${file}:${d.source.start.line} ${prop}: ${d.value}`;
        const bs = branchesOf(sel);
        if (bs.some((b) => roleOf(b, grids))) seen.push(line);
        else if (bs.some((b) => roleOf(b, grids.map((g) => ({ ...g, when: undefined }))))) otherLayout.push(line);
      });
    }
  }
  return { seen, otherLayout };
}

/** ②：块自己的 CSS 里的列数 / 断点规则，逐条点名「文件:行 · 选择器 · 声明」。 */
function cssProblems(blocks) {
  const out = [];
  // r3：按位置那一层拿【所有】声明过的网格去扫【每个】块的 CSS —— 别的块的 block.css 写 `[data-block="team"] .tm-grid` 一样在抢列数。
  // 词汇那几条（`--xx-cols` · 点名列数属性）只在有列数旋钮的块里查：别的块自己的网格（contact 的联系方式格、reviews 按条数排）不归本票。
  const grids = allGridsOf(blocks);
  for (const { manifest, css } of blocks) {
    const k = columnsKnobOf(manifest);
    const attr = k ? `[data-${kebab(k.name)}=` : null;
    for (const { file, text } of css) {
      let root;
      try { root = postcss.parse(text, { from: file }); } catch (e) { out.push(`${file}：解析不了（${e.message}）`); continue; }
      root.walkDecls((d) => {
        const sel = selectorOf(d);
        const prop = d.prop.toLowerCase();
        const v = d.value;
        let why = null;
        if (!k) why = null;
        else if (prop === 'grid-template-columns' && /repeat\(/.test(v) && !/repeat\(\s*auto-(fit|fill)/.test(v)) why = '列数写成 grid-template-columns: repeat(…)';
        else if (prop === 'column-count') why = '列数写成 column-count';
        else if (/^--[a-z0-9-]*cols$/.test(prop)) why = `声明了列数变量 ${d.prop}`;
        // 读共用的 `--items-cols` 可以（features 的连线按列数算长度）；按各块自己的 `--xx-cols` 算宽度就是旧的 flex 写法。
        else if (/^(width|flex|flex-basis|max-width|min-width)$/.test(prop) && /var\(--(?!items-cols\))[a-z0-9-]*cols\)/.test(v)) why = `${d.prop} 按列数变量算`;
        // 点名列数属性的规则：写轨道 / flex 一律算；写 width 只算「几分之一」那种（`33.3333%` / `calc(…)`）——
        // pricing `plansColumns=1` 单套餐宽卡的 `width: 100%` / `auto` 是那张卡自己的尺寸，不是列数。
        else if (sel.includes(attr) && (/^(grid-template-columns|flex|flex-basis|grid-auto-flow|grid-auto-columns)$/.test(prop)
          || (prop === 'width' && (/calc\(/.test(v) || (/%/.test(v) && !/^100%/.test(v.trim())))))) why = `按列数属性 ${attr}…] 写 ${d.prop}`;
        if (!why) why = placedWhy(sel, prop, v, grids);
        if (why) out.push(`${file}:${d.source && d.source.start ? d.source.start.line : '?'} · ${sel.slice(0, 90)} · ${d.prop}: ${v} —— ${why}`);
      });
    }
  }
  return out;
}

/** ④：生成物里不许有物理方向的属性 / 值（同 block-css-logical.test.js 的四维，生成器只写得出这几样里的哪一样就查哪一样）。 */
function physicalProblems(blocks) {
  const out = [];
  for (const { block, manifest } of blocks) {
    const css = itemsGridCss(manifest, block);
    if (!css) continue;
    postcss.parse(css).walkDecls((d) => {
      if (/(^|-)(left|right)(-|$)/.test(d.prop) || /^(left|right)$/.test(d.value.trim())) out.push(`${block}：生成了 ${d.prop}: ${d.value}`);
    });
  }
  return out;
}

const blocks = readBlocks();
if (!blocks.length) die('一个块都没读到 —— 分母为 0');

console.log('① 射程（从 manifest 派生：名字含 columns 的旋钮）');
const scope = blocks.filter((b) => columnsKnobOf(b.manifest));
console.log(`  📌 ${scope.length} 个块：${scope.map((b) => `${b.block}(${columnsKnobOf(b.manifest).name})`).join(' · ')}`);
if (!scope.length) die('射程是 0 —— 下面的「没有违例」不作数');
const dp = declarationProblems(blocks);
check(!dp.length, `每个有列数旋钮的块都声明了 itemsGrid、管的是那个旋钮${dp.length ? ' —— ' + dp.join(' | ') : ''}`);

console.log('② 块自己的 CSS 里没有列数 / 断点规则');
const nFiles = blocks.reduce((n, b) => n + b.css.length, 0);
const cp = cssProblems(blocks);
check(!cp.length, `${nFiles} 份 block.css / shape.css，0 条列数规则${cp.length ? ' —— ' + cp.join(' | ') : ''}`);
{
  // 按位置那一层「看见了什么、放行的是什么」—— 0 违例要配上它看过几条，不然 0 跟「一条都没对上」同形
  const { seen, otherLayout } = placedSeen(blocks);
  check(seen.length > 0, `按位置判的那一层看过 ${seen.length} 条落在声明过的网格上、属于那几族属性的声明，全部放行：`);
  for (const line of seen) console.log(`       · ${line}`);
  console.log(`  📌 落在同一个容器、但写的是生成器不管的排法（不归这里）${otherLayout.length} 条：`);
  for (const line of otherLayout) console.log(`       · ${line}`);
}

console.log('③ 一条规矩的读数（各块原来注释里的规矩，逐块抄；数字 = 手机 / iPad / ≥992）');
const WANT = {
  blog: { 2: [1, 2, 2], 3: [1, 2, 3] },
  faq: { 1: [1, 1, 1], 2: [1, 2, 2], 3: [1, 2, 3] },
  features: { 2: [1, 2, 2], 3: [1, 2, 3], 4: [1, 2, 4] },
  gallery: { 2: [2, 2, 2], 3: [2, 2, 3], 4: [2, 2, 4] },
  logos: { 3: [2, 3, 3], 4: [2, 3, 4], 6: [2, 3, 6] },
  milestones: { auto: [2, 2, 'auto'], 1: [1, 1, 1], 2: [2, 2, 2], 3: [2, 2, 3], 4: [2, 2, 4] },
  pricing: { auto: [1, 2, 'auto'], 1: [1, 1, 1], 2: [1, 2, 2], 3: [1, 2, 3], 4: [1, 2, 4] },
  team: { 2: [1, 2, 2], 3: [1, 2, 3], 4: [1, 2, 4] },
  testimonials: { 1: [1, 1, 1], 2: [1, 2, 2], 3: [1, 2, 3] },
};
function readingProblems(list) {
  const out = [];
  for (const { block, manifest } of list.filter((b) => columnsKnobOf(b.manifest))) {
    const want = WANT[block];
    if (!want) { out.push(`${block}：读数表里没有它 —— 新块要把它的规矩写进 WANT`); continue; }
    let g;
    try { g = itemsGridOf(manifest, block); } catch (e) { out.push(e.message); continue; }
    if (!g) { out.push(`${block}：没有 itemsGrid`); continue; }
    const got = Object.fromEntries(g.values.map((v) => [v, ['phone', 'tablet', 'desktop'].map((bp) => colsAt(v, bp, { phone: g.phone, tablet: g.tablet }))]));
    const ok = JSON.stringify(got) === JSON.stringify(Object.fromEntries(g.values.map((v) => [v, want[v]]))) && g.values.length === Object.keys(want).length;
    out.push({ block, ok, text: g.values.map((v) => `${v}→${got[v].join('/')}`).join(' · ') });
  }
  return out;
}
for (const r of readingProblems(blocks)) {
  if (typeof r === 'string') check(false, r);
  else check(r.ok, `${r.block}：${r.text}`);
}

console.log('④ 生成物只用逻辑属性');
const pp = physicalProblems(blocks);
check(!pp.length, `生成的条目网格 CSS 里没有 left / right${pp.length ? ' —— ' + pp.join(' | ') : ''}`);

console.log('⑤ 故意改坏（在内存里改，不碰磁盘）');
{
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const cases = [
    ['team 的 block.css 塞一条 grid-template-columns: repeat(3, …)', 'team', '\n[data-block="team"] .tm-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n'],
    ['pricing 的 block.css 塞回 --pr-cols: 2', 'pricing', '\n@media (min-width: 768px) { [data-block="pricing"] .pr-grid { --pr-cols: 2; } }\n'],
    ['faq 的 block.css 塞回 width: calc(… / var(--fq-cols))', 'faq', '\n[data-block="faq"] .fq-item { width: calc(100% / var(--fq-cols)); }\n'],
    ['features 的 block.css 塞回 [data-items-columns="3"] .fx-item { width: 33.3333% }', 'features', '\n[data-block="features"][data-items-columns="3"] .fx-item { width: 33.3333%; }\n'],
    ['gallery 的 block.css 塞回 column-count: 3', 'gallery', '\n[data-block="gallery"] .gl-grid { column-count: 3; }\n'],
    // r2：QA2 打回时那四条（字面值写法、选择器里不带列数属性 —— r1 的守卫四条全绿）
    ['X1 features 原来 iPad 那条的写法 .fx-item { width: 33.3333% }', 'features', '\n@media (min-width: 768px) { [data-block="features"] .fx-item { width: 33.3333%; } }\n'],
    ['X2 blog ≥992 字面四列 1fr 1fr 1fr 1fr', 'blog', '\n@media (min-width: 992px) { [data-block="blog"][data-items-layout="grid"] .bl-grid { grid-template-columns: 1fr 1fr 1fr 1fr; } }\n'],
    ['X3 team iPad 三列 calc((100% - 2*var(--tm-gap)) / 3)', 'team', '\n@media (min-width: 768px) { [data-block="team"] .tm-member { width: calc((100% - 2*var(--tm-gap)) / 3); } }\n'],
    ['X4 pricing iPad flex: 0 0 33.3333%', 'pricing', '\n@media (min-width: 768px) { [data-block="pricing"] .pr-plan { flex: 0 0 33.3333%; } }\n'],
    ['logos 容器上 grid-auto-flow: column', 'logos', '\n[data-block="logos"] .lo-grid { grid-auto-flow: column; }\n'],
    ['team 条目逻辑属性 inline-size: 33.3333%（#1473 之后新代码的写法）', 'team', '\n@media (min-width: 768px) { [data-block="team"] .tm-member { inline-size: 33.3333%; } }\n'],
    ['milestones 条目 flex-basis: 50%', 'milestones', '\n[data-block="milestones"] .mi-stat { flex-basis: 50%; }\n'],
    // r3：QA2 第二次打回那六条（选择器换写法 · 属性用简写 · 列宽写成百分数减间距 / 乘法 —— r2 的守卫六条全绿）
    ['Y1 team iPad .tm-grid > * { width: calc((100% - 2*gap) / 3) }', 'team', '\n@media (min-width: 768px) { [data-block="team"] .tm-grid > * { width: calc((100% - 2*var(--tm-gap)) / 3); } }\n'],
    ['Y2 blog ≥992 容器简写 grid-template: none / repeat(4, …)', 'blog', '\n@media (min-width: 992px) { [data-block="blog"][data-items-layout="grid"] .bl-grid { grid-template: none / repeat(4, minmax(0, 1fr)); } }\n'],
    ['Y3 team 条目 width: calc(33.333% - gap)', 'team', '\n[data-block="team"] .tm-member { width: calc(33.333% - var(--tm-gap)); }\n'],
    ['Y4 pricing 条目 flex: 0 0 calc(33.333% - 1rem)', 'pricing', '\n[data-block="pricing"] .pr-plan { flex: 0 0 calc(33.333% - 1rem); }\n'],
    ['Y5 logos ≥992 容器简写 grid: auto-flow / 1fr 1fr 1fr 1fr 1fr', 'logos', '\n@media (min-width: 992px) { [data-block="logos"][data-items-layout="grid"] .lo-grid { grid: auto-flow / 1fr 1fr 1fr 1fr 1fr; } }\n'],
    ['Y6 faq 条目乘法 calc((100% - 2*gap) * 0.3333)', 'faq', '\n[data-block="faq"] .fq-item { width: calc((100% - 2*var(--fq-gap)) * 0.3333); }\n'],
    // r3：按「属性族 + 位置」判之后，这一族里 QA 还没试过的写法也要红（不是只补被点名的六条）
    ['容器 grid-template-areas: "a b c"', 'testimonials', '\n[data-block="testimonials"][data-items-layout="grid"] .tn-grid { grid-template-areas: "a b c"; }\n'],
    ['容器 grid-template-columns 不等分三轨 1fr 1fr 2fr', 'logos', '\n[data-block="logos"] .lo-grid { grid-template-columns: 1fr 1fr 2fr; }\n'],
    ['容器 grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr))', 'blog', '\n[data-block="blog"] .bl-grid { grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }\n'],
    ['容器 column-width: 12rem', 'gallery', '\n[data-block="gallery"] .gl-grid { column-width: 12rem; }\n'],
    ['容器 display: block（把网格整个拆掉 = 一列）', 'logos', '\n[data-block="logos"] .lo-grid { display: block; }\n'],
    ['flex 容器 flex-wrap: nowrap（一行塞下全部）', 'team', '\n[data-block="team"] .tm-grid { flex-wrap: nowrap; }\n'],
    ['条目 width: 30cqw（按容器宽的相对单位）', 'features', '\n[data-block="features"] .fx-item { width: 30cqw; }\n'],
    ['条目 min-inline-size: 30%', 'faq', '\n[data-block="faq"] .fq-item { min-inline-size: 30%; }\n'],
    ['直接子元素写成标签 .pr-grid > div { flex: 1 1 30% }', 'pricing', '\n[data-block="pricing"] .pr-grid > div { flex: 1 1 30%; }\n'],
    ['直接子元素写成 :nth-child .mi-grid > :nth-child(n) { width: 25% }', 'milestones', '\n[data-block="milestones"] .mi-grid > :nth-child(n) { width: 25%; }\n'],
    ['容器里的标签 .tm-grid li { width: 25% }', 'team', '\n[data-block="team"] .tm-grid li { width: 25%; }\n'],
    [':is() 包着条目 :is(.fq-item):hover { width: 50% }', 'faq', '\n[data-block="faq"] :is(.fq-item):hover { width: 50%; }\n'],
    ['CSS 嵌套 .tm-grid { & > * { width: 33% } }', 'team', '\n[data-block="team"] .tm-grid { & > * { width: 33%; } }\n'],
    ['CSS 嵌套省略 & [data-block="logos"] { .lo-grid { grid: none / 1fr 1fr } }', 'logos', '\n[data-block="logos"] { .lo-grid { grid: none / 1fr 1fr; } }\n'],
    ['别的块（hero）的 block.css 写 [data-block="team"] .tm-grid { display: grid }', 'hero', '\n[data-block="team"] .tm-grid { display: grid; }\n'],
    ['flex 容器的列距不按 gapVar：team .tm-grid { column-gap: 3rem }', 'team', '\n[data-block="team"] .tm-grid { column-gap: 3rem; }\n'],
    ['flex 容器 gap 简写的列距：faq .fq-grid { gap: 1rem 3rem }', 'faq', '\n[data-block="faq"] .fq-grid { gap: 1rem 3rem; }\n'],
    ['百分比画法的容器加列距：features .fx-grid { column-gap: 1rem }', 'features', '\n[data-block="features"] .fx-grid { column-gap: 1rem; }\n'],
    ['flex 条目左右外边距：pricing .pr-plan { margin-inline-end: 2rem }', 'pricing', '\n[data-block="pricing"] .pr-plan { margin-inline-end: 2rem; }\n'],
    ['flex 条目 margin 简写的左右段：milestones .mi-stat { margin: 0 1rem }', 'milestones', '\n[data-block="milestones"] .mi-stat { margin: 0 1rem; }\n'],
    ['flex 条目 box-sizing: content-box（内边距算进宽度之外）', 'milestones', '\n[data-block="milestones"] .mi-stat { box-sizing: content-box; }\n'],
    ['属性选择器写 class：[class~="tm-member"] { width: 30% }', 'team', '\n[data-block="team"] [class~="tm-member"] { width: 30%; }\n'],
    ['形态文件里写（gallery/grid/shape.css）', 'gallery', '\n[data-block="gallery"] .gl-grid { grid-template-columns: 1fr 1fr 1fr; }\n', '/grid/shape.css'],
    // r4：QA2 r3 的 Z4b —— 属性条件不带值（匹配所有排法，grid 也在内），r3 当成「别的排法」放行了；部分匹配的运算符同理
    ['Z4b blog [data-items-layout]（不带值）.bl-grid { 1fr ×4 }', 'blog', '\n[data-block="blog"][data-items-layout] .bl-grid { grid-template-columns: 1fr 1fr 1fr 1fr; }\n'],
    ['blog [data-items-layout^="gr"] .bl-grid { 1fr ×4 }（部分匹配）', 'blog', '\n[data-block="blog"][data-items-layout^="gr"] .bl-grid { grid-template-columns: 1fr 1fr 1fr 1fr; }\n'],
    ['logos [data-items-layout*="ri"] .lo-grid { grid: none / 1fr 1fr }（部分匹配）', 'logos', '\n[data-block="logos"][data-items-layout*="ri"] .lo-grid { grid: none / 1fr 1fr; }\n'],
    // r4：QA2 r3 的 Z1 / Z2 / Z7 —— flex / 百分比画法的条目写固定长度（一行 4 个 → 2 / 2 / 3 个，QA2 在页面上量过）
    ['Z1 team ≥992 条目 width: 30rem', 'team', '\n@media (min-width: 992px) { [data-block="team"] .tm-member { width: 30rem; } }\n'],
    ['Z2 pricing 条目 min-width: 28rem', 'pricing', '\n[data-block="pricing"] .pr-plan { min-width: 28rem; }\n'],
    ['Z7 milestones 条目 flex: 0 0 22rem', 'milestones', '\n[data-block="milestones"] .mi-stat { flex: 0 0 22rem; }\n'],
    ['flex 条目 flex: 1 1 0（= 生成器的「auto 一行均分」）', 'pricing', '\n[data-block="pricing"] .pr-plan { flex: 1 1 0; }\n'],
    ['flex 条目 width: auto（按内容宽）', 'faq', '\n[data-block="faq"] .fq-item { width: auto; }\n'],
    ['百分比画法条目 inline-size: 20rem', 'features', '\n[data-block="features"] .fx-item { inline-size: 20rem; }\n'],
    ['flex 条目 flex-basis: 18rem', 'team', '\n[data-block="team"] .tm-member { flex-basis: 18rem; }\n'],
    // r4：QA1 r3 的 Q4 —— grid 画法的四个块 r3 没写 item，后代组合（两个类都写了）在 flex 块上红、在 grid 块上绿
    ['blog 后代组合 .bl-grid .bl-post { width: 33% }', 'blog', '\n[data-block="blog"] .bl-grid .bl-post { width: 33%; }\n'],
    ['gallery 后代组合 .gl-grid .gl-item { max-width: 25% }', 'gallery', '\n[data-block="gallery"] .gl-grid .gl-item { max-width: 25%; }\n'],
    ['testimonials 后代组合 .tn-grid .tn-item { inline-size: 30% }', 'testimonials', '\n[data-block="testimonials"][data-items-layout="grid"] .tn-grid .tn-item { inline-size: 30%; }\n'],
  ];
  for (const [label, block, inject, fileEnd = '/block.css'] of cases) {
    const bs = clone(blocks);
    const f = bs.find((x) => x.block === block).css.find((c) => c.file.endsWith(fileEnd));
    if (!f) die(`⑤ 找不到 ${block} 的 ${fileEnd}`);
    f.text += inject;
    const hits = cssProblems(bs);
    check(hits.length === 1 && hits[0].startsWith(`${f.file}:`), `${label} ⟹ 红 ${hits.length} 条、点名 ${hits[0] ? hits[0].split(' · ')[0] : '（没有）'}`);
  }
  // 反过来：这几条不是列数，塞进去必须【不红】—— 判法放宽了，要证明它没有放宽到见什么拦什么
  for (const [label, block, inject] of [
    ['blog featured 排法自己的三栏（生成器不管 featured）', 'blog', '\n@media (min-width: 992px) { [data-block="blog"][data-items-layout="featured"] .bl-grid { grid-template-columns: 1fr 1fr 1fr; } }\n'],
    ['logos row 排法的 flex（生成器不管 row）', 'logos', '\n[data-block="logos"][data-items-layout="row"] .lo-grid { flex-wrap: nowrap; }\n'],
    ['条目里面的图片 .tm-member .tm-photo { width: 40% }', 'team', '\n[data-block="team"] .tm-member .tm-photo { width: 40%; }\n'],
    ['容器的伪元素 .tm-grid::before { width: 50% }', 'team', '\n[data-block="team"] .tm-grid::before { width: 50%; }\n'],
    // r4：flex / 百分比画法的条目只放行这三种（flexItemSizes）；r3 这一格原来还放行 `flex: 1 1 0` 和 `width: 20rem`，r4 起两条都红（见上面 Z1 那组）
    ['flex 条目 min-width: 0 · width: 100% · max-width: 20rem · max-width: 100%', 'pricing', '\n[data-block="pricing"] .pr-plan { min-width: 0; width: 100%; max-width: 20rem; max-inline-size: 100%; }\n'],
    ['grid 画法的条目写固定宽（轨道由容器定）：blog .bl-post { width: 20rem }', 'blog', '\n[data-block="blog"] .bl-grid .bl-post { width: 20rem; min-width: 0; }\n'],
    // r4（PM 2026-10-03 裁定）：grid-column / grid-row 整族出射程 —— r3 这里是红的，这是一格【有意的】红 → 绿
    ['跨列 grid-column: span 2（直接子元素）', 'blog', '\n[data-block="blog"][data-items-layout="grid"] .bl-grid > * { grid-column: span 2; }\n'],
    ['跨列 grid-column: span 2（后代组合，QA1 r3 的 Q4 原样）', 'blog', '\n[data-block="blog"][data-items-layout="grid"] .bl-grid .bl-post { grid-column: span 2; }\n'],
    ['gallery mosaic 第一张 2×2（main 上现成那条的同形）', 'gallery', '\n[data-block="gallery"][data-items-layout="mosaic"] .gl-item:nth-child(5) { grid-column: span 2; grid-row: span 2; }\n'],
    ['容器的列距 / 对齐：gap · justify-content · grid-auto-flow: row dense', 'logos', '\n[data-block="logos"] .lo-grid { gap: 2rem; justify-content: center; grid-auto-flow: row dense; }\n'],
    ['flex 容器的列距照旧读 gapVar、改 gapVar 的值、只改行距', 'team', '\n[data-block="team"] .tm-grid { --tm-gap: 3rem; column-gap: var(--tm-gap); row-gap: 4rem; }\n'],
    ['flex 条目上下外边距 margin: 0 0 1rem · margin-inline: auto', 'pricing', '\n[data-block="pricing"] .pr-plan { margin: 0 0 1rem; margin-inline: auto; }\n'],
    ['grid 画法的容器改列距（轨道是 minmax(0,1fr)，列数不变）', 'logos', '\n[data-block="logos"] .lo-grid { column-gap: 3rem; }\n'],
  ]) {
    const bs = clone(blocks);
    bs.find((x) => x.block === block).css[0].text += inject;
    const hits = cssProblems(bs);
    check(hits.length === 0, `放行：${label} ⟹ 红 ${hits.length} 条${hits.length ? '（' + hits.join(' | ') + '）' : ''}`);
  }
  const bs = clone(blocks);
  delete bs.find((x) => x.block === 'milestones').manifest.itemsGrid;
  const hits = declarationProblems(bs);
  check(hits.length === 1 && /milestones/.test(hits[0]), `删掉 milestones 的 itemsGrid ⟹ 红 ${hits.length} 条（${hits[0] || '没有'}）`);
  for (const [label, block, mutate] of [
    ['milestones 的 phone 从 2 改成 1（手机变一列）', 'milestones', (g) => { g.phone = 1; }],
    ['pricing 的 tablet 从 2 改成 3', 'pricing', (g) => { g.tablet = 3; }],
  ]) {
    const bs2 = clone(blocks);
    mutate(bs2.find((x) => x.block === block).manifest.itemsGrid);
    const bad = readingProblems(bs2).filter((r) => typeof r === 'string' || !r.ok);
    check(bad.length === 1 && bad[0].block === block, `${label} ⟹ ③ 红 ${bad.length} 格（${bad.map((r) => r.block || r).join(' / ')}）`);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
