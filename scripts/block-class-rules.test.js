#!/usr/bin/env node
/**
 * block-class-rules.test.js — 块的 markup 里用着的【块前缀 class】，必须有一条带声明的 CSS 规则（#1519）。
 *
 *   node scripts/block-class-rules.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * 同一个形状付过三次账（#1503 · #1507 · #1513）：一个新块的 Section.tsx 挂了一个自己前缀的 class
 * （`ct-map-card` / `hdr-drawer` …），却没有任何一条规则。它是**静默**的 —— 只有某个站恰好把旋钮拧到
 * 那一档、样例站恰好渲染到它时，`theme-css` 那道检查才报 `unstyled class`，而那时 main 已经红了、
 * 模板字节推不出去。这一格把同一个问题提前到「改 markup 的那一刻」，不依赖样例站渲染到谁。
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 * 对 `blocks/<块>/` 每一个块：
 *   ① 块前缀 = 这个块**自己的** CSS（`blocks/<块>/**.css`）选择器里出现最多的那段 class 前缀
 *      （`hdr` / `ftr` / `ct` / 旧块的 `header` …）。从文件现取，不写死清单 —— 新块进来自动覆盖。
 *   ② markup 里的块前缀 class = 块目录下**全部** `*.tsx`（剥掉注释）里形如 `<前缀>-x` / `<前缀>__x` 的词。
 *      🔴 不只 `Section.tsx`：`contact-new/ContactMap.tsx` · `gallery-new/Lightbox.tsx` · `testimonials-new/Carousel.tsx`
 *      也是块的 markup，#1513 那 6 个 class 里有 4 个只住在 `ContactMap.tsx` —— 只读 `Section.tsx` 的版本对它的
 *      立案案例按构造是绿的（#1519 r1 被 QA1 打回的就是这一条）。`src/components/` 下的共用组件不在范围内。
 *   ③ 每一个都要在【源】CSS 里有一条规则：它出现在某条规则的选择器里，而且那条规则**至少有一条声明**
 *      （`.x {}` 这种空壳不算）；或者在 `scripts/lib/site-css.js` 里以 `.x` 出现（那份是 JS 拼出来的
 *      全站规则，例 `ON_DEEP_MUTED` 的 `.ftr-muted-on-dark`）。
 *
 * 🔴 三个形状【不是 class】，按构造排掉，别把它们报成缺陷（#1513 验收时 QA1 的筛查就是被它们灌出 24 条）：
 *    · CSS 自定义属性 `--pr-fc`：前面紧挨着 `-`，② 的边界条件不收它；
 *    · data 属性 `data-hdr-part`：同上，前面是 `-`；
 *    · `id`（`id="cta-heading"`，给 `aria-labelledby` 指的）：`id=` / `aria-labelledby=` / `htmlFor=` 这类属性
 *      的值整段跳过，引号和 `{…}` 表达式两种写法都算（`aria-labelledby={h ? 'text-block-heading' : undefined}`）。
 *    另外两个同类，写这一格时在全仓上撞到的：
 *    · data 属性的【值】（`data-block-part="testimonials-list"`）：`data-*=` 后面那个值同样整段跳过；
 *    · 块类型名（`blockAttrs('cta-new', …)` 里的 `cta-new`）：等于 `blocks/` 下某个目录名的词不算 class。
 *
 * 🔴 「源 CSS」排掉五份生成物：`public/shapes.css` / `public/base.css`（`build-blocks.js` 从 `blocks/` 拼出来，
 *    两边一致由 `build-blocks.js --check` 守），以及 `public/site.css` / `theme.css` / `custom.css`（sync-config
 *    按站生成、gitignore 的 —— CI 上不存在，留着它们本地读数就跟着手上那个站变）。
 *    不排的话，「只从 block.css 删掉一条规则」这个实验会被还没重新生成的 shapes.css 挡成绿 ——
 *    这一格就量不到它要量的那件事。
 *
 * 📌 量不到的（说在明处）：
 *    · **拼出来的 class**（`` `hdr-logo-${logo}` ``）：静态读不出它会取哪些值，按构造跳过；
 *    · **一条规则都没有的块**：① 取不到前缀，整块不查（今天 45 个块里 0 个是这样，见 ⑤ 那格的读数）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');              // templates/nextjs
const BLOCKS = path.join(ROOT, 'blocks');
const SITE_CSS_JS = path.join(ROOT, 'scripts', 'lib', 'site-css.js');
const GENERATED = new Set(['public/shapes.css', 'public/base.css', 'public/site.css', 'public/theme.css', 'public/custom.css']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'site', 'sites']);

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const stripBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
// TSX：块注释（含 JSX 的 `{/* */}`）+ 行注释。行注释只认行首或前面是空白 —— 不误伤 `https://`。
const stripTsxComments = (s) => stripBlockComments(s).replace(/(^|\s)\/\/.*$/gm, '$1');

function walkCss(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkCss(full, out);
    else if (e.name.endsWith('.css') && !GENERATED.has(path.relative(ROOT, full).split(path.sep).join('/'))) out.push(full);
  }
  return out;
}

