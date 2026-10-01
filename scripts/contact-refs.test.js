#!/usr/bin/env node
/**
 * contact-refs.test.js — #1506：按钮 / 页头顶条 / 页脚里的电话、邮箱、地址、社交链接可写成引用
 * （`{source: "phone"}` …、按钮文字里的 `{phone}` / `{email}`），构建时从 brand.json 展开（`scripts/lib/item-sources.js`）。
 *
 * 跑法:  node scripts/contact-refs.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   AC1  跟着变：夹具站只改 brand.json 的 locations[0].phone，页面 / 页头 / 页脚数据一个字节不动，重新构建 ⟹
 *        hero 按钮的 href、按钮文字、cta 按钮、页头顶条电话、页脚电话全部变成新号码
 *        （真跑：skipAI 建站 → sync-config.js → 子进程里加载那棵树的真 config；hero / cta 走真 HomePage，
 *        header-new / footer-new 是 staging、客户页按构造不渲染 ⟹ 直接渲染组件，data 用 itemSourceContext 展开，
 *        ctx 取真 brand.json —— PM 2026-10-01 认的量法）
 *   AC2  tel:：两个号码的期望值；按钮、页头、页脚三处用同一个函数（把 contact-facts.js 换掉一个 telHref，三处一起变）
 *        （telHref 本身的单测在 scripts/lib/contact-facts.test.js）
 *   AC3  多门店：location 1 ⟹ 第二家的号码（按钮 href、文字、页头顶条、页脚 contact）
 *   AC4  指向不存在的东西：没有邮箱 / location 5 ⟹ 那个按钮 / 那一项不画、其它照常、不抛错、打一行日志
 *   AC5  所有块都认：hero-new / cta-new / features-new（块头按钮和条目 link）/ content-new / page-header-new 全部展开；
 *        阳性对照：本票没点名的块（logos-new.introCta、一个不存在的块名）里放引用按钮也展开
 *   AC6  validateSite：四种错写法各报一条；本票列出的合法写法全部放行
 *   AC7  编辑器：blog-new.introCta 那格 Link 选「Business phone」⟹ href 是 {source: "phone"}；画布按钮链到 tel:；
 *        改 brand 后画布跟着变；重开那一格还显示 Business phone；logos-new.introCta 同样有两个选项
 *   AC8  提示词：建站 / 改站提示词里按钮那段含「Phone and email buttons: never write the phone number」和两种写法；
 *        edit-site.js 讲 brand.json 那段含「follow brand.json automatically」
 *   AC10 旧块（contact-form / contact-info / hero / cta-banner / header / footer）零改动（对 origin/main 比）
 *   + socialLinks 两种存法（数组 / 对象）都认；不认识的平台名图标落回 footer-new 的兜底
 *   + 没有引用的块原样返回同一个对象（良构的块一个字节不变）
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
const LIB = path.join(__dirname, 'lib');

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
// 🔴 `@/lib/config` 的 brand 读 globalThis.__BRAND__：编辑器那一段把要测的那份放进去（真站读 config-data.ts，§AC1 量那一条）。
const STUB_DIR = path.join(__dirname, `.contact-refs-stubs-${process.pid}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/components/ServiceIcon': stub('icon', "const React=require('react');const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;\n"),
  '@/lib/config': stub('config', 'module.exports={defaultLocale:"en",locales:["en"],siteId:"t",leadApi:"",'
    + 'getServices:()=>[],get pagesByLocale(){return {en:[]};},localeUrl:(s)=>s==="home"?"/":"/"+s,getBlogPosts:()=>[{slug:"p1",title:"Winter tires",excerpt:"x",content:"",category:"Tips",tags:[],author:"A",publishedAt:"2026-01-01",seo:{metaTitle:"",metaDescription:""}}],'
    + 'get brand(){return globalThis.__BRAND__||{locations:[]};},getForms:()=>[]};\n'),
  '@puckeditor/core': stub('puck', "const React=require('react');module.exports={Puck:()=>null,"
    + "FieldLabel:({label,children})=>React.createElement('div',{'data-label':label},children),"
    + 'createUsePuck:()=>(sel)=>sel({selectedItem:null,dispatch(){},getSelectorForId(){}}),useGetPuck:()=>()=>({})};\n'),
  '@puckeditor/core/puck.css': stub('css', '\n'),
  '@/components/SiteShell': stub('shell', "const C=()=>null;module.exports=C;module.exports.default=C;\n"),
  './EditorChat': stub('chat', "const C=()=>null;module.exports=C;module.exports.default=C;\n"),
};
process.on('exit', () => {
  try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ }
  if (process.env.CONTACT_REFS_KEEP !== '1') for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } }
});
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
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

const FOOTER = path.join(NEXT, 'blocks', 'footer-new', 'Section.tsx');
const HEADER = path.join(NEXT, 'blocks', 'header-new', 'Section.tsx');
const ITEM_SOURCES = path.join(LIB, 'item-sources.js');
const CONTACT_FACTS = path.join(LIB, 'contact-facts.js');

let lib; let facts; let manifestLib; let icons; let demo; let Footer; let Header;
try {
  lib = require(ITEM_SOURCES);
  facts = require(CONTACT_FACTS);
  manifestLib = require('./lib/block-manifest.js');
  icons = require('./lib/icons.js');
  demo = require('./lib/demo-content');
  Footer = require(FOOTER).default;
  Header = require(HEADER).default;
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

// ── 夹具：两家门店、一个邮箱、社交链接 ─────────────────────────────────────────────────────────────
const BRAND = {
  email: 'hello@northside.test',
  locations: [
    { label: 'Main', address: '2150 Yonge St, Toronto', phone: '(604) 555-0142' },
    { label: 'East', address: '88 Queen St E, Toronto', phone: '+1 604-555-0199' },
  ],
  socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/x' }, { platform: 'yelp', url: 'https://yelp.ca/biz/x' }],
};
const logs = [];
const CTX = { services: [], pages: [], url: (s) => `/${s}`, learnMore: 'Learn more', brand: BRAND, log: (m) => logs.push(m) };
const resolve1 = (type, data, ctx = CTX) => lib.resolveItemSources([{ id: 'b', type, data }], ctx)[0].data;
const phoneBtn = (extra = {}) => ({ label: 'Call {phone}', href: { source: 'phone', ...extra }, style: 'outline' });
const renderFooter = (data) => renderToStaticMarkup(React.createElement(Footer, { shape: 'columns', data, iconTable: icons.iconTableFor('footer-new', data) }));
const renderHeader = (data) => renderToStaticMarkup(React.createElement(Header, { shape: 'topbar', data, iconTable: icons.iconTableFor('header-new', data) }));
const headerData = (contact, ctx = CTX) => resolve1('header-new', { ...clone(demo.DEMO_CONTENT['header-new']), topbar: { ...clone(demo.DEMO_CONTENT['header-new'].topbar), contact } }, ctx);
const footerData = (contact, ctx = CTX) => resolve1('footer-new', { ...clone(demo.DEMO_CONTENT['footer-new']), contact, social: { source: 'social' } }, ctx);

// ══ AC2 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('── AC2 tel:：期望值 + 三处用同一个函数');
{
  const btn = resolve1('hero-new', { ctas: [phoneBtn()] }).ctas[0];
  check(btn.href === 'tel:6045550142' && btn.label === 'Call (604) 555-0142', `按钮：(604) 555-0142 ⟹ href ${btn.href} · 文字「${btn.label}」`);
  const plus = { ...CTX, brand: { ...BRAND, locations: [{ ...BRAND.locations[0], phone: '+1 604-555-0142' }] } };
  const top = headerData([{ source: 'phone' }], plus).topbar.contact[0];
  check(top.href === 'tel:+16045550142' && top.text === '+1 604-555-0142' && top.icon === 'telephone',
    `页头顶条：+1 604-555-0142 ⟹ ${JSON.stringify(top)}`);
  const foot = renderFooter(footerData({ source: 'brand' }));
  check(foot.includes('href="tel:6045550142"'), '页脚：HTML 里有 href="tel:6045550142"');

  // 单变量：把 contact-facts.js 的 telHref 换成一个记号函数，重新载入三处 ⟹ 三处一起变成记号（= 用的是同一个函数）。
  const real = require.cache[CONTACT_FACTS].exports;
  const reload = () => {
    for (const k of [ITEM_SOURCES, FOOTER]) delete require.cache[k];
    return { L: require(ITEM_SOURCES), F: require(FOOTER).default };
  };
  require.cache[CONTACT_FACTS].exports = { ...real, telHref: (p) => `tel:MUT-${String(p).length}` };
  const m = reload();
  const mb = m.L.resolveItemSources([{ type: 'hero-new', data: { ctas: [phoneBtn()] } }], CTX)[0].data.ctas[0].href;
  const mt = m.L.resolveItemSources([{ type: 'header-new', data: { topbar: { contact: [{ source: 'phone' }] } } }], CTX)[0].data.topbar.contact[0].href;
  const fd = m.L.resolveItemSources([{ type: 'footer-new', data: { ...clone(demo.DEMO_CONTENT['footer-new']), contact: { source: 'brand' }, social: [] } }], CTX)[0].data;
  const mf = renderToStaticMarkup(React.createElement(m.F, { shape: 'columns', data: fd, iconTable: icons.iconTableFor('footer-new', fd) }));
  require.cache[CONTACT_FACTS].exports = real;
  reload();
  check(mb === 'tel:MUT-14', `按钮的 tel: 来自 contact-facts.telHref（换掉它 ⟹ ${mb}）`);
  check(mt === 'tel:MUT-14', `页头顶条的 tel: 来自 contact-facts.telHref（换掉它 ⟹ ${mt}）`);
  check(mf.includes('href="tel:MUT-14"') && !mf.includes('href="tel:6045550142"'), '页脚的 tel: 来自 contact-facts.telHref（换掉它 ⟹ HTML 里只剩记号）');
  // 换回来之后照常 —— 证明上面三格读到的是记号函数，不是载入坏了。
  check(lib.resolveItemSources([{ type: 'hero-new', data: { ctas: [phoneBtn()] } }], CTX)[0].data.ctas[0].href === 'tel:6045550142', '换回来之后照常（tel:6045550142）');
  const footSrc = fs.readFileSync(FOOTER, 'utf-8');
  check(!/`tel:\$\{|`mailto:\$\{/.test(footSrc), 'footer-new/Section.tsx 里没有自己拼的 `tel:${…}` / `mailto:…`（本地副本和内联写法都删了）');
}

// ══ AC3 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC3 多门店：location 1 ⟹ 第二家');
{
  const btn = resolve1('cta-new', { ctas: [phoneBtn({ location: 1 })] }).ctas[0];
  check(btn.href === 'tel:+16045550199' && btn.label === 'Call +1 604-555-0199', `按钮 ⟹ ${btn.href} · 「${btn.label}」`);
  const top = headerData([{ source: 'address', location: 1 }]).topbar.contact[0];
  check(top.text === '88 Queen St E, Toronto' && top.icon === 'geo-alt' && !top.href, `页头顶条地址 ⟹ ${JSON.stringify(top)}`);
  const fc = footerData({ source: 'brand', location: 1 }).contact;
  check(fc.phone === '+1 604-555-0199' && fc.address === '88 Queen St E, Toronto' && fc.email === BRAND.email, `页脚 contact ⟹ ${JSON.stringify(fc)}`);
  const first = resolve1('cta-new', { ctas: [phoneBtn()] }).ctas[0];
  check(first.href === 'tel:6045550142', `反向对照：不写 location ⟹ 第一家（${first.href}）`);
}

// ══ AC4 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC4 指向不存在的东西：不画那一项、其它照常、不抛错、打一行日志');
{
  const noEmail = { ...CTX, brand: { ...BRAND, email: '' } };
  const ctas = [{ label: 'Book', href: '/quote' }, { label: 'Email {email}', href: { source: 'email' } }, phoneBtn()];
  logs.length = 0;
  let out; let threw = null;
  try { out = resolve1('hero-new', { ctas }, noEmail).ctas; } catch (e) { threw = e; }
  check(!threw && out.length === 2 && out[0].label === 'Book' && out[1].href === 'tel:6045550142', `没有邮箱 ⟹ email 按钮不画、其它两个照常（${out && out.map((c) => c.label).join(' | ')}）`, threw && threw.message);
  check(logs.length === 1 && /email/.test(logs[0]), `打了一行日志（${logs.length} 行：${logs[0] || ''}）`);
  logs.length = 0;
  const far = resolve1('hero-new', { ctas: [ctas[0], phoneBtn({ location: 5 })] }).ctas;
  check(far.length === 1 && far[0].label === 'Book' && logs.length === 1, `location 5（只有两家）⟹ 那个按钮不画、其它照常、一行日志（${far.length} 个按钮，${logs.length} 行）`);
  logs.length = 0;
  const onlyText = resolve1('cta-new', { ctas: [{ label: 'Write to {email}', href: '/contact' }] }, noEmail).ctas;
  check(onlyText.length === 0 && logs.length === 1, '文字里的 {email} 也一样：没有邮箱 ⟹ 那个按钮不画');
  const top = headerData([{ source: 'email' }, { icon: 'clock', text: 'Mon–Sat' }, { source: 'phone', location: 5 }], noEmail).topbar.contact;
  check(top.length === 1 && top[0].text === 'Mon–Sat', `页头顶条：邮箱 / 第 6 家都不在 ⟹ 只剩手写那一项（${JSON.stringify(top)}）`);
  const fc = footerData({ source: 'brand', location: 5 }).contact;
  check(JSON.stringify(fc) === '{}', `页脚 contact 指向第 6 家 ⟹ 空（整段联系信息不画）：${JSON.stringify(fc)}`);
  const page = { slug: 'home', blocks: [{ id: 'h', type: 'hero-new', data: { headline: 'x', ctas: [phoneBtn({ location: 5 })] } }] };
  const probs = manifestLib.validateSite({ pages: [page], scope: 'edit' }).problems.filter((p) => /source|location/.test(p));
  check(probs.length === 0, `构建不报错：validateSite 对 location 5 不报（它是合法写法，只是这个站没有第 6 家）—— ${probs.length} 条`);
}

// ══ AC5 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC5 所有块都认（按形状认，不按块名）');
{
  const cases = [
    ['hero-new', { ctas: [phoneBtn()] }, (d) => d.ctas[0]],
    ['cta-new', { ctas: [phoneBtn()] }, (d) => d.ctas[0]],
    ['features-new', { introCtas: [phoneBtn()], items: [{ title: 'a', text: 'b' }] }, (d) => d.introCtas[0]],
    ['features-new', { items: [{ title: 'a', text: 'b', link: phoneBtn() }] }, (d) => d.items[0].link],
    ['content-new', { ctas: [phoneBtn()] }, (d) => d.ctas[0]],
    ['page-header-new', { ctas: [phoneBtn()] }, (d) => d.ctas[0]],
    ['logos-new', { introCta: phoneBtn() }, (d) => d.introCta],
    ['made-up-block-1506', { deep: { a: [{ b: phoneBtn() }] } }, (d) => d.deep.a[0].b],
  ];
  for (const [type, data, pick] of cases) {
    const b = pick(resolve1(type, data));
    const where = type === 'features-new' ? `${type}.${Object.keys(data)[0]}` : type;
    check(b && b.href === 'tel:6045550142' && b.label === 'Call (604) 555-0142', `${where} ⟹ ${b && b.href}`);
  }
  const plain = { id: 'p', type: 'hero-new', data: { ctas: [{ label: 'Book', href: '/quote' }] } };
  const blocks = [plain];
  check(lib.resolveItemSources(blocks, CTX) === blocks, '没有引用的块：原样返回同一个数组（良构的块一个字节不变）');
  // 块的 data 本身顶层有 label + href 也不当按钮认（整块不会被换掉 / 丢掉）。
  const rootish = resolve1('made-up-block-1506', { label: 'Call {phone}', href: { source: 'phone', location: 9 }, ctas: [phoneBtn()] });
  check(rootish && rootish.label === 'Call {phone}' && rootish.ctas[0].href === 'tel:6045550142', '块 data 顶层正好有 label + href：整块留着，里面的按钮照常展开');
  // 反向对照：label 有 href 没有的对象不是按钮（{phone} 原样留着）—— 形状判据是活的。
  const notBtn = resolve1('hero-new', { eyebrow: { label: 'Call {phone}' } }).eyebrow;
  check(notBtn.label === 'Call {phone}', '反向对照：没有 href 的 {label} 不按按钮处理（{phone} 原样）');
}

// ══ 社交链接两种存法 ════════════════════════════════════════════════════════════════════════════
console.log('\n── socialLinks 两种存法');
{
  const arr = lib.expandRef({ source: 'social' }, CTX);
  const obj = lib.expandRef({ source: 'social' }, { ...CTX, brand: { socialLinks: { facebook: 'https://facebook.com/x', yelp: 'https://yelp.ca/biz/x' } } });
  check(JSON.stringify(arr) === JSON.stringify(obj) && arr.length === 2, `数组 / 对象两种存法展开成同一份（${JSON.stringify(arr)}）`);
  const odd = lib.expandRef({ source: 'social' }, { ...CTX, brand: { socialLinks: { mastodon1506: 'https://m.example/@x' } } });
  const html = renderFooter({ ...clone(demo.DEMO_CONTENT['footer-new']), contact: {}, social: odd });
  check(odd[0].icon === 'mastodon1506' && html.includes('href="https://m.example/@x"') && /data-icon="link-45deg"/.test(html),
    '不认识的平台：链接照画，图标落回 footer-new 的兜底 link-45deg');
}

// ══ AC6 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC6 validateSite');
{
  const v = (blocks) => manifestLib.validateSite({ pages: [{ slug: 'p', blocks }], scope: 'edit' }).problems
    .filter((p) => /source|location|\{fax\}|"x"/.test(p));
  const hero = (ctas) => [{ id: 'h', type: 'hero-new', data: { headline: 'x', ctas } }];
  for (const [ctas, label] of [
    [[{ label: 'Fax', href: { source: 'fax' } }], '{source:"fax"}'],
    [[{ label: 'Call', href: { source: 'phone', location: -1 } }], '{source:"phone", location:-1}'],
    [[{ label: 'Call', href: { source: 'phone', x: 1 } }], '{source:"phone", x:1}'],
    [[{ label: 'Call {fax}', href: '/contact' }], 'label "Call {fax}"'],
  ]) {
    const p = v(hero(ctas));
    check(p.length === 1, `${label} ⟹ 报一条`, p.join(' | ') || '0 条');
  }
  const good = [
    ...hero([phoneBtn(), phoneBtn({ location: 1 }), { label: 'Email {email}', href: { source: 'email' } }, { label: 'Call', href: { source: 'phone', location: 0 } }]),
    { id: 'hd', type: 'header-new', data: { topbar: { contact: [{ source: 'phone' }, { source: 'email' }, { source: 'address', location: 1 }, { icon: 'clock', text: 'x' }] } } },
    { id: 'ft', type: 'footer-new', data: { contact: { source: 'brand', location: 1 }, social: { source: 'social' } } },
  ];
  const p = v(good);
  check(p.length === 0, '本票列出的合法写法（按钮 phone / email / location、页头顶条三种、页脚 brand / social）全部放行', p.join(' | '));
  const wrongPlace = v([{ id: 'hd', type: 'header-new', data: { topbar: { contact: [{ source: 'social' }] } } },
    { id: 'ft', type: 'footer-new', data: { contact: { source: 'phone' } } }]);
  check(wrongPlace.length === 2, `反向对照：源放错位置（顶条写 social、页脚 contact 写 phone）⟹ 各报一条（${wrongPlace.length}）`, wrongPlace.join(' | '));
}

// ══ AC7 编辑器 ════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 编辑器：Link 那一格选 Business phone');
let EditorApp; let schema; let convert;
try {
  EditorApp = require(path.join(SRC, 'components', 'editor', 'EditorApp.tsx'));
  convert = require('./lib/editor-convert.js');
  schema = require('./lib/editor-schema.js').editorSchema();
} catch (e) { die(`编辑器载入失败: ${e.stack || e.message}`); }
globalThis.__BRAND__ = clone(BRAND);
{
  const find = (node, pred) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const x = find(n, pred); if (x) return x; } return null; }
    if (pred(node)) return node;
    return find(node.props && node.props.children, pred);
  };
  // 自定义字段的 render 回的是 <LinkHrefControl/>：展开一层拿它画出来的树（它不用 hook）。
  const tree = (f, value, onChange) => { const el = f.render({ value, onChange, readOnly: false }); return el.type(el.props); };
  const cfg = EditorApp.buildConfig(schema, 'en');
  const hrefField = (type) => cfg.components[type].fields.introCta.objectFields.href;
  for (const type of ['blog-new', 'logos-new']) {
    const f = hrefField(type);
    const html = f && f.type === 'custom' ? renderToStaticMarkup(f.render({ value: '/x', onChange: () => {}, readOnly: false })) : '';
    check(/<option value="phone">Business phone<\/option>/.test(html) && /<option value="email">Business email<\/option>/.test(html),
      `${type}.introCta 那一格 Link 有「Business phone」「Business email」两个选项`, html.slice(0, 160));
  }
  const comp = schema.components.find((c) => c.type === 'blog-new');
  const base = { ...clone(demo.DEMO_CONTENT['blog-new']), introCta: { label: 'Call us', href: '/contact', style: 'solid' } };
  const props = convert.fieldProps(comp, base);
  let picked;
  const sel = find(tree(hrefField('blog-new'), props.introCta.href, (v) => { picked = v; }), (n) => n.type === 'select' && 'data-editor-link-mode' in n.props);
  sel.props.onChange({ target: { value: 'phone' } });
  check(JSON.stringify(picked) === '{"source":"phone"}', `选 Business phone ⟹ onChange 收到 ${JSON.stringify(picked)}`);
  const saved = convert.dataFromProps(comp, base, { ...props, introCta: { ...props.introCta, href: picked } });
  check(JSON.stringify(saved.introCta.href) === '{"source":"phone"}', `存盘：页面 JSON 里 introCta.href 是 ${JSON.stringify(saved.introCta.href)}`);
  // 重开：从存下去的那份再进 Puck，那一格显示的还是 Business phone（不是 [object Object]）。
  const reopened = convert.fieldProps(comp, saved);
  const reHtml = renderToStaticMarkup(hrefField('blog-new').render({ value: reopened.introCta.href, onChange: () => {}, readOnly: false }));
  check(/data-editor-link-source="phone"/.test(reHtml) && /<option value="phone" selected="">Business phone/.test(reHtml) && !/object Object/.test(reHtml),
    '关掉再打开：那一格选中的还是 Business phone、没有 [object Object]');
  const twoLoc = renderToStaticMarkup(hrefField('blog-new').render({ value: { source: 'phone', location: 1 }, onChange: () => {}, readOnly: false }));
  check(/data-editor-link-location/.test(twoLoc) && /<option value="1" selected="">East/.test(twoLoc), '两家门店 ⟹ 多一格选哪一家（location 1 选中 East）');
  globalThis.__BRAND__ = { ...clone(BRAND), locations: [BRAND.locations[0]] };
  const oneLoc = renderToStaticMarkup(hrefField('blog-new').render({ value: { source: 'phone' }, onChange: () => {}, readOnly: false }));
  check(!/data-editor-link-location/.test(oneLoc), '反向对照：只有一家门店 ⟹ 没有那一格');
  globalThis.__BRAND__ = clone(BRAND);
  const custom = renderToStaticMarkup(hrefField('blog-new').render({ value: '/contact', onChange: () => {}, readOnly: false }));
  check(/data-editor-link-source="custom"/.test(custom) && /value="\/contact"/.test(custom), '反向对照：手填地址那一格照旧是文字框、值原样');

  // 画布：存下去的那一份画出来按钮链到 tel:；改 brand 后跟着变。
  const view = { id: 'bl', type: 'blog-new', shape: 'cards', data: saved };
  const canvas = () => {
    const c = EditorApp.buildConfig(schema, 'en');
    const p = { id: 'bl', ...convert.fieldProps(comp, saved), _shape: '', _src: { at: 0, entry: clone(view), locked: false, shared: null, sharedData: null, reason: '', view: clone(view), weight: null, shape0: 'cards', pid: 'bl' } };
    return renderToStaticMarkup(c.components['blog-new'].render(p));
  };
  const c1 = canvas();
  check(c1.includes('href="tel:6045550142"'), '画布：那个按钮链到 tel:6045550142');
  globalThis.__BRAND__ = { ...clone(BRAND), locations: [{ ...BRAND.locations[0], phone: '(778) 555-0100' }] };
  const c2 = canvas();
  check(c2.includes('href="tel:7785550100"') && !c2.includes('tel:6045550142'), '改 brand 的电话 ⟹ 画布跟着变（tel:7785550100）');
  globalThis.__BRAND__ = clone(BRAND);
}

// ══ AC8 提示词 ════════════════════════════════════════════════════════════════════════════════════
console.log('\n── AC8 提示词');
{
  const P = lib.BUTTON_REF_PROMPT;
  check(/Phone and email buttons: never write the phone number/.test(P) && P.includes('{"source": "phone"}') && P.includes('{"source": "email"}')
    && P.includes('{phone}') && P.includes('{email}'), '那一句含「never write the phone number」、两种 href 写法、两种文字占位');
  const create = fs.readFileSync(path.join(__dirname, 'create-site.js'), 'utf-8');
  const edit = fs.readFileSync(path.join(__dirname, 'edit-site.js'), 'utf-8');
  check(/BUTTONS:\n\$\{BUTTON_REF_PROMPT\}/.test(create), '建站提示词印它（create-site.js 的 BUTTONS 段）');
  check(/\n\$\{BUTTON_REF_PROMPT\}\n/.test(edit), '改站提示词印它（edit-site.js 的 SYSTEM_PROMPT）');
  const at = edit.indexOf('- **brand.json**');
  check(at > 0 && /follow brand\.json automatically/.test(edit.slice(at, at + 700)), '改站提示词讲 brand.json 那段含「follow brand.json automatically」那句');
}

// ══ AC10 旧块零改动 ═══════════════════════════════════════════════════════════════════════════════
console.log('\n── AC10 旧块零改动（对 origin/main 比）');
{
  const r = cp.spawnSync('git', ['diff', '--stat', 'origin/main', '--', ...['contact-form', 'contact-info', 'hero', 'cta-banner', 'header', 'footer'].map((b) => `blocks/${b}`)], { cwd: NEXT, encoding: 'utf8' });
  if (r.status !== 0) console.log(`  ⚠️  git diff 跑不起来（rc=${r.status}）—— 这一格没量（不是「零改动」）`);
  else check(r.stdout.trim() === '', `六个旧块对 origin/main 零改动${r.stdout.trim() ? `：${r.stdout.trim()}` : ''}`);
}

// ══ AC1 真跑：skipAI 建站 + sync-config + 服务端渲染，只改 brand.json ═══════════════════════════════
console.log('\n── AC1 只改 brand.json 跟着变（真跑 create-site.js skipAI + sync-config.js + HomePage；header-new / footer-new 直接渲染、ctx 取真 brand.json）');
{
  const work = path.join(temp('contact-refs-tree-'), 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  for (const d of fs.readdirSync(path.join(work, 'scripts'))) if (d.startsWith('.') && d.includes('stubs')) fs.rmSync(path.join(work, 'scripts', d), { recursive: true, force: true });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const payload = JSON.stringify({ siteId: 'contactref1', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en' });
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: payload, cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  const loc = path.join(site, 'en');
  if (!fs.existsSync(path.join(loc, 'seo.json'))) die(`skipAI 建站没立起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  const brandPath = [path.join(site, 'brand.json'), path.join(loc, 'brand.json')].find((p) => fs.existsSync(p));
  if (!brandPath) die('skipAI 站里找不到 brand.json');
  const brand = JSON.parse(fs.readFileSync(brandPath, 'utf-8'));
  if (!Array.isArray(brand.locations) || !brand.locations[0]) die(`skipAI 站的 brand.json 没有 locations[0]（${JSON.stringify(brand.locations)}）`);
  const setPhone = (phone) => { brand.locations[0].phone = phone; fs.writeFileSync(brandPath, JSON.stringify(brand, null, 2)); };
  setPhone('(604) 555-0142');

  const homeFile = path.join(loc, 'pages', 'home.json');
  const home = JSON.parse(fs.readFileSync(homeFile, 'utf-8'));
  const D = demo.DEMO_CONTENT;
  home.blocks = [
    { id: 'hero-ref', type: 'hero-new', shape: 'centered', role: 'essential', region: 'content', weight: 10,
      data: { ...clone(D['hero-new']), ctas: [{ label: 'Book a service', href: '/', style: 'solid' }, { label: 'Call {phone}', href: { source: 'phone' }, style: 'outline' }] } },
    { id: 'cta-ref', type: 'cta-new', shape: 'centered', role: 'essential', region: 'content', weight: 20,
      data: { ...clone(D['cta-new']), ctas: [{ label: 'Phone {phone}', href: { source: 'phone' }, style: 'solid' }] } },
  ];
  fs.writeFileSync(homeFile, JSON.stringify(home, null, 2));
  // 页头 / 页脚的 data：今天没接到建站流程上（T3 #1425），用演示内容那份（已经是引用写法），存在一个文件里两次构建都不动它。
  const regionsFile = path.join(temp('contact-refs-regions-'), 'regions.json');
  fs.writeFileSync(regionsFile, JSON.stringify({ header: D['header-new'], footer: D['footer-new'] }, null, 2));

  const renderer = path.join(work, 'scripts', '.contact-refs-render.js');
  fs.writeFileSync(renderer, `
const fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const NEXT=${JSON.stringify(work)},SRC=path.join(NEXT,'src');
const S=path.join(NEXT,'scripts','.contact-refs-render-stubs');fs.mkdirSync(S,{recursive:true});
const st=(n,b)=>{const p=path.join(S,n+'.js');fs.writeFileSync(p,b);return p;};
const STUBS={'next/link':st('link',"const React=require('react');const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;"),
 'next/navigation':st('nav',"module.exports={notFound(){throw new Error('notFound')},redirect(u){throw new Error('redirect '+u)},usePathname:()=>'/'};"),
 '@/components/ServiceIcon':st('icon',"const React=require('react');const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;")};
for(const ext of ['.tsx','.ts'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf-8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,resolveJsonModule:true},fileName:f}).outputText,f);
const o=Module._resolveFilename;Module._resolveFilename=function(r,...a){if(STUBS[r])return STUBS[r];if(r.startsWith('@blocks/'))return o.call(this,path.join(NEXT,'blocks',r.slice(8)),...a);if(r.startsWith('@/'))return o.call(this,path.join(SRC,r.slice(2)),...a);return o.call(this,r,...a);};
const warn=console.warn;console.warn=()=>{};
const Home=require(path.join(SRC,'components','pages','HomePage.tsx')).default;
const {itemSourceContext,resolveItemSources}=require(path.join(SRC,'lib','sections','item-sources.ts'));
const icons=require(path.join(NEXT,'scripts','lib','icons.js'));
const R=JSON.parse(fs.readFileSync(${JSON.stringify(regionsFile)},'utf-8'));
const ctx=itemSourceContext('en');
const one=(type,data)=>resolveItemSources([{id:type,type,data}],ctx)[0].data;
const hd=one('header-new',R.header),fd=one('footer-new',R.footer);
const H=require(path.join(NEXT,'blocks','header-new','Section.tsx')).default,F=require(path.join(NEXT,'blocks','footer-new','Section.tsx')).default;
const out={home:renderToStaticMarkup(React.createElement(Home,{locale:'en'})),
 header:renderToStaticMarkup(React.createElement(H,{shape:'topbar',data:hd,iconTable:icons.iconTableFor('header-new',hd)})),
 footer:renderToStaticMarkup(React.createElement(F,{shape:'columns',data:fd,iconTable:icons.iconTableFor('footer-new',fd)}))};
console.warn=warn;fs.rmSync(S,{recursive:true,force:true});
process.stdout.write(JSON.stringify(out));
`);
  const build = () => {
    const s = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000 });
    if (s.status !== 0) die(`sync-config.js rc=${s.status}\n${(s.stderr || s.stdout || '').slice(-1200)}`);
    const rr = cp.spawnSync(process.execPath, [renderer], { cwd: work, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    if (rr.status !== 0) die(`渲染子进程 rc=${rr.status}\n${(rr.stderr || '').slice(-1200)}`);
    return JSON.parse(rr.stdout);
  };
  const sha = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const shas = () => [homeFile, regionsFile].map(sha).join(',');
  const section = (html, type) => (html.match(new RegExp(`<section[^>]*data-block="${type}"[\\s\\S]*?</section>`)) || [''])[0];
  const read = (b) => ({
    hero: section(b.home, 'hero-new'),
    cta: section(b.home, 'cta-new'),
    header: b.header,
    footer: b.footer,
  });
  const has = (html, digits, shown) => html.includes(`href="tel:${digits}"`) && (shown === null || html.includes(shown));

  const s0 = shas();
  const b1 = read(build());
  check(b1.hero !== '' && b1.cta !== '', '第一次构建：首页上 hero-new 和 cta-new 都渲染出来了（不是空串）');
  check(has(b1.hero, '6045550142', 'Call (604) 555-0142'), '第一次：hero 按钮 href="tel:6045550142"、文字「Call (604) 555-0142」');
  check(has(b1.cta, '6045550142', 'Phone (604) 555-0142'), '第一次：cta 按钮 href="tel:6045550142"、文字「Phone (604) 555-0142」');
  check(has(b1.header, '6045550142', '(604) 555-0142'), '第一次：页头顶条电话 (604) 555-0142 · tel:6045550142');
  check(has(b1.footer, '6045550142', '(604) 555-0142'), '第一次：页脚电话 (604) 555-0142 · tel:6045550142');

  setPhone('+1 778-555-0100');
  const b2 = read(build());
  check(shas() === s0, '两次构建之间页面 JSON（home.json）和页头页脚的 data 一个字节没动（sha256 相同）');
  for (const k of ['hero', 'cta', 'header', 'footer']) {
    check(has(b2[k], '+17785550100', '+1 778-555-0100') && !b2[k].includes('6045550142') && !b2[k].includes('(604) 555-0142'),
      `第二次：${k} 全部变成新号码（tel:+17785550100、「+1 778-555-0100」），旧号码一处不剩`);
  }
  check(b1.hero !== b2.hero, '两次渲染的 hero 确实不同（这一格不是在比两份一样的东西）');
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
