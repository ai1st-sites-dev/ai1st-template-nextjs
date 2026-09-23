#!/usr/bin/env node
/**
 * editor-render.test.js — #1404 验收第 3 条的「例外只许一个」：编辑器画布上，哪些块画出来是空的。
 *
 *   node scripts/editor-render.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 「每份非 region manifest 都在编辑器里出现」有两半：组件清单里有它（`editor-roundtrip.test.js` ①），
 * 以及画布上真画得出来。后一半这里量：夹具页每一块走编辑器画布的同一条路（`pageToPuck` → 画布拿
 * `_src.view` → `SectionRenderer`）渲染一次，输出为空的块只许是 `service-related-pages`（站里没有
 * 它那个服务的子页就 `return null`，本文件的配置替身里一页都没有）。多一个就红，并点名。
 *
 * 🔴 单独一个文件、不并进 `editor-roundtrip.test.js`：这里要往 `require.extensions` 挂 tsx 编译、
 *    把 `@/lib/config` 等换成替身，那会改掉同进程里其他 require 的行为。
 * 🔴 反向对照在本文件里自己跑：把 `testimonials` 的组件源码在内存里换成 `return null` 再渲染一次，
 *    断言它被点名（不改盘上的文件，一次失败的跑不会把仓库留在改坏的状态）。
 * 编译 / 替身的做法照 `block-slots.test.js`（#1352）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let ts; let React; let renderToStaticMarkup;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
} catch (e) {
  die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`);
}

const sourceOverride = new Map();
function compile(filename) {
  const src = sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8');
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
}
for (const ext of ['.tsx', '.ts']) require.extensions[ext] = (mod, filename) => mod._compile(compile(filename), filename);

// 替身要能 require('react') ⟹ 放在模板树里（node_modules 按目录往上找），名字带 pid，跟并行跑的
// `block-slots.test.js`（它用 `.block-slots-stubs`）不撞。
const STUB_DIR = path.join(__dirname, `.editor-render-stubs-${process.pid}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/components/ServiceIcon': stub('icon', "const React=require('react');const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;\n"),
  // 🔴 `pagesByLocale` 一页都没有：`service-related-pages` 因此 return null —— 那正是验收第 3 条点名的
  //    唯一例外。给了子页，它就画得出来，这道检查就量不到「例外恰好是它」。
  '@/lib/config': stub('config', 'module.exports={getServices:()=>[],pagesByLocale:{en:[]},localeUrl:(s)=>"/"+s,'
    + 'siteId:"t",leadApi:"",getBlogPosts:()=>[],brand:{locations:[],email:"a@b.c"}};\n'),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  if (req.startsWith('@blocks/')) return origResolve.call(this, path.join(NEXT, 'blocks', req.slice(8)), ...rest);
  return origResolve.call(this, req, ...rest);
};

let editorSchema; let convert; let blocksLib; let manifestLib; let catalogLib; let editorPage;
try {
  ({ editorSchema } = require('./lib/editor-schema.js'));
  convert = require('./lib/editor-convert.js');
  blocksLib = require('./blocks.js');
  manifestLib = require('./lib/block-manifest.js');
  catalogLib = require('./lib/block-catalog.js');
  editorPage = require('./lib/editor-page.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

let schema;
try { schema = editorSchema(); } catch (e) { die(`算不出编辑器 schema：${e.message}`); }
const manifests = manifestLib.loadManifests();

const SECTION_RENDERER = path.join(SRC, 'components', 'SectionRenderer.tsx');
function freshRenderer() {
  // 每次都从头加载组件树：反向对照改了某个组件的源码之后，要让它真的被重新编译。
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(path.join(NEXT, 'blocks')) || k.startsWith(SRC)) delete require.cache[k];
  }
  return require(SECTION_RENDERER).default;
}

/** 夹具页（每个组件一块、全填满）按编辑器画布那条路渲染一遍，回输出为空的块类型（排过序）。 */
function emptyOnCanvas() {
  const raw = {
    slug: 'home',
    blocks: schema.components.map((c, i) => ({ id: `home-${c.type}-${i}`, type: c.type, data: catalogLib.sampleDataFor(manifests.get(c.type)) })),
  };
  const pages = [JSON.parse(JSON.stringify(raw))];
  blocksLib.normalizeLocalePages(pages, {}, 'en', () => {});
  const blocks = pages[0].blocks;
  const located = blocks.map((b) => editorPage.locateInRaw(raw, {}, 'home', b));
  const data = convert.pageToPuck({ raw, blocks, located, schema, weights: editorPage.effectiveWeights(raw, {}, blocks, located) });
  const SectionRenderer = freshRenderer();
  const empty = [];
  const errors = [];
  for (const item of data.content) {
    const view = item.props._src.view;
    let html = '';
    try {
      html = renderToStaticMarkup(React.createElement(SectionRenderer, { blocks: [{ ...view, shape: item.props._shape || undefined }], locale: 'en' }));
    } catch (e) {
      errors.push(`${view.type}: ${e.message}`);
      continue;
    }
    if (!html.trim()) empty.push(view.type);
  }
  return { empty: empty.sort(), errors, count: data.content.length };
}

const ALLOWED = ['service-related-pages'];

console.log('① 画布上画出来是空的块，只许是 service-related-pages');
{
  const r = emptyOnCanvas();
  check(r.errors.length === 0, `${r.count} 块都渲染得动（没有抛）`, r.errors.join(' / '));
  check(r.count === schema.components.length, `夹具页每个组件一块（${schema.components.length}）`, String(r.count));
  const extra = r.empty.filter((t) => !ALLOWED.includes(t));
  const missing = ALLOWED.filter((t) => !r.empty.includes(t));
  check(extra.length === 0, '没有别的块画出来是空的', `多出：${extra.join(' / ')}`);
  check(missing.length === 0, '例外恰好是 service-related-pages（它确实为空，这道检查量得到它）', `它竟然画出来了 —— 替身里给了子页？`);
}

console.log('② 反向：testimonials 的组件改成 return null → 被点名');
{
  const file = path.join(NEXT, 'blocks', 'testimonials', 'Section.tsx');
  const src = fs.readFileSync(file, 'utf-8');
  const broken = src.replace(/export default function (\w+)\(([^)]*)\)\s*\{/, 'export default function $1($2) { return null;');
  if (broken === src) die('没在 testimonials/Section.tsx 里找到 `export default function`（写法变了？）');
  sourceOverride.set(file, broken);
  const r = emptyOnCanvas();
  sourceOverride.delete(file);
  const extra = r.empty.filter((t) => !ALLOWED.includes(t));
  check(extra.length === 1 && extra[0] === 'testimonials', '多出的那一个被点名：testimonials', `多出：${extra.join(' / ') || '（无）'}`);
  const again = emptyOnCanvas().empty.filter((t) => !ALLOWED.includes(t));
  check(again.length === 0, '对照：换回原来的源码 → 又只剩那一个例外', again.join(' / '));
}

console.log(`\n${pass} 过 · ${fail} 败`);
process.exit(fail > 0 ? 1 : 0);
