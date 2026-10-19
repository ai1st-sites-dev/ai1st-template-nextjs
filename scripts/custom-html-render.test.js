#!/usr/bin/env node
/**
 * custom-html-render.test.js — #1833（SiteAsData T4a-1）：Custom HTML 块（`blocks/custom-html/Section.tsx`）的两条路。
 *
 *   ① 画布接线（票面那一格）：画布模式渲 `<img src=x onerror="document.title=1">` ⟹ 输出里没有 `onerror`；同一份发布模式渲 ⟹ 原样在。
 *      反向对照：源码在内存里把 `sanitizeForCanvas(html, …)` 换成 `html` ⟹ 画布输出里出现 `onerror`（这一格量得出没净化）。
 *   ①b 默认净化（#1833 r2，QA2 第 1 条）：**谁都没声明**（没有 `SiteRenderContext`、也没有 `EditorCanvasContext` —— #1874 只读画布
 *      `dashboard/src/canvas/CanvasApp.tsx` 就是这个形状）⟹ 走净化；声明了站、但又在画布里 ⟹ 也净化。
 *      反向对照：判据退回 r1 那种「不在画布里就原样」⟹ 没声明的那一跑出现 `onerror`。
 *   ② 卡片：原文含 `<script>` ⟹ 卡片（名字 + 「Runs on your preview link and your website」+ Open preview）**和**净化后剩下的 `hi`，
 *      输出里没有 `<script`；纯标记（表格）⟹ 照常画、不出卡片；`frozenFrom: "pricing"` ⟹「This was a Pricing block. It's kept as-is.」；
 *      没有预览地址 ⟹ 卡片不出 Open preview。
 *   ③ 发布：`<section data-block-id>` 里原样写 html；css 加 `[data-block-id="…"]` 前缀放在前面；css 里的 `</style` 收不了尾。
 *   ④ 整理过的 html（`lib/custom-html.js`）进发布页 ⟹ 下一个块的根元素是它的兄弟；没整理的原文 ⟹ 被吞成后代（反向对照）。
 *   ⑤ 源码守卫：Section.tsx 画布那一支的 `dangerouslySetInnerHTML` 只吃 `sanitizeForCanvas` 的输出；dashboard 的编辑器
 *      （`dashboard/src/editor/`）和模板那份编辑器里，代码框一处 `dangerouslySetInnerHTML` 都没有 —— 块的 html 在 dashboard 里
 *      只有画布那一条路能落成 DOM。
 *
 *   node scripts/custom-html-render.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
const die = (m) => { console.log(`💥 跑不起来: ${m}`); process.exit(2); };

const NEXT = path.resolve(__dirname, '..');
const REPO = path.resolve(NEXT, '..', '..');
const SRC = path.join(NEXT, 'src');
const SECTION = path.join(NEXT, 'blocks', 'custom-html', 'Section.tsx');
const CANVAS_CTX = path.join(SRC, 'lib', 'editor-canvas.ts');
const SITE_RENDER = path.join(SRC, 'components', 'SiteRender.tsx');

let ts; let React; let renderToStaticMarkup; let JSDOM; let tidyHtml;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
  ({ JSDOM } = require('jsdom'));
  ({ tidyHtml } = require('./lib/custom-html'));
} catch (e) {
  die(`加载不了依赖: ${e.message}`);
}

const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (typeof req === 'string' && req.startsWith('@template/')) return origResolve.call(this, path.join(SRC, req.slice(10)), ...rest);
  return origResolve.call(this, req, ...rest);
};

// 画布那一支的 DOMPurify 要一个 window（浏览器里就是画布 iframe 的那个）。
global.window = new JSDOM('<!doctype html><html><body></body></html>').window;

function loadSection(override) {
  delete require.cache[SECTION];
  if (override) sourceOverride.set(SECTION, override); else sourceOverride.delete(SECTION);
  try { return require(SECTION).default; } finally { sourceOverride.delete(SECTION); }
}
let Section; let ctx;
try {
  Section = loadSection();
  ctx = require(CANVAS_CTX);
} catch (e) {
  die(`Section.tsx 载入失败: ${e.stack || e.message}`);
}
if (typeof Section !== 'function' || !ctx.EditorCanvasContext || !ctx.EditorPreviewContext || !ctx.SiteRenderContext) die('Section.tsx 没有默认导出，或 editor-canvas.ts 没有那三个 context');

const PREVIEW = 'https://site-abc.preview.example/services';
// 发布模式 = 站的渲染入口那样包一层 SiteRender（`site: true`）；画布模式 = 编辑器画布的根那样给 EditorCanvasContext。
// `bare: true` = 两个都不给（#1874 只读画布的形状）。
function render(C, data, { canvas = false, preview = '', id = 'ch1', site = !canvas, bare = false } = {}) {
  const el = React.createElement(C, { data, block: { id, type: 'custom-html', data } });
  if (bare) return renderToStaticMarkup(el);
  return renderToStaticMarkup(React.createElement(ctx.SiteRenderContext.Provider, { value: site },
    React.createElement(ctx.EditorCanvasContext.Provider, { value: canvas },
      React.createElement(ctx.EditorPreviewContext.Provider, { value: preview }, el))));
}

console.log('① 画布接线：onerror 进画布前被净化，发布原样');
const ONERROR = '<img src=x onerror="document.title=1">';
const canvasOut = render(Section, { html: ONERROR }, { canvas: true });
const liveOut = render(Section, { html: ONERROR });
check(!/onerror/i.test(canvasOut), '画布模式：输出里没有 onerror', canvasOut);
check(/<img src=x onerror="document.title=1">/.test(liveOut), '发布模式：原样在', liveOut);
{
  const src = fs.readFileSync(SECTION, 'utf-8');
  const needle = 'sanitizeForCanvas(html, { scope })';
  if (!src.includes(needle)) die(`Section.tsx 里找不到 \`${needle}\` —— 反向对照的改法要跟着改`);
  const Broken = loadSection(src.replace(needle, 'html'));
  check(/onerror/i.test(render(Broken, { html: ONERROR }, { canvas: true })), '反向对照：不净化的那份 ⟹ 画布输出里出现 onerror（上一格量得出接线）');
}

console.log('①b 默认净化：没人声明「我是站」就不原样写');
{
  const bareOut = render(Section, { html: ONERROR }, { bare: true });
  check(!/onerror/i.test(bareOut) && /<img src="x">/.test(bareOut), '谁都没声明（只读画布的形状）⟹ 净化：没有 onerror', bareOut);
  const bothOut = render(Section, { html: ONERROR }, { canvas: true, site: true });
  check(!/onerror/i.test(bothOut), '声明了站、但又在编辑器画布里 ⟹ 画布赢：没有 onerror', bothOut);
  const src = fs.readFileSync(SECTION, 'utf-8');
  const needle = 'const asSite = site && !inCanvas;';
  if (!src.includes(needle)) die(`Section.tsx 里找不到 \`${needle}\` —— 反向对照的改法要跟着改`);
  const R1 = loadSection(src.replace(needle, 'const asSite = !inCanvas;'));
  check(/onerror/i.test(render(R1, { html: ONERROR }, { bare: true })), '反向对照：判据退回 r1（不在画布里就原样）⟹ 没声明的那一跑出现 onerror');
  // SiteRender 组件本身给的就是这个 context（站的入口用的是它，不是直接用 Provider）。
  const SiteRender = require(SITE_RENDER).default;
  const viaComponent = renderToStaticMarkup(React.createElement(SiteRender, null, React.createElement(Section, { data: { html: ONERROR }, block: { id: 'ch1', type: 'custom-html' } })));
  check(/<img src=x onerror="document.title=1">/.test(viaComponent), 'components/SiteRender.tsx 里面 ⟹ 原样（站的入口拿到的是站）', viaComponent);
}

console.log('② 卡片');
const scriptOut = render(Section, { html: "<script>document.body.dataset.ch='ran'</script><p>hi</p>", label: 'Test' }, { canvas: true, preview: PREVIEW });
check(/data-ch-card-label="">Test</.test(scriptOut), '卡片上有名字 Test', scriptOut);
check(scriptOut.includes('Runs on your preview link and your website'), '卡片上有那句话');
check(new RegExp(`<a[^>]*href="${PREVIEW.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"[^>]*data-ch-open-preview=""[^>]*>Open preview</a>`).test(scriptOut), 'Open preview 指向这一页的预览地址', scriptOut);
check(/<p>hi<\/p>/.test(scriptOut), '净化后剩下的 hi 也画出来（卡片 **和** 标记）');
check(!/<script/i.test(scriptOut), '输出里没有 <script');
const tableOut = render(Section, { html: '<table><tr><td>x</td></tr></table>' }, { canvas: true, preview: PREVIEW });
check(!/data-ch-card/.test(tableOut) && /<td>x<\/td>/.test(tableOut), '纯标记：照常画表格，不出卡片', tableOut);
const frozenOut = render(Section, { html: '<div class="old">kept</div>', frozenFrom: 'pricing' }, { canvas: true, preview: PREVIEW });
check(frozenOut.includes('This was a Pricing block. It&#x27;s kept as-is.') || frozenOut.includes("This was a Pricing block. It's kept as-is."), 'frozenFrom: "pricing" ⟹ This was a Pricing block. It\'s kept as-is.', frozenOut);
check(!/data-ch-open-preview/.test(render(Section, { html: '<script>x()</script>' }, { canvas: true })), '没有预览地址 ⟹ 卡片不出 Open preview');
check(/data-ch-open-preview/.test(render(Section, { html: '<iframe src="https://calendly.com/x"></iframe>' }, { canvas: true, preview: PREVIEW })), '<iframe> 也算「会跑的东西」⟹ 出卡片');

console.log('③ 发布：原样写 html，css 加前缀');
const pub = render(Section, { html: '<p class="lead">x</p>', css: 'p { color: red } p::after { content: "</style><script>alert(1)</script>" }' }, { id: 'blk-7' });
check(/^<section[^>]*data-block="custom-html"[^>]*data-block-id="blk-7"/.test(pub), '<section data-block="custom-html" data-block-id="blk-7">', pub.slice(0, 160));
check(pub.includes('[data-block-id="blk-7"] p { color: red }') && pub.indexOf('<style>') < pub.indexOf('<p class="lead">'), 'css 加了前缀、放在 html 前面', pub);
check(!/<\/style><script>/i.test(pub) && (pub.match(/<\/style>/g) || []).length === 1, 'css 里的 </style 收不了尾（只有我们自己那一个 </style>）', pub);

console.log('④ 整理过的 html 不吞后面的块');
// 「干净」= 下一个块是 <body> 下紧挨着它的兄弟，而且它自己的字没被续上前一块没收尾的 <b>。
const nextBlockOf = (html) => {
  const page = `${render(Section, { html })}<section data-block="next">n</section>`;
  const doc = new JSDOM(`<!doctype html><body>${page}</body>`).window.document;
  const next = doc.querySelector('[data-block="next"]');
  const sibling = !!next && next.parentElement === doc.body && next.previousElementSibling === doc.querySelector('[data-block="custom-html"]');
  return { sibling, bled: !!next && !!next.querySelector('b'), clean: sibling && !(next && next.querySelector('b')) };
};
const RAW = '<html><body><div><b>没闭合</body></html>';
const TABLE = '<table><tr><td>x';
check(nextBlockOf(tidyHtml(RAW)).clean, `票面那条，整理过（${tidyHtml(RAW)}）⟹ 下一个块是干净的兄弟`);
check(nextBlockOf(tidyHtml(TABLE)).clean, `没闭合的表格，整理过（${tidyHtml(TABLE)}）⟹ 下一个块是干净的兄弟`);
check(nextBlockOf(RAW).bled, '反向对照：票面那条原文 ⟹ 没收尾的 <b> 续进了下一个块（浏览器的活动格式元素重建）');
check(!nextBlockOf(TABLE).sibling, '反向对照：没闭合的表格原文 ⟹ 下一个块被吞成 <td> 的后代');

console.log('⑤ 源码守卫：html 在 dashboard 里只经 sanitizeForCanvas 落 DOM');
{
  const src = fs.readFileSync(SECTION, 'utf-8').replace(/^\s*\/\/.*$/gm, '');
  const canvasPart = src.slice(src.indexOf('const safeHtml'));
  const uses = [...canvasPart.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([A-Za-z_$][\w$]*)\s*\}\}/g)].map((m) => m[1]);
  check(/const safeHtml = sanitizeForCanvas\(/.test(src), 'Section.tsx：safeHtml 来自 sanitizeForCanvas');
  check(uses.length >= 1 && uses.every((u) => u === 'safeHtml'), `Section.tsx 画布那一支：dangerouslySetInnerHTML 只吃 safeHtml（读到 ${uses.join(', ') || '无'}）`);
  check((canvasPart.match(/dangerouslySetInnerHTML/g) || []).length === uses.length, '画布那一支没有别的写法的 dangerouslySetInnerHTML');
  const editors = [path.join(REPO, 'dashboard', 'src', 'editor'), path.join(SRC, 'components', 'editor')].filter((d) => fs.existsSync(d));
  check(editors.length === 2, `两份编辑器都在（${editors.length}/2）`);
  for (const d of editors) {
    const f = path.join(d, 'CodeField.tsx');
    const code = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').replace(/^\s*\/\/.*$/gm, '') : null;
    check(code !== null && !/dangerouslySetInnerHTML/.test(code), `${path.relative(REPO, f)}：代码框（着色层也是）不经 dangerouslySetInnerHTML`);
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
