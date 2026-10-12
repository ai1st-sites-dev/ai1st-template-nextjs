#!/usr/bin/env node
/**
 * editor-design-content.test.js — #1735 验收 5：Design 面板 Content 页显示的字段，跟右栏里这一块的内容字段一一对应，
 * 15 种页面块各量一次，不多不少。
 *
 *   node scripts/editor-design-content.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 「右栏这一块的字段」= 编辑器 config 里这一块 `resolveFields` 的结果：Puck 的右栏画的就是它的全部键（Puck 产物 `@puckeditor/core/dist/index.js`
 *   里 `FieldsInternal` 那段的 `Object.keys(s.fields.fields)`）。「内容字段」= 它去掉另两页已经有的两个 —— 预设那一格（`control: 'options'` 且有预设：
 *   Layout 的格子 + Customize 的旋钮）和背景（`bg`）。期望在本文件里照这句话自己算，不调被测的函数。
 * 被测的是真的 Content 页组件（EditorApp.tsx §DesignContent）：渲染一次，数它画出来的 `data-editor-content-field`。
 *   Puck 换成替身：`usePuck` 交出真 config（`buildConfig` 造的那份），`AutoField` 记下它收到的字段 / 值 / onChange。
 * 量三种块：普通的（15 种）· 共用块（右栏顶上多一句 `_shared`）· 锁住的块（`_locked`），后两种 Content 页也要有。
 * 反向对照在本文件里自己跑：把源码在内存里改成多扔掉一个字段（headline）再渲染，断言 15 种全被点名（不改盘上的文件）。
 * 编译 / 替身的做法照 `contact-refs.test.js`（它也加载 EditorApp）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const APP = path.join(SRC, 'components', 'editor', 'EditorApp.tsx');

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
} catch (e) { die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`); }

const sourceOverride = new Map();
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, resolveJsonModule: true },
    fileName: filename,
  }).outputText, filename);
}

// 替身要能 require('react') ⟹ 放在模板树里（node_modules 按目录往上找），名字带 pid。
const STUB_DIR = path.join(__dirname, `.editor-design-content-stubs-${process.pid}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/components/ServiceIcon': stub('icon', "const React=require('react');const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;\n"),
  // AutoField 记下每一次收到的 props（globalThis.__AUTO__），画一个带字段类型的空元素。
  '@puckeditor/core': stub('puck', "const React=require('react');module.exports={Puck:()=>null,ActionBar:()=>null,"
    + "AutoField:(p)=>{(globalThis.__AUTO__=globalThis.__AUTO__||[]).push(p);return React.createElement('i',{'data-auto':p.field.type})},"
    + "FieldLabel:({label,children})=>React.createElement('div',{'data-label':label},children),"
    + 'createUsePuck:()=>(sel)=>sel(globalThis.__PUCK__),useGetPuck:()=>()=>({})};\n'),
  '@puckeditor/core/puck.css': stub('css', '\n'),
  '@/components/SiteShell': stub('shell', "const C=()=>null;module.exports=C;module.exports.default=C;\n"),
  './EditorChat': stub('chat', "const C=()=>null;module.exports=C;module.exports.default=C;\n"),
};
const SITE = {
  defaultLocale: 'en', locales: ['en'], siteId: 't', leadApi: '', brand: { locations: [], email: 'a@b.c' },
  servicesByLocale: { en: [] }, formsByLocale: { en: [] }, seoByLocale: { en: {} }, pagesByLocale: { en: [] },
  blogPostsByLocale: { en: [] },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@blocks/')) return origResolve.call(this, path.join(NEXT, 'blocks', req.slice(8)), ...rest);
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

let schema; let convert; let demo;
try {
  schema = require('./lib/editor-schema.js').editorSchema();
  convert = require('./lib/editor-convert.js');
  demo = require('./lib/demo-content');
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

// 15 种页面块：注册表（生成物）里的类型，不抄数。
const reg = fs.readFileSync(path.join(SRC, 'lib', 'sections', 'registry.generated.ts'), 'utf8');
const TYPES = [...reg.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]);
if (TYPES.length < 10) die(`从 registry.generated.ts 只抠出 ${TYPES.length} 个类型 —— 尺子坏了`);

function loadApp() {
  delete require.cache[APP];
  return require(APP);
}

/** 期望：右栏那一份（resolveFields 的键，顺序照旧），去掉预设那一格和背景。 */
function expected(comp, resolved) {
  const drop = new Set(comp.fields.filter((f) => (f.control === 'options' && (f.presets || []).length) || (f.slot === 'bg' && f.control === 'color')).map((f) => f.slot));
  return Object.keys(resolved).filter((k) => !drop.has(k));
}

/** 渲染一次 Content 页，返回 { shown: 画出来的字段，auto: AutoField 收到的那些，changes: 经 ui.changeDesign 交出去的 }。 */
function renderContent(App, cfg, comp, props) {
  globalThis.__PUCK__ = { config: cfg };
  globalThis.__AUTO__ = [];
  const changes = [];
  const ui = { changeDesign: (slot, v) => changes.push([slot, v]) };
  const html = renderToStaticMarkup(React.createElement(App.DesignContent, { component: comp, item: { type: comp.type, props }, ui, readOnly: {} }));
  const shown = [...html.matchAll(/data-editor-content-field="([^"]+)"/g)].map((m) => m[1]);
  return { shown, auto: globalThis.__AUTO__, changes };
}

