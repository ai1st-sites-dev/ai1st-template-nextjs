#!/usr/bin/env node
/**
 * block-deep-common.test.js — 深底公共规则 / Eyebrow 样式表 / 按钮样式函数，块里不许再各抄一份（#1533 T6c-1）。
 *
 *   node scripts/block-deep-common.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * #1533 之前，15 个块各抄一份 Eyebrow 类名表（只差前缀）、10 个块各写一份 `btnClass`、14 个块的 `block.css` 各写一份
 * 深底反白（198 条里约一半是同一批：根上字色 · 标题 · eyebrow · 主按钮 / 描边 / link 按钮）。现在它们各只有一份：
 *   · Eyebrow → `src/components/Eyebrow.tsx`；按钮 → `src/components/Button.tsx`；
 *   · 深底公共规则 → `scripts/lib/site-css.js` §DEEP_COMMON（按块点名，值只写那一处）。
 * 没有这一格，下一个新块照样从隔壁抄一份 —— 这三样当初就是这么长成 15 份的。
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 * ① 块的 CSS（`blocks/<块>/block.css` + 形态目录下的 `shape.css`，@media 里的也算）：选择器的根是
 *    `[data-block="<块>"]` 且带深底条件（`[data-tone="dark"]` / `[data-tone="brand"]` / `:not([data-tone="light"])`）时，
 *    根后面那一段（尾巴）是下面任何一种就红 —— 这些是**公共项**，只许住在 §DEEP_COMMON：
 *      · 空（根自己）且声明里有 `color`               —— 根上字色
 *      · `.btn-primary` · `.btn-primary:hover` · `.btn-outline-primary` · `.btn-link`
 *      · `.text-muted`                                  —— 灰字白 .92（§ON_DEEP_MUTED 那一条）
 *      · `[data-eyebrow…]` / `.<前缀>-eyebrow-{pill,outline,dash,plain}`
 *      · `.<前缀>-title`（块标题；§DEEP_COMMON 的 title 那一行登记了各块真实的类名，也一起认）
 *    块特有的（`.pr-card` · `.fx-icon` · `.fq-help` · hero 的 `.btn-primary:active` …）不在射程内，尾巴多一层也不在
 *    （`.pr-card .btn-primary` 是卡片内部的事）。
 * ② 块目录下全部 `*.tsx`（剥掉注释）：
 *      · 出现 `btnClass` / `EYEBROW_CLASS` / `eyebrowClass` 这几个名字；
 *      · 出现带块前缀的 eyebrow 类名（`cta-eyebrow-pill` / `fx-eyebrow--pill` 这类）；
 *      · 出现 Eyebrow 那张表的样式串（`badge rounded-pill bg-primary-subtle text-primary`）—— 换个名字抄表也认得出；
 *      · 一个函数里同时有 `'link'` / `'outline'` / `'solid'` 的判断、又直接 `return` 一个 `btn …` 类名串 —— 换个名字写
 *        btnClass 也认得出（只认直接 return 的：整个组件函数里也有 `'solid'` 和按钮类名，但它 return 的是 JSX）。
 * ③ 放行名单（下面 §ALLOW）：一条一行，**块 + 选择器（或函数名）写死**，各带一句为什么。🔴 不许按块整块豁免 ——
 *    名单里那个块的其它公共项照样红（自检 ⑤ 那一臂专门量这件事）；名单里没被用到的一行也红（过期了就删）。
 *
 * 📌 量不到的（说在明处）：
 *    · 不经 `[data-block="<块>"]` 起头的选择器（比如裸 `[data-tone="dark"] .btn-primary`）不在 ① 的射程 —— 块的 CSS
 *      本来就不许这么写（`scripts/block-build/build-blocks.js` §assertPieceOwnsItsRules：每条规则以本块开头）；
 *    · 箭头函数写的按钮样式函数：② 只认 `function 名字(…) { … }` 这种写法。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');              // templates/nextjs
const BLOCKS = path.join(ROOT, 'blocks');
const { DEEP_COMMON } = require('./lib/site-css.js');

/**
 * 放行名单。今天是空的：值跟大家不一样的那几格（faq / logos 深底主按钮字 · page-header 描边与 dash / plain）
 * 是 §DEEP_COMMON 里单独一行，不在块里写覆盖。
 *   { block: 'faq', css: '[data-block="faq"][data-tone="dark"] .btn-primary', why: '…' }
 *   { block: 'logos', fn: 'ctaClass', why: '…' }
 */
const ALLOW = [
  // logos 的块头链接（`ctaClass`）不在 #1533 的射程：做什么 2 那条现取命令（grep `btnClass`）读出的 10 个块里没有它，
  // 而它的类名跟 Button 的三种都不一样（solid 不带 justify-content-center、link 带 fw-semibold text-sm、不带 text-nowrap），
  // 换成 Button 是一次外观改动。
  { block: 'logos', fn: 'ctaClass', why: 'logos 不在 #1533 做什么 2 的 10 块里；类名跟 Button 不同，换过去会变样子' },
];

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const stripBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const stripTsxComments = (s) => stripBlockComments(s).replace(/(^|\s)\/\/.*$/gm, '$1');

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
const TITLE_OF = (DEEP_COMMON.find((r) => r.item === 'title') || {}).tailOf || {};
const COMMON_TAILS = ['.btn-primary', '.btn-primary:hover', '.btn-outline-primary', '.btn-link', '.text-muted'];

