#!/usr/bin/env node
/**
 * media-layout.test.js — #1536 做什么 1 / 3：块级 / 块头那张图的位置只有一份（`scripts/block-build/media-layout.js`）。
 *
 * 跑法:  node scripts/media-layout.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   ① 生成器：(A) 几何的算式、(B) 留作参数、manifest 写坏了当场抛错
 *   ② 覆盖：带【块级 / 块头】图位旋钮（image / blockImage / introImage / itemsImage，有 left / right）的块都声明了
 *      mediaLayout —— 从 manifest 现取，不写名单；今天是 6 个（content cta features hero milestones page-header）
 *   ③ 守卫（AC6）：块自己的 block.css / shape.css 里不许再写图位排版。谓词：
 *        门 = 选择器【第一段】（块根元素那一段）上挂着 data-image / data-block-image / data-intro-image / data-items-image
 *        挂了门的规则里出现下面任何一种 ⟹ 红：
 *          flex: 0 0 N%  ·  flex: 0 0 min(N%, …)  ·  flex-basis: N%  ·  width: N%（100% 除外）  ·  max-width: N%（声明的文字栏除外）
 *          以及作用在声明的「行」上的 flex-direction / gap
 *        条目层的门（`.bl-post[data-image]` 挂在条目上 · `[data-item-image]`）不是门，放行。
 *      🔴 「文字栏的 max-width: N%」放行，是因为 hero 那条 `[data-text-align="center"][data-image="top"] .hro-textcol
 *         { max-width: 80% }` 管的是居中时文字块多宽（#1486），不是图栏宽。
 *      阳性对照：四种写法各塞一条（门挂在块根上）各自当场红；阴性对照：同样四种挂在条目层的门上，不红。
 *   ④ Section.tsx：声明的「行」和「图」那两个元素不再带 Bootstrap 栅格类（row / col-* / g*-N / flex-*-reverse）
 *   ⑤ DOM 顺序（AC2）：6 个块每个位置渲染一次，文字在图前面；反向对照：把 content 的图挪回文字前面 ⟹ 红
 *
 * 几何本身（1440 下图 612、390 下图在上 / 在下、间距 2.5rem）要浏览器：交付说明里那份实测。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const BLOCKS = path.join(NEXT, 'blocks');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let ts; let React; let renderToStaticMarkup; let postcss; let gen;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
  postcss = require('postcss');
  gen = require('./block-build/media-layout.js');
} catch (e) { die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`); }

const blockNames = fs.readdirSync(BLOCKS, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(BLOCKS, d.name, 'manifest.json'))).map((d) => d.name).sort();
if (!blockNames.length) die('blocks/ 下一个块都没读到');
const MANIFESTS = Object.fromEntries(blockNames.map((b) => [b, JSON.parse(fs.readFileSync(path.join(BLOCKS, b, 'manifest.json'), 'utf8'))]));
const knobsOf = (m) => Object.values(m.slots || {}).flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : []));
const BLOCK_LEVEL = new Set(['image', 'blockImage', 'introImage', 'itemsImage']);

// ══ ① 生成器 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── ① 生成器');
{
  const css = gen.mediaLayoutCss(MANIFESTS.content, 'content');
  check(css.includes('flex: 0 0 calc((100% - 4rem) * 0.5)'), '(A) 图栏 = (行宽 − 4rem) × 0.5（1288 宽的行 ⟹ 612）');
  check(/\[data-image="left"\] \.co-outer,\n\[data-block="content"\]\[data-image="top"\] \.co-outer \{\n  flex-direction: column-reverse;/.test(css), '上下叠：left / top 列反向（DOM 里图在后、要摆到上面）');
  check(/gap: 2\.5rem/.test(css) && /gap: 4rem/.test(css), '上下叠隔 2.5rem、两栏栏距 4rem');
  check(gen.mediaLayoutCss(MANIFESTS.content, 'content', 'B').includes('flex: 0 0 50%'), '(B) 留在 GEOMETRY 里当参数：换一个取值 ⟹ 图 = 行宽 50%');
  check(gen.CHOSEN === 'A', '今天填的是 (A)（Chris 2026-10-03 拍板）');
  const throws = (m) => { try { gen.mediaLayoutCss(m, 'x'); return false; } catch (e) { return true; } };
  const base = { slots: { options: { knobs: [{ name: 'image', values: ['none', 'left', 'right'] }] } } };
  check(throws({ ...base, mediaLayout: [{ knob: 'nope', row: '.a', text: '.b', media: '.c' }] }), '写坏了当场抛错：旋钮不存在');
  check(throws({ ...base, mediaLayout: [{ knob: 'image', row: 'a', text: '.b', media: '.c' }] }), '写坏了当场抛错：不是 class');
  check(!throws({ ...base, mediaLayout: [{ knob: 'image', row: '.a', text: '.b', media: '.c' }] }), '对照：写对了不抛');
  check(gen.mediaLayoutCss({ slots: {} }, 'x') === '', '没声明 ⟹ 空串');
}

// ══ ② 覆盖 ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n── ② 带块级 / 块头图位旋钮的块都声明了 mediaLayout');
const DECL = {};
{
  const need = blockNames.filter((b) => knobsOf(MANIFESTS[b]).some((k) => BLOCK_LEVEL.has(k.name) && k.values.includes('left') && k.values.includes('right')));
  console.log(`  （现取：${need.join(' ')}）`);
  check(need.length === 6, `6 个块（${need.length}）`, need.join(' '));
  for (const b of need) {
    const want = knobsOf(MANIFESTS[b]).filter((k) => BLOCK_LEVEL.has(k.name) && k.values.includes('left')).map((k) => k.name).sort();
    const got = gen.mediaLayoutOf(MANIFESTS[b], b);
    DECL[b] = got;
    check(JSON.stringify(got.map((e) => e.knob).sort()) === JSON.stringify(want), `${b}：${want.join(' / ')} 都声明了`, `声明了 ${got.map((e) => e.knob).join(' / ') || '（无）'}`);
  }
  check(!knobsOf(MANIFESTS.blog || {}).some((k) => BLOCK_LEVEL.has(k.name)), 'blog 只有条目层的 itemImage，不在射程里');
}

// ══ ③ 守卫 ═════════════════════════════════════════════════════════════════════════════════════
const GATE = /\[(data-image|data-block-image|data-intro-image|data-items-image)\s*[=\]]/;
/** 选择器按后代 / 子 / 兄弟组合符切成几段（方括号里不切）。 */
function compounds(sel) {
  const out = []; let cur = ''; let depth = 0;
  for (const ch of sel.trim()) {
    if (ch === '[' || ch === '(') depth += 1;
    if (ch === ']' || ch === ')') depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const classesOf = (compound) => (compound.match(/\.[a-z][\w-]*/g) || []);
const pct = (v) => /\d%/.test(v);

/** 一份块 CSS → 违例清单（门挂在块根上的图位排版）。 */
function violations(block, css) {
  const decl = gen.mediaLayoutOf(MANIFESTS[block] || {}, block);
  const rows = new Set(decl.map((e) => e.row));
  const texts = new Set(decl.map((e) => e.text));
  const out = [];
  postcss.parse(css).walkRules((rule) => {
    for (const sel of rule.selectors) {
      const parts = compounds(sel);
      if (!parts.length || !parts[0].startsWith(`[data-block="${block}"]`) || !GATE.test(parts[0])) continue;
      const target = classesOf(parts[parts.length - 1]);
      rule.walkDecls((d) => {
        const p = d.prop.toLowerCase(); const v = d.value.trim();
        const hit = ((p === 'flex' || p === 'flex-basis') && pct(v))
          || (p === 'width' && pct(v) && v !== '100%')
          || (p === 'max-width' && pct(v) && !target.some((c) => texts.has(c)))
          || ((p === 'flex-direction' || /^(row-|column-)?gap$/.test(p)) && target.some((c) => rows.has(c)));
        if (hit) out.push(`${sel} { ${p}: ${v} }`);
      });
    }
  });
  return out;
}

console.log('\n── ③ 守卫：块自己的 CSS 里不许再写图位排版');
{
  let files = 0;
  for (const b of blockNames) {
    const dir = path.join(BLOCKS, b);
    const list = [path.join(dir, 'block.css'), ...fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name, 'shape.css'))].filter((f) => fs.existsSync(f));
    for (const f of list) {
      files += 1;
      const v = violations(b, fs.readFileSync(f, 'utf8'));
      if (v.length) bad(`${path.relative(NEXT, f)}：${v.length} 条\n      ${v.join('\n      ')}`);
    }
  }
  check(files > 17, `扫了 ${files} 份 block.css / shape.css，上面没有红行就是 0 条违例`);

  // 阳性对照：四种写法，门挂在块根上 —— 塞进 content 的 block.css（内存里，盘上不动）各自当场红。
  const real = fs.readFileSync(path.join(BLOCKS, 'content', 'block.css'), 'utf8');
  const FORMS = {
    'flex: 0 0 N%': 'flex: 0 0 45%;',
    'flex: 0 0 min(N%, Xrem)': 'flex: 0 0 min(40%, 20rem);',
    'flex: 0 0 auto + width: N%': 'flex: 0 0 auto; width: 45%;',
    'width: 100% + max-width: N%': 'width: 100%; max-width: 80%;',
  };
  for (const [name, body] of Object.entries(FORMS)) {
    const v = violations('content', `${real}\n[data-block="content"][data-image="right"] .co-img { ${body} }\n`);
    check(v.length === 1, `阳性对照：${name}（门挂在块根上）⟹ 红`, `读到 ${v.length} 条`);
  }
  check(violations('content', `${real}\n@media (min-width: 992px) { [data-block="content"][data-image="left"] .co-outer { flex-direction: row-reverse; } }\n`).length === 1,
    '阳性对照：@media 里给声明的「行」写方向 ⟹ 红');
  // 阴性对照：同样四种写法挂在条目层的门上 ⟹ 不红。
  for (const [name, body] of Object.entries(FORMS)) {
    const blog = violations('blog', `[data-block="blog"] .bl-post[data-image="left"] .bl-img { ${body} }\n`);
    const item = violations('features', `[data-block="features"][data-item-image="left"] .fx-img { ${body} }\n`);
    check(blog.length === 0 && item.length === 0, `阴性对照：${name} 挂在 .bl-post[data-image] / [data-item-image] 上 ⟹ 不红`, `${blog.length} / ${item.length}`);
  }
  check(violations('hero', '[data-block="hero"][data-text-align="center"][data-image="top"] .hro-textcol { width: 100%; max-width: 80%; }').length === 0,
    '阴性对照：hero 居中时文字块 80%（声明的文字栏，#1486）⟹ 不红');
}