function propsFor(comp, extraSrc) {
  const data = JSON.parse(JSON.stringify(demo.DEMO_CONTENT[comp.type] || {}));
  const view = { id: 'b1', type: comp.type, data };
  return { id: 'b1', ...convert.fieldProps(comp, data), _src: { at: 0, entry: view, locked: false, shared: null, sharedData: null, reason: '', view, weight: null, shape0: '', pid: 'b1', ...extraSrc } };
}

let App;
try { App = loadApp(); } catch (e) { die(`EditorApp 载入失败: ${e.stack || e.message}`); }
if (typeof App.DesignContent !== 'function') die('EditorApp 没有导出 DesignContent —— 被测的组件不在了');
const cfg = App.buildConfig(SITE, schema, 'en');

console.log(`\n── 15 种页面块（注册表现取 ${TYPES.length} 种）：Content 页 == 右栏去掉预设和背景`);
check(TYPES.length === 15, `注册表里的页面块类型 = ${TYPES.length}`, '票写的是 15 种');
for (const type of TYPES) {
  const comp = schema.components.find((c) => c.type === type);
  if (!comp) { bad(`${type}：编辑器 schema 里没有这一种`); continue; }
  const props = propsFor(comp);
  const resolved = cfg.components[type].resolveFields({ props }, {});
  const want = expected(comp, resolved);
  const { shown, auto } = renderContent(App, cfg, comp, props);
  check(JSON.stringify(shown) === JSON.stringify(want), `${type}：${shown.length} 个字段，跟右栏的内容字段一一对应`, `画出来 [${shown}] / 右栏去掉预设和背景 [${want}]`);
  // 不多：预设那一格和背景不在 Content 页；不少：右栏里每一个其余的字段都在。
  const dropped = Object.keys(resolved).filter((k) => !shown.includes(k));
  check(dropped.length === 2 && dropped.includes('options') && dropped.includes('bg'), `${type}：没画的恰好是 options + bg`, `[${dropped}]`);
  // 同一份字段定义：AutoField 收到的 field 对象就是 config 里那一份（不是另抄一份）。
  const same = auto.every((p, i) => p.field === resolved[shown[i]]);
  check(auto.length === shown.length && same, `${type}：每个字段交给 AutoField 的是 config 里同一个字段对象`);
}

console.log('\n── 改动交给 §changeDesign（不记历史、跟另两页一个事务）');
{
  const comp = schema.components.find((c) => c.type === 'reviews');
  const props = propsFor(comp);
  const { shown, auto, changes } = renderContent(App, cfg, comp, props);
  const i = shown.indexOf('headline');
  check(i >= 0 && auto[i].value === props.headline, `headline 那一格的值 = 这一块现在的 headline（${JSON.stringify(props.headline)}）`);
  if (i >= 0) auto[i].onChange('New headline');
  check(JSON.stringify(changes) === JSON.stringify([['headline', 'New headline']]), `改 headline ⟹ changeDesign('headline', …)`, JSON.stringify(changes));
}

console.log('\n── 共用块 / 锁住的块：右栏顶上那句话 Content 页也有');
{
  const comp = schema.components.find((c) => c.type === 'reviews');
  for (const [name, extra, key] of [['共用块', { shared: 'rv-shared', sharedData: {} }, '_shared'], ['锁住的块', { locked: true }, '_locked']]) {
    const props = propsFor(comp, extra);
    const resolved = cfg.components.reviews.resolveFields({ props }, {});
    const { shown } = renderContent(App, cfg, comp, props);
    check(shown[0] === key && JSON.stringify(shown) === JSON.stringify(expected(comp, resolved)), `${name}：第一项是 ${key}，其余跟右栏一一对应`, `[${shown}]`);
  }
}

console.log('\n── 反向对照：源码在内存里改成多扔掉 headline ⟹ 上面那条比对对 15 种全部点名');
{
  const src = fs.readFileSync(APP, 'utf8');
  const needle = 'slot !== preset?.slot && slot !== bg?.slot';
  if (!src.includes(needle)) die(`EditorApp 里找不到 \`${needle}\` —— 反向对照的改法要跟着改`);
  sourceOverride.set(APP, src.replace(needle, `${needle} && slot !== 'headline'`));
  let broken;
  try { broken = loadApp(); } finally { sourceOverride.delete(APP); }
  const bcfg = broken.buildConfig(SITE, schema, 'en');
  let caught = 0;
  for (const type of TYPES) {
    const comp = schema.components.find((c) => c.type === type);
    const props = propsFor(comp);
    const want = expected(comp, bcfg.components[type].resolveFields({ props }, {}));
    if (JSON.stringify(renderContent(broken, bcfg, comp, props).shown) !== JSON.stringify(want)) caught += 1;
  }
  check(caught === TYPES.length, `改坏的那份：${caught}/${TYPES.length} 种被点名`);
  loadApp(); // 还原：后面没有用例了，但别把改坏的那份留在 require 缓存里
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} 过 · ${fail} 败`);
process.exit(fail ? 1 : 0);