/** 一份 CSS 里的全部规则 [{selector, body}]：一层层剥最里面的 `{…}`，@media 里的规则也取到。 */
function rulesOf(css) {
  let s = stripBlockComments(css);
  const rules = [];
  const inner = /([^{}]*)\{([^{}]*)\}/g;
  for (;;) {
    let found = false;
    s = s.replace(inner, (_, sel, body) => { found = true; rules.push({ selector: sel.trim(), body }); return ''; });
    if (!found) break;
  }
  return rules.filter((r) => r.selector && !r.selector.startsWith('@'));
}

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const classRe = (c) => new RegExp(`\\.${esc(c)}(?![\\w-])`);

// ── 仪器自检：取不到东西就是跑不起来，不是全过 ──────────────────────────────────────────────────
if (!fs.existsSync(BLOCKS)) die(`没有 ${BLOCKS}`);
if (!fs.existsSync(SITE_CSS_JS)) die(`没有 ${SITE_CSS_JS}`);
const cssFiles = walkCss(ROOT);
if (cssFiles.length === 0) die('一份源 CSS 都没找到');
const allRules = cssFiles.flatMap((f) => rulesOf(fs.readFileSync(f, 'utf8')));
const realRules = allRules.filter((r) => /[\w-]\s*:/.test(r.body));        // 至少一条声明
const siteCssJs = stripTsxComments(fs.readFileSync(SITE_CSS_JS, 'utf8'));
if (rulesOf('.a{x:1} @media (min-width:1px){.b{y:2}} .c{}').map((r) => r.selector).join(',') !== '.a,.b,.c') {
  die('rulesOf 自检不过：连三条最简规则都拆不对，下面的读数不可信');
}

const hasRule = (c) => realRules.some((r) => classRe(c).test(r.selector)) || classRe(c).test(siteCssJs);

/** 块前缀：这个块自己 CSS 里选择器最多的那段 class 前缀（`hdr-x` / `header__x` 的 `hdr` / `header`）。 */
function prefixOf(dir) {
  const own = walkCss(dir);
  const n = new Map();
  for (const f of own) {
    for (const r of rulesOf(fs.readFileSync(f, 'utf8'))) {
      for (const m of r.selector.matchAll(/\.([a-z][a-z0-9]*)(?:-|__)[a-z0-9]/g)) n.set(m[1], (n.get(m[1]) || 0) + 1);
    }
  }
  let best = null;
  for (const [k, v] of n) if (!best || v > best[1]) best = [k, v];
  return best && best[0];
}

/** markup 里的块前缀 class（剥注释、排掉 id 类属性的值、跳过拼出来的）。 */
const ID_LIKE_ATTR = /(?<![\w-])(?:id|aria-labelledby|aria-describedby|aria-controls|htmlFor|data-[\w-]+)=(?:"[^"]*"|'[^']*'|\{[^{}]*\})/g;
function markupClassesOf(tsx, prefix, blockNames) {
  const src = stripTsxComments(tsx).replace(ID_LIKE_ATTR, ' ');
  const re = new RegExp(`(?<![\\w-])${esc(prefix)}(?:-|__)[a-z0-9_-]*[a-z0-9](?![\\w-]|\\$\\{)`, 'g');
  return [...new Set(src.match(re) || [])].filter((c) => !blockNames.has(c)).sort();
}

// ── 逐块 ──────────────────────────────────────────────────────────────────────────────────────
const blocks = fs.readdirSync(BLOCKS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(BLOCKS, e.name, 'Section.tsx')))
  .map((e) => e.name).sort();
if (blocks.length === 0) die('blocks/ 底下一个带 Section.tsx 的块都没有');
const blockNames = new Set(fs.readdirSync(BLOCKS));

console.log(`══ 块前缀 class 都有规则（源 CSS ${cssFiles.length} 份 · ${realRules.length} 条带声明的规则 · ${blocks.length} 个块）══`);

const noPrefix = [];
let checked = 0;
for (const b of blocks) {
  const prefix = prefixOf(path.join(BLOCKS, b));
  if (!prefix) { noPrefix.push(b); continue; }
  // 块目录下【全部】`*.tsx`，不只 `Section.tsx`：#1513 补的 6 个 class 里有 4 个住在 `contact-new/ContactMap.tsx`（#1519 r1 QA1）。
  const used = [...new Set(fs.readdirSync(path.join(BLOCKS, b))
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => markupClassesOf(fs.readFileSync(path.join(BLOCKS, b, f), 'utf8'), prefix, blockNames)))].sort();
  checked += used.length;
  const missing = used.filter((c) => !hasRule(c));
  if (missing.length) {
    bad(`${b}（前缀 ${prefix}）：markup 里 ${used.length} 个块前缀 class，${missing.length} 个没有带声明的规则 —— ${missing.join(' · ')}`);
  } else {
    ok(`${b}（前缀 ${prefix}）：${used.length} 个块前缀 class 都有规则`);
  }
}

// ⑤ 取不到前缀的块整块不查 —— 读数打出来，别让它安静地变多。
if (noPrefix.length) bad(`${noPrefix.length} 个块取不到前缀（自己没有一条带 class 的规则），整块没查：${noPrefix.join(' · ')}`);
else ok(`${blocks.length} 个块都取到了前缀，一个都没漏查`);

// 仪器自检：查了 0 个 class 等于什么都没量。
if (checked === 0) die('全部块加起来一个块前缀 class 都没取到 —— 提取那一步坏了');

console.log(`\n共查 ${checked} 个 class · ✅ ${pass} · ❌ ${fail}`);
process.exit(fail ? 1 : 0);