/** 这个选择器（一段，不含逗号）是不是本块的一条公共深底规则。是 ⟹ 回它属于哪一项；不是 ⟹ null。 */
function commonItemOf(block, sel, body) {
  const m = new RegExp(`^\\[data-block="${esc(block)}"\\]((?:\\[[^\\]]+\\]|:not\\(\\[[^\\]]+\\]\\))*)\\s*(.*)$`).exec(sel.trim());
  if (!m) return null;
  const quals = m[1];
  if (!/\[data-tone="(dark|brand)"\]|:not\(\[data-tone="light"\]\)/.test(quals)) return null;
  const tail = m[2].trim();
  if (tail === '') return /(^|;|\s)color\s*:/.test(body) ? '根上字色' : null;
  if (COMMON_TAILS.includes(tail)) return tail;
  if (/^\[data-eyebrow(=[^\]]*)?\]$/.test(tail) || /^\.[a-z][a-z0-9]*-eyebrow-(pill|outline|dash|plain)$/.test(tail)) return 'eyebrow';
  if (/^\.[a-z][a-z0-9]*-title$/.test(tail) || tail === TITLE_OF[block]) return '标题';
  return null;
}

/** 一份块 CSS 的违例：[{sel, item}]。`allow` 是这个块在名单上的选择器集合，命中的记进 `used`。 */
function cssViolations(block, css, allow = new Set(), used = new Set()) {
  const out = [];
  for (const r of rulesOf(css)) {
    for (const sel of r.selector.split(',').map((x) => x.trim()).filter(Boolean)) {
      const item = commonItemOf(block, sel, r.body);
      if (!item) continue;
      if (allow.has(sel)) { used.add(sel); continue; }
      out.push({ sel, item });
    }
  }
  return out;
}

