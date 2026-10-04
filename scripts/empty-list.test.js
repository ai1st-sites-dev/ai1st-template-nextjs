#!/usr/bin/env node
/**
 * empty-list.test.js — #1536 做什么 2 / AC4：块的主条目列表空了，整块画不画（`src/lib/sections/emptyList.ts`）。
 *
 * 跑法:  node scripts/empty-list.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 9 个块（faq features gallery logos milestones pricing reviews team testimonials），每块五格，演示内容包当底
 * （`scripts/lib/demo-content`），只换主条目那一槽：
 *   ②  引用写法展开出 0 条（`data._sourced.<槽> = '<源名>'` + 空数组）                 ⟹ 没有 section
 *   ③  写了 N 条、每条都是这个块会丢掉的（按 emptyList.ts 文件头那张「丢条目的条件」造） ⟹ 没有 section
 *   阳性对照：
 *   ①  手写 0 条（编辑器里新拖进来的块）                                                 ⟹ section 仍在
 *   ②+ 引用写法展开出 1 条                                                              ⟹ section 在
 *   ③+ N 条里有 1 条合格                                                                ⟹ section 在
 *
 * 🔴 ② 那一格对 features 以外的 8 个块【生产里走不到】：`scripts/lib/item-sources.js` 的 BLOCK_SLOTS 在这 9 个块里只登记了 features（另一个键是 footer，不在其中），
 *    别的块的数据上不会出现 `_sourced`。这里是手搓 `_sourced` 跑的 —— 它证的是「判空规矩只有一份、9 个块都调它」，
 *    不是「这 8 个块支持引用写法」。
 * 🔴 不许拿「喂空数组」当 ② 的测法：手写 0 条按设计必须照画（item-sources.test.js「手写 0 条」那一格、
 *    contact-render.test.js 那三格都钉着）—— 那就是上面的 ①。
 * 🔴 contact 不在这里：#1489 刻意让它 items 可关、空了照画（contact-render.test.js 钉着）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

let ts; let React; let renderToStaticMarkup;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
} catch (e) { die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`); }

// ── 让 node 能 require .tsx；Next 自己的、站点配置换成替身（跟被测那一维无关）─────────────────────────
// 替身放在 scripts/ 底下（不放 /tmp）：它们要 require('react')，得从这棵树的 node_modules 解析到（hero-render.test.js 同一做法）。
const STUB_DIR = path.join(__dirname, `.empty-list-stubs-${process.pid}`);
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

// 主条目槽 + 一条会被丢掉的 + 一条合格的（「丢条目的条件」照 #1536 做什么 2 那张表，各块 Section.tsx 主条目那一行现取）。
const BLOCKS = {
  faq: { slot: 'items', dropped: { answer: 'No question, so the block drops it.' }, kept: { question: 'Q?', answer: 'A.' } },
  features: { slot: 'items', dropped: 'not an object', kept: { title: 'Kept' } },
  gallery: { slot: 'items', dropped: { title: 'No picture', image: { alt: 'x' } }, kept: { image: { imageUrl: 'https://example.com/a.jpg', alt: '' } } },
  logos: { slot: 'items', dropped: { alt: 'No logo url' }, kept: { imageUrl: 'https://example.com/a.svg', alt: 'A' } },
  milestones: { slot: 'stats', dropped: 'not an object', kept: { value: '10', label: 'Years' } },
  pricing: { slot: 'plans', dropped: 'not an object', kept: { name: 'Basic', price: { monthly: '$9' } } },
  reviews: { slot: 'platforms', dropped: { source: '', rating: 4, count: 3 }, kept: { source: 'Google', rating: 4.8, count: 12 } },
  team: { slot: 'members', dropped: 'not an object', kept: { name: 'Sam' } },
  testimonials: { slot: 'items', dropped: { name: 'No quote' }, kept: { quote: 'Great.', name: 'Sam' } },
};

let DEMO; let lib; let icons;
const SECTIONS = {};
try {
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT;
  lib = require(path.join(SRC, 'lib', 'sections', 'emptyList.ts'));
  icons = require(path.join(NEXT, 'scripts', 'lib', 'icons.js'));
  for (const b of Object.keys(BLOCKS)) SECTIONS[b] = require(path.join(NEXT, 'blocks', b, 'Section.tsx')).default;
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

const clone = (v) => JSON.parse(JSON.stringify(v));
const render = (b, data, Comp = SECTIONS[b]) => renderToStaticMarkup(React.createElement(Comp, {
  data, locale: 'en', iconTable: icons.iconTableFor(b, DEMO[b], { warn: () => {} }), block: { id: `t-${b}`, type: b, data: {} },
}));
const hasSection = (html) => /<section\b/.test(html);
const withList = (b, list, sourced) => {
  const d = { ...clone(DEMO[b]), [BLOCKS[b].slot]: list };
  if (sourced) d._sourced = { [BLOCKS[b].slot]: 'services' };
  return d;
};

// ══ 判空函数本身：三个输入，①②③ 一处判完 ══════════════════════════════════════════════════════════
console.log('\n── emptyList.ts');
{
  const f = lib.emptyListHidesBlock;
  check(f([], 0, '') === false, '① 原始 0 条、不是引用 ⟹ 照画');
  check(f([], 0, 'services') === true, '② 引用展开 0 条 ⟹ 不画');
  check(f([{}, {}], 0, '') === true, '③ 原始 2 条、过滤后 0 条 ⟹ 不画');
  check(f([{}, {}], 1, '') === false && f([], 1, 'services') === false, '过滤后还剩 1 条 ⟹ 照画（引用与手写都是）');
  check(f(undefined, 0, '') === false, '槽根本没写 ⟹ 照画（跟手写 0 条同一类）');
  check(lib.sourcedOf({ _sourced: { items: 'pages' } }, 'items') === 'pages' && lib.sourcedOf({ _sourced: { items: 'pages' } }, 'stats') === ''
    && lib.sourcedOf({}, 'items') === '' && lib.sourcedOf(null, 'items') === '', 'sourcedOf 只认这一槽的标记');
}

// ══ 9 个块各五格 ═══════════════════════════════════════════════════════════════════════════════
for (const [b, c] of Object.entries(BLOCKS)) {
  console.log(`\n── ${b}（主条目槽 ${c.slot}）`);
  if (!DEMO[b] || !Array.isArray(DEMO[b][c.slot])) { bad(`演示内容包里没有 ${b}.${c.slot}`); continue; }
  check(hasSection(render(b, clone(DEMO[b]))), '演示内容原样 ⟹ section 在（夹具本身能画）');
  check(!hasSection(render(b, withList(b, [], true))), '② 引用展开出 0 条 ⟹ 没有 section（🔴 features 以外生产走不到，手搓 _sourced）');
  check(!hasSection(render(b, withList(b, [c.dropped, clone(c.dropped)]))), `③ 写了 2 条、都会被丢掉（${JSON.stringify(c.dropped).slice(0, 60)}）⟹ 没有 section`);
  check(hasSection(render(b, withList(b, []))), '阳性 ① 手写 0 条 ⟹ section 仍在（编辑器里新拖进来的块不消失）');
  check(hasSection(render(b, withList(b, [c.kept], true))), '阳性 ② 引用展开出 1 条 ⟹ section 在');
  check(hasSection(render(b, withList(b, [c.dropped, c.kept]))), '阳性 ③ 2 条里 1 条合格 ⟹ section 在');
}

// ══ 反向对照：把 reviews 那一行判空拿掉 ⟹ ③ 那一格红（#1504 那条空带回来）══════════════════════════════
console.log('\n── 反向对照：reviews 不调判空函数');
{
  const file = path.join(NEXT, 'blocks', 'reviews', 'Section.tsx');
  const src = fs.readFileSync(file, 'utf8');
  const line = /^\s*if \(emptyListHidesBlock\(d\.platforms, platforms\.length, sourcedOf\(d, 'platforms'\)\)\) return null;\n/m;
  if (!line.test(src)) bad('reviews/Section.tsx 里找不到那一行判空（这一格的前提不成立）');
  else {
    sourceOverride.set(file, src.replace(line, ''));
    delete require.cache[file];
    const Broken = require(file).default;
    sourceOverride.delete(file);
    delete require.cache[file];
    const html = render('reviews', withList('reviews', [BLOCKS.reviews.dropped]), Broken);
    check(hasSection(html), '拿掉判空 ⟹ 0 个合法平台时 section 又画出来了（上面 ③ 那一格真会红）');
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
