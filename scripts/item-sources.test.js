#!/usr/bin/env node
/**
 * item-sources.test.js — #1505：features 的 `items` 接受引用写法（`{source: "services"}` / `{source: "pages", under}`），
 * 渲染前展开（`scripts/lib/item-sources.js`）。
 *
 * 跑法:  node scripts/item-sources.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   AC1  services 源：6 个服务、5 个有详情页 ⟹ 6 条，title / text 对得上，5 条带 link（href = localeUrl），1 条没有
 *   AC2  只改 services.json、页面 JSON 一个字节不动，重新构建 ⟹ 首页 features 的条目数和名字跟着变
 *        （真跑：skipAI 建站 → sync-config.js → 真 HomePage 服务端渲染，两次，子进程里跑，见 §realBuild）
 *   AC3  pages 源：water-heaters 下两页 ⟹ 2 条、不含 water-heaters 本身；under 下面没页 ⟹ 整块不渲染
 *   AC4  引用写法不截断（10 个服务 ⟹ 10 条）；手写 10 条 ⟹ 照旧报错、截到 8
 *   AC5  图标：同名的画出来、snowflake 按对照表画 snow、不认识的名字那一条没图标、其余照常
 *   AC6  同一组服务，手写与引用渲染出的 HTML 除 `data-items-source` 外逐字相同
 *   AC7  validateSite 的六种写法
 *   AC8  服务页上 features 引用 services、没有 services-list ⟹ 每个服务一段 "@type":"Service"；改回手写 ⟹ 没有（§realBuild）
 *   AC9  编辑器：引用写法往返无损；条目栏只读 + 提示；「改成手写」⟹ items 变成数组、== 当时的展开结果、之后不再跟着变
 *   AC10 编辑器画布（EditorApp 的画布组件本身）：普通块 / 共用块两支各量一份；反向对照：只在一支展开 ⟹ 另一支红
 *   AC11 提示词：features 的说明含 {"source": "services"} 与「do not copy the services in」；改站提示词讲 services.json 那段
 *        含「follow services.json automatically」那句（edit-site-prompt.test.js 另有一格）
 *   + 构建兜底：scripts/blocks.js §normalizeListSlots 不再把引用换成 []（反向对照：别的块的同形对象照旧换）
 *   + page-deps：引用了 services 的页面 sitemap 依赖 services.json；没有归不了属的 getServices
 *
 * 🔴 每一段带反向对照（同一进程、单变量），证明判据真会红。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const clone = (v) => JSON.parse(JSON.stringify(v));

let ts; let React; let renderToStaticMarkup;
try {
  ts = require('typescript');
  React = require('react');
  ({ renderToStaticMarkup } = require('react-dom/server'));
} catch (e) { die(`加载不起来（在 templates/nextjs 里跑 npm ci）：${e.message}`); }

const TEMP = [];
const temp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMP.push(d); return d; };

// ── 让 node 能 require .tsx；Next 自己的、编辑器外壳、站点配置换成替身 ─────────────────────────────────
// 🔴 `@/lib/config` 的服务目录 / 页面读 globalThis：每一段把要测的那份放进去（真站读 config-data.ts，§realBuild 量那一条）。
const STUB_DIR = path.join(__dirname, `.item-sources-stubs-${process.pid}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/components/ServiceIcon': stub('icon', "const React=require('react');const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;\n"),
  '@/lib/config': stub('config', 'module.exports={defaultLocale:"en",locales:["en"],siteId:"t",leadApi:"",'
    + 'getServices:()=>globalThis.__SVC__||[],get pagesByLocale(){return {en:globalThis.__PAGES__||[]};},'
    + 'localeUrl:(s)=>s==="home"?"/":"/"+s,getBlogPosts:()=>[],brand:{locations:[],email:"a@b.c"},getForms:()=>[]};\n'),
  '@puckeditor/core': stub('puck', "const React=require('react');module.exports={Puck:()=>null,"
    + "FieldLabel:({label,children})=>React.createElement('div',{'data-label':label},children),"
    + 'createUsePuck:()=>(sel)=>sel({selectedItem:null,dispatch(){},getSelectorForId(){}}),useGetPuck:()=>()=>({})};\n'),
  '@puckeditor/core/puck.css': stub('css', '\n'),
  '@/components/SiteShell': stub('shell', "const C=()=>null;module.exports=C;module.exports.default=C;\n"),
  './EditorChat': stub('chat', "const C=()=>null;module.exports=C;module.exports.default=C;\n"),
};
process.on('exit', () => {
  try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ }
  if (process.env.ITEM_SOURCES_KEEP !== '1') for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } }
});
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
  if (req.startsWith('@blocks/')) return origResolve.call(this, path.join(NEXT, 'blocks', req.slice(8)), ...rest);
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};

let lib; let manifestLib; let blocksLib; let icons; let convert; let editorSchema; let pageDeps; let Section; let SectionRenderer;
try {
  lib = require('./lib/item-sources.js');
  manifestLib = require('./lib/block-manifest.js');
  blocksLib = require('./blocks.js');
  icons = require('./lib/icons.js');
  convert = require('./lib/editor-convert.js');
  ({ editorSchema } = require('./lib/editor-schema.js'));
  pageDeps = require('./lib/page-deps.js');
  Section = require(path.join(NEXT, 'blocks', 'features', 'Section.tsx')).default;
  SectionRenderer = require(path.join(SRC, 'components', 'SectionRenderer.tsx')).default;
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

// ── 夹具：6 个服务、5 个有详情页（最后一个 tire-storage 没有）；water-heaters 下面两页 ───────────────────
const SERVICES = [
  { id: 'brakes', name: 'Brake repair', shortDescription: 'Pads and rotors.', icon: 'shield-check' },
  { id: 'diagnostics', name: 'Diagnostics', shortDescription: 'Warning lights traced.', icon: 'thermometer' },
  { id: 'tires', name: 'Tires', shortDescription: 'Winter changeover.', icon: 'snowflake' },
  { id: 'water-heaters', name: 'Water heaters', shortDescription: 'Tank and tankless.', icon: 'droplet' },
  { id: 'ac', name: 'Air conditioning', shortDescription: 'Recharge and repair.', icon: 'sun' },
  { id: 'tire-storage', name: 'Tire storage', shortDescription: 'Stored until spring.', icon: 'no-such-icon-1505' },
];
const PAGES = [
  { slug: 'home', title: 'Home', description: '' },
  ...SERVICES.slice(0, 5).map((s) => ({ slug: `services/${s.id}`, title: s.name, description: '' })),
  { slug: 'water-heaters', title: 'Water heaters', description: 'All water heaters' },
  { slug: 'water-heaters/burnaby', title: 'Water heaters in Burnaby', description: 'Same-day installs in Burnaby.' },
  { slug: 'water-heaters/coquitlam', title: 'Water heaters in Coquitlam', description: 'Coquitlam repairs and replacements.' },
];
const URL = (slug) => (slug === 'home' ? '/' : `/${slug}`);
const CTX = { services: SERVICES, pages: PAGES, url: URL, learnMore: 'Learn More' };
const HEAD = { headline: 'What we fix', body: 'Body.' };
const block = (items, extra = {}) => ({ id: 'fx', type: 'features', shape: 'grid', data: { ...HEAD, items, ...extra } });
const silent = { warn: () => {} };
const render = (b) => {
  const [r] = lib.resolveItemSources([b], CTX);
  const [table] = icons.iconTablesFor([r], silent);
  return renderToStaticMarkup(React.createElement(Section, { data: r.data, block: r, iconTable: table }));
};
const titles = (html) => [...html.matchAll(/data-slot="items\.\d+\.title">([^<]*)</g)].map((m) => m[1]);

// ══ AC1 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('── AC1 services 源');
{
  const items = lib.expandRef({ source: 'services' }, CTX);
  check(items.length === 6, `展开成 6 条（${items.length}）`);
  check(items.every((it, i) => it.title === SERVICES[i].name && it.text === SERVICES[i].shortDescription), 'title / text 依次 == 各服务的 name / shortDescription（顺序同 services.json）');
  const linked = items.filter((it) => it.link);
  check(linked.length === 5 && linked.every((it, i) => it.link.href === URL(`services/${SERVICES[i].id}`) && it.link.label === 'Learn More' && it.link.style === 'link' && it.link.arrow === true),
    '5 条带 link（href == localeUrl(services/<id>)、label = Learn More、style link、arrow）', JSON.stringify(linked.map((x) => x.link)));
  check(!items[5].link, '没有详情页的那一个（tire-storage）不带 link');
  // 反向对照：拿掉那几页详情页 ⟹ 一条 link 都没有（证明 link 跟着「这一页存在」走，不是无条件带）。
  check(lib.expandRef({ source: 'services' }, { ...CTX, pages: [] }).every((it) => !it.link), '反向对照：站里没有详情页 ⟹ 6 条都不带 link');
  const [r] = lib.resolveItemSources([block({ source: 'services' })], CTX);
  check(r.data._sourced && r.data._sourced.items === 'services', '展开过的块带标记 data._sourced.items = "services"');
  const plain = [block([{ title: 'a', text: 'b' }])];
  check(lib.resolveItemSources(plain, CTX) === plain, '没有引用的一页原样返回同一个数组（老页面逐字节不变）');
}

// ══ AC3 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC3 pages 源');
{
  const items = lib.expandRef({ source: 'pages', under: 'water-heaters' }, CTX);
  check(items.length === 2, `under water-heaters ⟹ 2 条（${items.map((x) => x.title).join(' / ')}）`);
  check(items[0].title === 'Water heaters in Burnaby' && items[0].text === 'Same-day installs in Burnaby.' && items[1].title === 'Water heaters in Coquitlam',
    'title / text == 页面的 title / description，顺序同 pagesByLocale');
  check(items.map((x) => x.link.href).join(',') === '/water-heaters/burnaby,/water-heaters/coquitlam', 'href 指向那两页');
  check(!items.some((x) => x.title === 'Water heaters'), 'water-heaters 这一页本身不在里面');
  check(items.every((x) => !('icon' in x)), '不带 icon');
  // #1550 —— 关键词页页尾那组兄弟页：正在画的那一页（ctx.pageSlug）不列它自己。
  const sib = lib.expandRef({ source: 'pages', under: 'water-heaters' }, { ...CTX, pageSlug: 'water-heaters/burnaby' });
  check(sib.map((x) => x.link.href).join(',') === '/water-heaters/coquitlam', `ctx.pageSlug = 自己 ⟹ 只剩兄弟页（${sib.map((x) => x.link.href).join(',')}）`);
  // #1630 —— withParent：最前面多一条指向 under 那一页本身；那一页不存在 ⟹ 不出这一条。
  const wp = lib.expandRef({ source: 'pages', under: 'water-heaters', withParent: true }, { ...CTX, pageSlug: 'water-heaters/burnaby' });
  check(wp.map((x) => x.link.href).join(',') === '/water-heaters,/water-heaters/coquitlam', `withParent ⟹ 父页在最前、再是兄弟页（${wp.map((x) => x.link.href).join(',')}）`);
  const wpNone = lib.expandRef({ source: 'pages', under: 'no-such-service', withParent: true }, CTX);
  check(wpNone.length === 0, `withParent 但 under 那一页不存在 ⟹ 不出父页那条（${wpNone.length}）`);
  const empty = render(block({ source: 'pages', under: 'no-such-service' }));
  check(empty === '', 'under 下面没有页面 ⟹ 整块不渲染（HTML 里没有这个 section）', empty.slice(0, 80));
  check(/<section\b/.test(render(block({ source: 'pages', under: 'water-heaters' }))), '阳性对照：同一个块 under water-heaters ⟹ 有 section');
  check(/<section\b/.test(renderToStaticMarkup(React.createElement(Section, { data: { ...HEAD, items: [] }, block: block([]) }))),
    '手写 0 条（编辑器里新拖进来的块）照旧画块头，不消失 —— 0 条不画只对引用写法');
}

// ══ AC4 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC4 引用写法不截断');
{
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Service ${i}`, shortDescription: `d${i}`, icon: 'tools' }));
  const [r] = lib.resolveItemSources([block({ source: 'services' })], { ...CTX, services: ten });
  const html = renderToStaticMarkup(React.createElement(Section, { data: r.data, block: r }));
  check(titles(html).length === 10, `服务目录 10 个 ⟹ 渲染 10 条（${titles(html).length}）`);
  const hand = ten.map((s) => ({ title: s.name, text: s.shortDescription }));
  const htmlHand = renderToStaticMarkup(React.createElement(Section, { data: { ...HEAD, items: hand }, block: block(hand) }));
  check(titles(htmlHand).length === 8, `手写 10 条 ⟹ 照旧截到 8（${titles(htmlHand).length}）`);
  const probs = manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [block(hand)] }], scope: 'edit' }).problems;
  check(probs.some((p) => /"items" 最多只能有 8 项/.test(p)), '手写 10 条 ⟹ validateSite 照旧报「最多只能有 8 项」', probs.join(' | '));
}

// ══ AC5 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC5 图标');
{
  const [r] = lib.resolveItemSources([block({ source: 'services' })], CTX);
  const warned = [];
  const [table] = icons.iconTablesFor([r], { warn: (m) => warned.push(m) });
  check(!!table.thermometer && !!table['shield-check'], 'thermometer / shield-check 这类同名的进了图标表');
  check(!!table.snow && !table.snowflake, 'snowflake 按对照表换成 snow（snow.svg 查得到，snowflake 本身不查）');
  check(!table['no-such-icon-1505'] && warned.some((w) => /no-such-icon-1505/.test(w)), '不认识的名字不进表、打一行日志（不报错）');
  const html = renderToStaticMarkup(React.createElement(Section, { data: r.data, block: r, iconTable: table }));
  const parts = html.split('data-part="item"').slice(1);
  check(parts.length === 6 && parts.slice(0, 5).every((p) => /data-part="icon"/.test(p.split('data-part="item"')[0])), '前 5 条都画出了图标（含 snowflake → snow 那一条）');
  check(!/data-part="icon"/.test(parts[5]), '不认识的那一条没有图标节点、其余照常');
  check(lib.SERVICE_ICON_ALIASES.shovel === 'tools' && fs.existsSync(path.join(icons.ICON_DIR, 'tools.svg')) && !fs.existsSync(path.join(icons.ICON_DIR, 'shovel.svg')),
    'shovel → tools（1.13.1 里没有 shovel.svg，tools.svg 在）');
}

// ══ AC6 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC6 渲染一致');
{
  const sourced = render(block({ source: 'services' }));
  const hand = render(block(lib.expandRef({ source: 'services' }, CTX)));
  check(sourced.includes('data-items-source="services"') && !hand.includes('data-items-source'), '引用那一份带 data-items-source="services"，手写那一份没有');
  check(sourced.replace(' data-items-source="services"', '') === hand, '去掉那个属性之后两份 HTML 逐字相同', `${sourced.length} vs ${hand.length}`);
  const handOff = render(block(lib.expandRef({ source: 'services' }, CTX).map((it, i) => (i === 2 ? { ...it, title: 'X' } : it))));
  check(sourced.replace(' data-items-source="services"', '') !== handOff, '反向对照：手写那份改一个字 ⟹ 判据读出不同');
}

// ══ AC7 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 validateSite');
{
  const v = (items) => manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [block(items)] }], scope: 'edit' }).problems.filter((p) => /"items"/.test(p));
  for (const [items, label] of [
    [{ source: 'reviews' }, '{source:"reviews"}'],
    [{ source: 'pages' }, '{source:"pages"}（缺 under）'],
    [{ source: 'services', foo: 1 }, '{source:"services", foo:1}'],
    ['services', '"services"（字符串）'],
    [{ source: 'pages', under: 'water-heaters', withParent: 'yes' }, '{source:"pages", under, withParent:"yes"}（#1630：只能是布尔）'],
    [{ source: 'services', withParent: true }, '{source:"services", withParent:true}（#1630：只有 pages 认它）'],
  ]) {
    const p = v(items);
    check(p.length === 1, `${label} ⟹ 报一条（点名 items）`, p.join(' | ') || '0 条');
  }
  check(v({ source: 'services' }).length === 0, '{source:"services"} 放行');
  check(v({ source: 'pages', under: 'water-heaters' }).length === 0, '{source:"pages", under:"water-heaters"} 放行');
  check(v({ source: 'pages', under: 'water-heaters', withParent: true }).length === 0, '#1630 {source:"pages", under, withParent:true} 放行');
  // 反向对照：别的块（不在登记表里）写同一个对象 ⟹ 照旧按「不是列表」拦。
  const other = manifestLib.validateSite({ pages: [{ slug: 'p', blocks: [{ type: 'testimonials', data: { headline: 'H', items: { source: 'services' } } }] }], scope: 'edit' }).problems;
  check(other.some((p) => /不是列表/.test(p)), '反向对照：没登记的块（testimonials）写 {source:"services"} ⟹ 照旧报「不是列表」', other.join(' | '));
}

// ══ 构建兜底：blocks.js §normalizeListSlots ═══════════════════════════════════════════════════════
console.log('\n── 构建兜底（blocks.js）不抹掉引用');
{
  const pages = [{ slug: 'home', blocks: [block({ source: 'services' }), { id: 't', type: 'testimonials', data: { headline: 'H', items: { source: 'services' } } }] }];
  blocksLib.normalizeLocalePages(pages, {}, 'en', () => {});
  const fx = pages[0].blocks.find((b) => b.type === 'features');
  const tm = pages[0].blocks.find((b) => b.type === 'testimonials');
  check(fx && JSON.stringify(fx.data.items) === '{"source":"services"}', 'features 的 items 引用活到构建之后（没被换成 []）', fx && JSON.stringify(fx.data.items));
  check(tm && Array.isArray(tm.data.items) && tm.data.items.length === 0, '反向对照：没登记的块同一个对象照旧换成 []', tm && JSON.stringify(tm.data.items));
}

// ══ AC11 提示词 ═════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC11 提示词');
{
  const m = manifestLib.loadManifests().get('features');
  const entry = manifestLib.promptEntry(m);
  check(entry.includes('{"source": "services"}') && entry.includes('do not copy the services in'), 'features 的说明含 {"source": "services"} 与「do not copy the services in」');
  check(entry.includes('{"source": "pages", "under":'), '也写了 pages 那一种');
  check(/items: \[\{[^\n]*\}\] \| \{source: "services"\} \| \{source: "pages", under: "services\/<service id>"\}/.test(entry), 'data 行里 items 的 shape 后面接上两种引用写法（从登记表拼）', entry.split('\n').find((l) => l.includes('data:')));
  check(manifestLib.promptEntry(manifestLib.loadManifests().get('testimonials')).indexOf('{source:') === -1, '反向对照：没登记的块（testimonials）的 data 行不带引用写法');
  const editSrc = fs.readFileSync(path.join(__dirname, 'edit-site.js'), 'utf-8');
  const at = editSrc.indexOf('- **services.json** —');
  check(at > 0 && /items: \{"source": "services"\} follow services\.json automatically/.test(editSrc.slice(at, at + 600)), '改站提示词讲 services.json 那段含「items: {"source": "services"} follow services.json automatically」');
}

// ══ page-deps ══════════════════════════════════════════════════════════════════════════════════
console.log('\n── page-deps：引用了服务目录的页面，sitemap 依赖 services.json');
{
  const r = pageDeps.blockTypesReadingServices(NEXT);
  check(r.unavailable === null && r.unaccounted.length === 0 && r.unmapped.length === 0, `没有归不了属的 getServices（unaccounted ${JSON.stringify(r.unaccounted)}）`);
  const deps = pageDeps.createPageDeps({ localeDir: '/tmp/x', services: r });
  const uses = (items) => deps.filesFor({ slug: 'about', blocks: [block(items)] }, '/tmp/x/pages/about.json', []).usesServices;
  check(uses({ source: 'services' }) === true, 'about 页上 features 引用 services ⟹ 依赖 services.json');
  check(uses([{ title: 'a', text: 'b' }]) === false, '反向对照：同一页改成手写 ⟹ 不依赖');
  check(uses({ source: 'pages', under: 'x' }) === false, 'pages 源不读服务目录 ⟹ 不依赖 services.json');
  // #1550 / #1630 —— 关键词页挂在 `services/<id>/<词>` 下：页尾那组第一条链回服务详情页、文字是服务名 ⟹ 依赖 services.json；
  //    它也不是服务详情页（以前 `startsWith('services/')` 会把它当成详情页）。
  const kwDeps = (slug) => deps.filesFor({ slug, blocks: [] }, `/tmp/x/pages/${slug}.json`, []).usesServices;
  check(kwDeps('services/drain/clogged') === true, '关键词页 services/<id>/<词> ⟹ 依赖 services.json（页尾父页那条的服务名）');
  check(kwDeps('drain/clogged') === false, '反向对照：老形状 <服务slug>/<词> 不读服务目录 ⟹ 不依赖');
  check(pageDeps.isServiceDetailPage({ slug: 'services/drain' }) === true, 'services/<id> 是服务详情页');
  check(pageDeps.isServiceDetailPage({ slug: 'services/drain/clogged' }) === false, 'services/<id>/<词> 不是服务详情页（是挂在它下面的关键词页）');
}

// ══ AC9 / AC10 编辑器 ═════════════════════════════════════════════════════════════════════════════
console.log('\n── AC9 编辑器：往返无损 · 只读提示 · 改成手写');
let EditorApp; let schema; let comp;
try {
  EditorApp = require(path.join(SRC, 'components', 'editor', 'EditorApp.tsx'));
  schema = editorSchema();
  comp = schema.components.find((c) => c.type === 'features');
} catch (e) { die(`编辑器载入失败: ${e.stack || e.message}`); }
globalThis.__SVC__ = SERVICES;
globalThis.__PAGES__ = PAGES;
const itemsField = comp.fields.find((f) => f.slot === 'items');
{
  const ref = { source: 'services' };
  const props = convert.fieldProps(comp, { ...HEAD, items: ref });
  check(JSON.stringify(props.items) === JSON.stringify(ref), 'fieldProps：引用写法整份带进 Puck（不是 []）');
  const back = convert.dataFromProps(comp, { ...HEAD, items: ref }, props);
  check(JSON.stringify(back.items) === JSON.stringify(ref), 'dataFromProps：没动它 ⟹ 存盘原样写回那个引用');
  const cfg = EditorApp.buildConfig(schema, 'en');
  const fields = cfg.components['features'].resolveFields({ props: { id: 'fx', ...props } });
  const f = fields.items;
  check(f && f.type === 'custom', '条目那一栏换成自定义的只读栏', f && f.type);
  check(cfg.components['features'].resolveFields({ props: { id: 'fx', ...convert.fieldProps(comp, { ...HEAD, items: [{ title: 'a' }] }) } }).items.type === 'array',
    '反向对照：手写的块那一栏仍是普通列表');
  let changed;
  const el = f.render({ value: ref, onChange: (v) => { changed = v; }, readOnly: false });
  const html = renderToStaticMarkup(el);
  check(/data-editor-sourced-note[^>]*>These items come from this website(&#x27;|')s services\. Change them there\./.test(html), '有那一行提示：条目来自本站的服务，去那里改', html.slice(0, 200));
  const btn = (function find(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const x = find(n); if (x) return x; } return null; }
    if (node.type === 'button') return node;
    return find(node.props && node.props.children);
  })(el);
  check(!!btn && /Write these items by hand/.test(renderToStaticMarkup(btn)), '有「Write these items by hand」按钮');
  btn.props.onClick();
  const expanded = lib.expandRef(ref, { services: SERVICES, pages: PAGES, url: URL, learnMore: 'Learn More' });
  check(Array.isArray(changed) && JSON.stringify(changed) === JSON.stringify(expanded), '点了 ⟹ items 变成数组、内容 == 当时的展开结果', JSON.stringify(changed).slice(0, 120));
  const saved = convert.dataFromProps(comp, { ...HEAD, items: ref }, { ...props, items: convert.fieldProps(comp, { items: changed }).items });
  check(Array.isArray(saved.items) && saved.items.length === 6, '存盘写进页面 JSON 的是 6 条的数组');
  const later = lib.resolveItemSources([block(saved.items)], { ...CTX, services: SERVICES.slice(0, 2) })[0];
  check(later.data.items.length === 6 && !later.data._sourced, '之后再改 services.json（只剩 2 个服务）⟹ 它不再跟着变（仍是 6 条）');
  const ro = renderToStaticMarkup(f.render({ value: ref, onChange: () => {}, readOnly: true }));
  check(!/data-editor-sourced-manual/.test(ro), '锁住的块（readOnly）不给「改成手写」');
}

console.log('\n── AC10 编辑器画布：普通块 / 共用块两支');
const EDITOR_APP = path.join(SRC, 'components', 'editor', 'EditorApp.tsx');
function canvasTitles(App) {
  const cfg = App.buildConfig(schema, 'en');
  const view = { id: 'fx', type: 'features', shape: 'grid', data: { ...HEAD, items: { source: 'services' } } };
  const props = { id: 'fx', ...convert.fieldProps(comp, view.data), _shape: '' };
  const normal = { ...props, _src: { at: 0, entry: clone(view), locked: false, shared: null, sharedData: null, reason: '', view: clone(view), weight: null, shape0: 'grid', pid: 'fx' } };
  const shared = { ...props, _src: { at: 0, entry: null, locked: false, shared: 'fx', sharedData: clone(view.data), reason: 'shared', view: clone(view), weight: null, shape0: 'grid', pid: 'fx' } };
  const r = (p) => titles(renderToStaticMarkup(cfg.components['features'].render(p)));
  return { normal: r(normal), shared: r(shared) };
}
{
  const want = lib.expandRef({ source: 'services' }, CTX).map((x) => x.title);
  const got = canvasTitles(EditorApp);
  check(JSON.stringify(got.normal) === JSON.stringify(want), `普通块：画布上 ${got.normal.length} 条、标题 == 展开结果`, JSON.stringify(got.normal));
  check(JSON.stringify(got.shared) === JSON.stringify(want), `共用块（_src.shared）：画布上 ${got.shared.length} 条、标题 == 展开结果`, JSON.stringify(got.shared));
  // 反向对照：只在普通那一支展开（共用块那一支照旧拿没展开的 block）⟹ 共用那一格红。
  const src = fs.readFileSync(EDITOR_APP, 'utf-8');
  const mutated = src.replace('<SectionRenderer blocks={[shown]} locale={locale} pageSlug={pageSlug} />\n      </div>', '<SectionRenderer blocks={[block]} locale={locale} pageSlug={pageSlug} />\n      </div>');
  if (mutated === src) bad('反向对照没改到 EditorApp.tsx（锚点找不到）—— 这一格什么都没证明');
  else {
    for (const k of Object.keys(require.cache)) if (k.startsWith(SRC) || k.startsWith(path.join(NEXT, 'blocks'))) delete require.cache[k];
    sourceOverride.set(EDITOR_APP, mutated);
    const m = canvasTitles(require(EDITOR_APP));
    sourceOverride.delete(EDITOR_APP);
    check(JSON.stringify(m.normal) === JSON.stringify(want) && JSON.stringify(m.shared) !== JSON.stringify(want),
      `反向对照：只展开普通那一支 ⟹ 普通照对（${m.normal.length} 条）、共用那一格读出不同（${m.shared.length} 条）`);
  }
}

// ══ AC2 / AC8：真跑一次 skipAI 建站 + sync-config + 服务端渲染 ════════════════════════════════════
console.log('\n── AC2 只改 services.json 跟着变 · AC8 服务结构化数据（真跑 create-site.js skipAI + sync-config.js + HomePage / SubPage）');
{
  const work = path.join(temp('item-sources-tree-'), 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  for (const d of fs.readdirSync(path.join(work, 'scripts'))) if (d.startsWith('.') && d.includes('stubs')) fs.rmSync(path.join(work, 'scripts', d), { recursive: true, force: true });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const payload = JSON.stringify({ siteId: 'itemsrc1', siteUrl: 'https://itemsrc1.example.com', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' });
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: payload, cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const loc = path.join(work, 'site', 'en');
  if (!fs.existsSync(path.join(loc, 'seo.json'))) die(`skipAI 建站没立起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);

  const svcPath = path.join(loc, 'services.json');
  const built = JSON.parse(fs.readFileSync(svcPath, 'utf-8'));
  if (!Array.isArray(built) || !built.length) die(`skipAI 站的 services.json 是空的（${typeof built}）`);
  // skipAI 只建一个服务。按站里那一条的形状（真 services.json 的全部字段）造 4 个，作为「第一次构建」的底。
  const base = ['Brake repair', 'Diagnostics', 'Tires', 'Air conditioning'].map((name, i) => ({
    ...clone(built[0]), id: `svc-${i}`, name, shortDescription: `${name} short.`,
  }));
  fs.writeFileSync(svcPath, JSON.stringify(base, null, 2));
  const fx = (items) => ({ id: 'fx-src', type: 'features', shape: 'grid', role: 'essential', region: 'content', weight: 10, data: { headline: 'What we fix', items } });
  const writePage = (slug, blocks) => {
    const file = path.join(loc, 'pages', `${slug}.json`);
    const page = JSON.parse(fs.readFileSync(file, 'utf-8'));
    page.blocks = blocks;
    fs.writeFileSync(file, JSON.stringify(page, null, 2));
    return file;
  };
  const homeFile = writePage('home', [fx({ source: 'services' })]);
  if (!fs.existsSync(path.join(loc, 'pages', 'services.json'))) die('skipAI 站没有 services 这一页');
  writePage('services', [fx({ source: 'services' })]);

  // 渲染器：子进程里加载这棵树的真 config（sync-config 刚写的 config-data.ts），渲染 HomePage 和 /services 那一页。
  const renderer = path.join(work, 'scripts', '.item-sources-render.js');
  fs.writeFileSync(renderer, `
const fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const NEXT=${JSON.stringify(work)},SRC=path.join(NEXT,'src');
const S=path.join(NEXT,'scripts','.item-sources-render-stubs');fs.mkdirSync(S,{recursive:true});
const st=(n,b)=>{const p=path.join(S,n+'.js');fs.writeFileSync(p,b);return p;};
const STUBS={'next/link':st('link',"const React=require('react');const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;"),
 'next/navigation':st('nav',"module.exports={notFound(){throw new Error('notFound')},redirect(u){throw new Error('redirect '+u)},usePathname:()=>'/'};"),
 '@/components/ServiceIcon':st('icon',"const React=require('react');const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;")};
for(const ext of ['.tsx','.ts'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf-8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,resolveJsonModule:true},fileName:f}).outputText,f);
const o=Module._resolveFilename;Module._resolveFilename=function(r,...a){if(STUBS[r])return STUBS[r];if(r.startsWith('@blocks/'))return o.call(this,path.join(NEXT,'blocks',r.slice(8)),...a);if(r.startsWith('@/'))return o.call(this,path.join(SRC,r.slice(2)),...a);return o.call(this,r,...a);};
const warn=console.warn;console.warn=()=>{};
const Home=require(path.join(SRC,'components','pages','HomePage.tsx')).default;
const Sub=require(path.join(SRC,'components','pages','SubPage.tsx')).default;
const out={home:renderToStaticMarkup(React.createElement(Home,{locale:'en'})),services:renderToStaticMarkup(React.createElement(Sub,{locale:'en',slug:'services'}))};
console.warn=warn;fs.rmSync(S,{recursive:true,force:true});
process.stdout.write(JSON.stringify(out));
`);
  const build = () => {
    const s = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000 });
    if (s.status !== 0) die(`sync-config.js rc=${s.status}\n${(s.stderr || s.stdout || '').slice(-800)}`);
    const rr = cp.spawnSync(process.execPath, [renderer], { cwd: work, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    if (rr.status !== 0) die(`渲染子进程 rc=${rr.status}\n${(rr.stderr || '').slice(-1200)}`);
    return JSON.parse(rr.stdout);
  };
  const sha = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const homeSha = sha(homeFile);
  const featuresOf = (html) => {
    const m = html.match(/<section[^>]*data-block-type="features"[\s\S]*?<\/section>/) || html.match(/<section[^>]*data-items-source="services"[\s\S]*?<\/section>/);
    return m ? titles(m[0]) : null;
  };

  const b1 = build();
  const t1 = featuresOf(b1.home);
  check(JSON.stringify(t1) === JSON.stringify(base.map((s) => s.name)), `第一次构建：首页 features 的条目 == services.json（${base.length} 条）`, JSON.stringify(t1));

  // 只改 services.json：删一个、改一个名字、加两个（条目数 4 → 5）。
  const next = clone(base);
  next.splice(1, 1);
  next[0].name = `${next[0].name} (renamed 1505)`;
  next.push({ ...clone(base[0]), id: 'water-filters-1505', name: 'Water filter installs 1505' });
  next.push({ ...clone(base[0]), id: 'softeners-1505', name: 'Water softeners 1505' });
  fs.writeFileSync(svcPath, JSON.stringify(next, null, 2));
  const b2 = build();
  const t2 = featuresOf(b2.home);
  check(sha(homeFile) === homeSha, '两次构建之间页面 JSON（home.json）一个字节没动（sha256 相同）');
  check(JSON.stringify(t2) === JSON.stringify(next.map((s) => s.name)) && t2.length !== t1.length,
    `第二次构建：条目数和名字跟着变（${t1 && t1.length} → ${t2 && t2.length}，含改名 / 新加、删掉的那个不在）`, JSON.stringify(t2));
  check(JSON.stringify(t1) !== JSON.stringify(t2), '两次渲染的条目确实不同（这一格不是在比两份一样的东西）');

  // AC8：/services 页上 features 引用 services、没有 services-list ⟹ 每个服务一段 "@type":"Service"。
  const svcLd = (html) => (html.match(/"@type":"Service"/g) || []).length;
  check(svcLd(b2.services) === next.length, `/services 页（features 引用 services、无 services-list）⟹ ${svcLd(b2.services)} 段 "@type":"Service"（服务 ${next.length} 个）`);
  writePage('services', [fx(clone(lib.expandRef({ source: 'services' }, { services: next, pages: [], url: URL })))]);
  const b3 = build();
  check(svcLd(b3.services) === 0, `反向对照：同一页改回手写 ⟹ 0 段（实测 ${svcLd(b3.services)}）`);
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