const EYEBROW_TABLE_STR = 'badge rounded-pill bg-primary-subtle text-primary';
/** 一份块 TSX 的违例：[字符串]。`allowFns` 是这个块在名单上的函数名，命中的记进 `used`。 */
function tsxViolations(src, allowFns = new Set(), used = new Set()) {
  const s = stripTsxComments(src);
  const out = [];
  for (const name of ['btnClass', 'EYEBROW_CLASS', 'eyebrowClass']) if (new RegExp(`\\b${name}\\b`).test(s)) out.push(`名字 ${name}`);
  const pref = s.match(/\b[a-z][a-z0-9]*-eyebrow-{1,2}(pill|outline|dash|plain)\b/g);
  if (pref) out.push(`带块前缀的 eyebrow 类名 ${[...new Set(pref)].join(' · ')}`);
  if (s.includes(EYEBROW_TABLE_STR)) out.push(`Eyebrow 样式表的串「${EYEBROW_TABLE_STR}」（表只许住 src/components/Eyebrow.tsx）`);
  for (const fm of s.matchAll(/\bfunction\s+(\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
    const [, name, body] = fm;
    if (/'(link|outline|solid)'/.test(body) && /return\s*(?:\w+\s*\?\s*)?['"`]btn /.test(body)) {
      if (allowFns.has(name)) { used.add(name); continue; }
      out.push(`按钮样式函数 ${name}()（style → 类名只许住 src/components/Button.tsx §buttonClass）`);
    }
  }
  return out;
}

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// ── 仪器自检：拿合成的输入量一遍，量不出就是尺子坏了 ─────────────────────────────────────────────
{
  const v = (css, allow, used) => cssViolations('x', css, allow, used).map((o) => o.item).join(',');
  const checks = [
    [v('[data-block="x"][data-tone="dark"] .btn-primary{color:red}'), '.btn-primary', '主按钮'],
    [v('[data-block="x"][data-tone="brand"] .btn-link{color:red}'), '.btn-link', 'brand 底'],
    [v('[data-block="x"]:not([data-tone="light"]) .x-eyebrow-pill{color:red}'), 'eyebrow', ':not(light) 写法 + 旧 eyebrow 类名'],
    [v('[data-block="x"][data-tone="dark"] [data-eyebrow="dash"]{color:red}'), 'eyebrow', 'data-eyebrow'],
    [v('[data-block="x"][data-tone="dark"]{color:#fff}'), '根上字色', '根上字色'],
    [v('[data-block="x"][data-tone="dark"]{--x:1}'), '', '根上只写变量不算'],
    [v('[data-block="x"][data-tone="dark"] .x-title{color:#fff}'), '标题', '标题'],
    [v('@media (min-width:1px){[data-block="x"][data-tone="dark"] .btn-outline-primary{color:#fff}}'), '.btn-outline-primary', '@media 里'],
    [v('[data-block="x"][data-tone="dark"] .x-card{color:#fff}'), '', '块特有的不算'],
    [v('[data-block="x"][data-tone="dark"] .x-card .btn-primary{color:#fff}'), '', '卡片内部的按钮不算'],
    [v('[data-block="x"][data-tone="light"] .btn-primary{color:#fff}'), '', '浅底不算'],
    [v('[data-block="x"][data-image="background"] [data-eyebrow="pill"]{color:#fff}'), '', '不带深底条件不算'],
  ];
  // 第二臂（#1533 五审 §2）：名单上那个块里，**不在名单上**的公共项照样红 —— 名单不能退化成按块豁免。
  const used = new Set();
  const two = '[data-block="x"][data-tone="dark"] .btn-primary{color:red} [data-block="x"][data-tone="dark"] .btn-link{color:red}';
  checks.push([v(two, new Set(['[data-block="x"][data-tone="dark"] .btn-primary']), used), '.btn-link', '名单上的块，名单外的那一条照样红']);
  checks.push([[...used].join(), '[data-block="x"][data-tone="dark"] .btn-primary', '名单那一条记为「用到了」']);
  const t = (src, allow) => tsxViolations(src, allow).length;
  checks.push([String(t('function btnClass(b) { return "btn"; }\n')), '1', 'tsx：btnClass']);
  checks.push([String(t("const T = { pill: 'badge rounded-pill bg-primary-subtle text-primary px-3' };\n")), '1', 'tsx：换名抄 Eyebrow 表']);
  checks.push([String(t("function ctaStyle(s) {\n  if (s === 'link') return 'btn btn-link';\n  return 'btn btn-primary';\n}\n")), '1', 'tsx：换名写按钮样式函数']);
  checks.push([String(t("function ctaStyle(s) {\n  if (s === 'link') return 'btn btn-link';\n  return 'btn btn-primary';\n}\n", new Set(['ctaStyle']))), '0', 'tsx：名单上的函数']);
  checks.push([String(t("<span className=\"cta-eyebrow-pill\" />\n")), '1', 'tsx：旧 eyebrow 类名']);
  checks.push([String(t("// btnClass 已经搬走\n<Eyebrow style=\"pill\" />\n")), '0', 'tsx：注释里提到不算']);
  const broke = checks.filter(([got, want]) => got !== want);
  if (broke.length) die(`尺子自检不过：${broke.map(([got, want, what]) => `${what}（要 ${JSON.stringify(want)}，读到 ${JSON.stringify(got)}）`).join(' · ')}`);
  console.log(`══ 尺子自检 ${checks.length} 格全对 ══`);
}

// ── 逐块 ──────────────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(BLOCKS)) die(`没有 ${BLOCKS}`);
if (!Object.keys(TITLE_OF).length) die('site-css.js §DEEP_COMMON 里没有 title 那一行 —— 标题类名读不到');
const blocks = fs.readdirSync(BLOCKS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(BLOCKS, e.name, 'Section.tsx')))
  .map((e) => e.name).sort();
if (blocks.length === 0) die('blocks/ 底下一个带 Section.tsx 的块都没有');

const usedCss = new Set(); const usedFn = new Set();
let cssFiles = 0; let tsxFiles = 0;
console.log(`══ 块里不许再有公共深底规则 / Eyebrow 样式表 / 按钮样式函数（${blocks.length} 个块）══`);
for (const b of blocks) {
  const dir = path.join(BLOCKS, b);
  const allowCss = new Set(ALLOW.filter((a) => a.block === b && a.css).map((a) => a.css));
  const allowFn = new Set(ALLOW.filter((a) => a.block === b && a.fn).map((a) => a.fn));
  const problems = [];
  for (const f of walk(dir, '.css')) {
    cssFiles++;
    const rel = path.relative(ROOT, f);
    for (const o of cssViolations(b, fs.readFileSync(f, 'utf8'), allowCss, usedCss)) problems.push(`${rel}：${o.sel}（公共项「${o.item}」）`);
  }
  for (const f of walk(dir, '.tsx')) {
    tsxFiles++;
    const rel = path.relative(ROOT, f);
    for (const o of tsxViolations(fs.readFileSync(f, 'utf8'), allowFn, usedFn)) problems.push(`${rel}：${o}`);
  }
  if (problems.length) bad(`${b}：${problems.length} 处 ——\n      ${problems.join('\n      ')}`);
  else ok(`${b}`);
}

// 名单上没被用到的一行 = 过期了（那个块已经不那么写了），留着就是一张空头豁免。
const stale = ALLOW.filter((a) => (a.css && !usedCss.has(a.css)) || (a.fn && !usedFn.has(a.fn)));
if (stale.length) bad(`放行名单里 ${stale.length} 行没被用到，删掉：${stale.map((a) => `${a.block} ${a.css || a.fn + '()'}`).join(' · ')}`);
else ok(`放行名单 ${ALLOW.length} 行都还在用`);

if (cssFiles === 0 || tsxFiles === 0) die(`读到的文件数不对（css ${cssFiles} · tsx ${tsxFiles}）`);
console.log(`\n共读 ${cssFiles} 份 CSS · ${tsxFiles} 份 TSX · ✅ ${pass} · ❌ ${fail}`);
process.exit(fail ? 1 : 0);