// ══ ④ Section.tsx 不再带栅格类 ═══════════════════════════════════════════════════════════════════
console.log('\n── ④ 声明的「行」和「图」不带 Bootstrap 栅格类');
const GRID = /(^|\s)(row|col(-[a-z]+)?(-\d+)?|g[xy]?(-[a-z]+)?-\d+|flex(-[a-z]+)?-(row|column)(-reverse)?)(?=\s|$)/;
/** 源码里含这个 class 的每一个字符串字面量。 */
const literalsWith = (src, cls) => (src.match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) || []).filter((s) => new RegExp(`(^|[\\s"'\`])${cls}(?=[\\s"'\`])`).test(s));
function gridHits(src, decl) {
  const out = [];
  for (const e of decl) {
    for (const cls of [e.row, e.media].map((c) => c.slice(1))) {
      const lits = literalsWith(src, cls);
      if (!lits.length) out.push(`${cls}：源码里找不到`);
      for (const l of lits) if (GRID.test(l.slice(1, -1))) out.push(`${cls}：${l}`);
    }
  }
  return out;
}
for (const [b, decl] of Object.entries(DECL)) {
  const v = gridHits(fs.readFileSync(path.join(BLOCKS, b, 'Section.tsx'), 'utf8'), decl);
  check(!v.length, `${b}`, v.join(' · '));
}
{
  const src = fs.readFileSync(path.join(BLOCKS, 'hero', 'Section.tsx'), 'utf8').replace('className="hro-side"', 'className="col-12 col-lg-6 hro-side"');
  check(gridHits(src, DECL.hero).length === 1, '反向对照：hero 的图列加回 col-12 col-lg-6 ⟹ 红');
}

// ══ ⑤ DOM 顺序 ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n── ⑤ DOM 里文字在前、图在后（6 个块 × 每个位置）');
const STUB_DIR = path.join(__dirname, `.media-layout-stubs-${process.pid}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={defaultLocale:"en",locales:["en"],siteId:"t",leadApi:"",getServices:()=>[],'
    + 'pagesByLocale:{en:[]},localeUrl:(s)=>s==="home"?"/":"/"+s,brand:{},getForms:()=>[]};\n'),
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};
const load = (b, override) => {
  const f = path.join(BLOCKS, b, 'Section.tsx');
  delete require.cache[f];
  if (override) sourceOverride.set(f, override); else sourceOverride.delete(f);
  const C = require(f).default;
  sourceOverride.delete(f); delete require.cache[f];
  return C;
};
let DEMO;
try { DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT; } catch (e) { die(`演示内容包载入失败: ${e.message}`); }
const IMG = { imageUrl: 'https://example.com/pic.jpg', alt: 'pic' };
const indexOfClass = (html, cls) => { const m = new RegExp(`class="([^"]*\\s)?${cls}(\\s[^"]*)?"`).exec(html); return m ? m.index : -1; };
function order(b, C, e, pos) {
  const d = JSON.parse(JSON.stringify(DEMO[b] || {}));
  d[e.knob] = IMG;
  d.options = { ...(d.options || {}), [e.knob]: pos };
  if (b === 'milestones' && e.knob === 'introImage') d.options.introPosition = 'top';
  const html = renderToStaticMarkup(React.createElement(C, { data: d, locale: 'en', iconTable: {}, block: { id: `t-${b}`, type: b, data: {} } }));
  return { t: indexOfClass(html, e.text.slice(1)), m: indexOfClass(html, e.media.slice(1)) };
}
try {
  for (const [b, decl] of Object.entries(DECL)) {
    const C = load(b);
    for (const e of decl) {
      const bad1 = [];
      for (const pos of e.positions) {
        const r = order(b, C, e, pos);
        if (r.t < 0 || r.m < 0 || !(r.t < r.m)) bad1.push(`${pos}（文字 @${r.t} · 图 @${r.m}）`);
      }
      check(!bad1.length, `${b} ${e.knob}：${e.positions.join(' / ')} 都是文字在前`, bad1.join(' · '));
    }
  }
  // 反向对照：把 content 的图挪回文字前面 ⟹ 读出「图在前」。
  const f = path.join(BLOCKS, 'content', 'Section.tsx');
  const src = fs.readFileSync(f, 'utf8');
  const imgBlock = /\n(\s*)\{img \? \(\n\s*<div className="co-img"[\s\S]*?\) : null\}/.exec(src);
  if (!imgBlock) bad('content/Section.tsx 里找不到图那一段（反向对照的前提不成立）');
  else {
    const moved = src.replace(imgBlock[0], '').replace('<div className="co-outer">', `<div className="co-outer">${imgBlock[0]}`);
    const r = order('content', load('content', moved), DECL.content[0], 'right');
    check(r.m >= 0 && r.m < r.t, '反向对照：content 的图挪回文字前面 ⟹ 读出「图在前」');
  }
} catch (e) { die(`渲染失败: ${e.stack || e.message}`); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
