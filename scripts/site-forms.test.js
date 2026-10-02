#!/usr/bin/env node
/**
 * site-forms.test.js — #1471（T5.3 站级表单库）里「调一次校验器 / 渲染一次 HTML / 跑一次真建站就能判」的那几条。
 *
 * 跑法:  node scripts/site-forms.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   AC1 validateSite —— form.id 指空 / fields 词表外 / primary 不在 fields / 两个语言 quote.fields 不同，各报一条
 *   AC2 同一张 quote，四个块（hero / footer / contact / cta）：full 全部字段、teaser 只 phone + 按钮；
 *       改 quote.buttonText 一处，四个块的 HTML 都含新文案；form=none 没有 <form>（阳性对照：切回 teaser 就有）
 *   AC4 新建站（skipAI，真跑 create-site.js）：每个语言都有 forms.json、quote 在 contact 前；form.id 空 ⟹ quote 的按钮文字
 *   AC5 老站（删掉 forms.json）跑真的 sync-config.js ⟹ 退出码 0，带表单的块画 BlockLeadForm 的内置默认字段
 *   AC7 page-deps：hero / contact / cta 都在 types 里、unaccounted 为空、BlockLeadForm 那条豁免不在了
 *   #1511 表单库补两条：fields 里 phone / email 都没有 ⟹ 报；redirect 不在 href-allowed.js 白名单 ⟹ 报（白名单只有一份）
 * 提交带 meta.formId（AC3 的前端那一半）在 hero-render.test.js 的 happy-dom 段；落库那一半要真 manager + 库，见票上实测。
 *
 * 🔴 每一段带反向对照（同一进程、单变量），证明判据真会红。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const clone = (v) => JSON.parse(JSON.stringify(v));

const TEMP = [];
const temp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMP.push(d); return d; };

// ── 让 node 能 require .tsx；Next 自己的与构建期生成的换成替身 ──────────────────────────────────────
// 🔴 `getForms` 读 `globalThis.__SITE_FORMS__`：每一段把要测的那份表单库放进去，组件取的就是它（真站读 config-data.ts）。
const STUB_DIR = path.join(NEXT, 'scripts', '.site-forms-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
  '@/lib/config': stub('config', 'module.exports={siteId:"t-site",leadApi:"https://lead.example",defaultLocale:"en",'
    + 'getServices:()=>[{id:"brakes",name:"Brakes"},{id:"tires",name:"Tires"}],'
    + 'getForms:()=>globalThis.__SITE_FORMS__||[],'
    + 'brand:{email:"own@site.example",locations:[{label:"Own",address:"1 Own Rd",phone:"+1 (905) 555-0199"}]},'
    + 'getSeo:()=>({schema:{openingHours:{days:["Monday"],opens:"10:00",closes:"16:30"}}})};\n'),
};
process.on('exit', () => {
  try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ }
  if (process.env.SITE_FORMS_KEEP !== '1') for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } }
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

let manifestLib; let siteForms; let DEMO; let DEMO_SITE;
const C = {};
try {
  manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  siteForms = require(path.join(NEXT, 'scripts', 'lib', 'site-forms.js'));
  ({ DEMO_CONTENT: DEMO, DEMO_SITE } = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')));
  for (const b of ['hero', 'footer', 'contact', 'cta']) C[b] = require(path.join(NEXT, 'blocks', b, 'Section.tsx')).default;
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }
if (!Array.isArray(DEMO_SITE.forms) || DEMO_SITE.forms[0].id !== 'quote') die('演示生意的表单库（DEMO_SITE.forms）不在或第一张不是 quote');

// ══ AC1：validateSite ════════════════════════════════════════════════════════════════════════════
console.log('── AC1 validateSite');
{
  const page = (form) => [{ slug: 'home', blocks: [{ type: 'cta', data: { ...clone(DEMO['cta']), form, options: { form: 'teaser' } } }] }];
  const v = (pages, forms) => manifestLib.validateSite({ pages, forms, scope: 'edit' }).problems.filter((p) => /form\.id|forms\.json/.test(p));
  const F = clone(DEMO_SITE.forms);
  check(v(page({ id: 'quote' }), F).length === 0 && v(page({}), F).length === 0, '对照：form.id = quote / 留空 ⟹ 0 条');
  const dangling = v(page({ id: 'nope' }), F);
  check(dangling.length === 1 && /form\.id "nope"/.test(dangling[0]), 'form.id 指向不存在的表单 ⟹ 报一条', dangling.join(' | '));
  const vocab = clone(F); vocab[0].fields = ['name', 'phone', 'fax'];
  const vr = v(page({}), vocab);
  check(vr.length === 1 && /词表外/.test(vr[0]) && /fax/.test(vr[0]), 'fields 含词表外的值 ⟹ 报一条', vr.join(' | '));
  const prim = clone(F); prim[0].primary = 'email';
  const pr = v(page({}), prim);
  check(pr.length === 1 && /primary/.test(pr[0]), 'primary 不在 fields ⟹ 报一条', pr.join(' | '));
  const zh = clone(F); zh[0].fields = ['name', 'phone'];
  const lr = v(page({}), { en: F, zh });
  check(lr.length === 1 && /quote/.test(lr[0]) && /en/.test(lr[0]) && /zh/.test(lr[0]), 'en 与 zh 两份 forms.json 的 quote.fields 不同 ⟹ 报一条', lr.join(' | '));
  check(v(page({}), { en: F, zh: clone(F) }).length === 0, '对照：两份结构相同（文字可以不同）⟹ 0 条');
  const old = v(page({ id: 'quote' }), []);
  check(old.length === 1, '站没有 forms.json（空库）+ 块里写了 form.id ⟹ 报一条（指空）', old.join(' | '));
  check(v(page({ id: 'nope' }), undefined).length === 0, '调用方没传 forms ⟹ 这一条不查（不是空库）');
  // build 那一档只说不拦：同一个毛病进 warnings、不进 problems。
  const b = manifestLib.validateSite({ pages: page({ id: 'nope' }), forms: F, scope: 'build' });
  check(b.problems.length === 0 && b.warnings.some((w) => /form\.id "nope"/.test(w)), "scope 'build'：同一条进 warnings、problems 为空（构建期只说不拦）");
}

// ══ #1511：表单要能联系到人 · redirect 只收安全地址 ══════════════════════════════════════════════════
console.log('\n── #1511 formListProblems 补的两条');
{
  const page = [{ slug: 'home', blocks: [{ type: 'cta', data: { ...clone(DEMO['cta']), form: { id: 'quote' }, options: { form: 'teaser' } } }] }];
  const v = (forms, scope = 'edit') => manifestLib.validateSite({ pages: page, forms, scope });
  const mine = (r) => r.filter((p) => /phone 也没有 email|redirect/.test(p));
  const F = clone(DEMO_SITE.forms);
  check(mine(v(F).problems).length === 0, '对照：演示站的表单库（quote 有 phone、contact 有 email，都不带 redirect）⟹ 0 条');
  check(siteForms.formListProblems(siteForms.DEFAULT_SITE_FORMS).length === 0, '对照：新站默认那两张 ⟹ 0 条（加这两条不会把建站打死）');

  // ① 联系得到人：phone / email 都没有 ⟹ 一条；单变量加回任一个 ⟹ 0 条。
  const noContact = clone(F); noContact[0].fields = ['name', 'message']; noContact[0].primary = 'name';
  const nc = mine(v(noContact).problems);
  check(nc.length === 1 && /"quote"/.test(nc[0]), 'fields ["name","message"]（没有 phone 也没有 email）⟹ 报一条，点名 quote', nc.join(' | '));
  for (const add of ['phone', 'email']) {
    const ok1 = clone(noContact); ok1[0].fields = ['name', 'message', add];
    check(mine(v(ok1).problems).length === 0, `对照：同一张加上 ${add} ⟹ 0 条`);
  }

  // ② redirect：白名单跟块里的按钮链接是同一份。
  const withRedirect = (r) => { const x = clone(F); x[0].redirect = r; return x; };
  for (const r of ['javascript:alert(document.cookie)', '//evil.com', 'data:text/html,x', ' /thanks', 42]) {
    const got = mine(v(withRedirect(r)).problems);
    check(got.length === 1 && /redirect/.test(got[0]) && /"quote"/.test(got[0]), `redirect ${JSON.stringify(r)} ⟹ 报一条`, got.join(' | '));
  }
  for (const r of ['/thanks', 'https://example.com/thanks', 'tel:+19055550199', '', null]) {
    check(mine(v(withRedirect(r)).problems).length === 0, `对照：redirect ${JSON.stringify(r)} ⟹ 0 条`);
  }
  // 构建期只说不拦（走的是 validateSite 的 flag 出口）。
  const b = v(withRedirect('javascript:alert(1)'), 'build');
  check(b.problems.length === 0 && mine(b.warnings).length === 1, "scope 'build'：redirect 那条进 warnings、problems 为空");
  // 多语言那条路（formsProblems）也查得到：只在 zh 那份写了坏 redirect。
  const ml = mine(siteForms.formsProblems({ en: F, zh: withRedirect('javascript:x') }));
  check(ml.length === 1 && /\[zh\]/.test(ml[0]), '多语言：只有 zh 那份带坏 redirect ⟹ 报一条，点名 [zh]', ml.join(' | '));

  // ③ 白名单只有一份：link-href.js 导出的就是 href-allowed.js 那个函数；href-allowed.js 一个 require 都没有
  //    （site-forms.js 被 'use client' 组件 import，从它这儿多一个 require 就多一串代码进客户端包）。
  const ha = require(path.join(NEXT, 'scripts', 'lib', 'href-allowed.js'));
  const lh = require(path.join(NEXT, 'scripts', 'lib', 'link-href.js'));
  check(lh.hrefAllowed === ha.hrefAllowed, 'link-href.js 的 hrefAllowed 就是 href-allowed.js 那一个（不是第二份）');
  const haSrc = fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'href-allowed.js'), 'utf-8').replace(/\/\/.*$/gm, '');
  check(!/\brequire\s*\(|\bimport\b/.test(haSrc), 'href-allowed.js 不 require / import 任何东西');
  // 反向对照：同一把尺对着 link-href.js（它 require 了 block-manifest）读得到。
  const lhSrc = fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'link-href.js'), 'utf-8').replace(/\/\/.*$/gm, '');
  check(/\brequire\s*\(/.test(lhSrc), '反向对照：同一把尺在 link-href.js 上读到 require（证明这把尺会红）');
}

// ══ AC2：四个块、同一张 quote ═══════════════════════════════════════════════════════════════════
console.log('\n── AC2 四个块共用站级那一张');
const CELLS = {
  'hero': { shape: 'lead-form', prefix: 'hro' },
  'footer': { shape: 'stacked', prefix: 'ftr' },
  'contact': { shape: 'form-beside', prefix: 'ct' },
  'cta': { shape: 'lead-form', prefix: 'cta' },
};
const dataFor = (type, mode, formId) => {
  const d = clone(DEMO[type]);
  d.form = formId === undefined ? {} : { id: formId };
  d.options = { ...(d.options || {}), form: mode };
  return d;
};
const html = (type, mode, formId) => {
  const { shape } = CELLS[type];
  const d = dataFor(type, mode, formId);
  const props = type === 'footer'
    ? { shape, data: d, iconTable: {}, locale: 'en' }
    : { data: d, locale: 'en', iconTable: {}, block: { id: 'x', type, shape, data: {} } };
  return renderToStaticMarkup(React.createElement(C[type], props));
};
const ids = (h, prefix) => Array.from(h.matchAll(new RegExp(`<(?:input|select|textarea)[^>]*\\bid="${prefix}-([a-z]+)"`, 'g'))).map((m) => m[1]).filter((x) => x !== 'hp');
{
  const F = clone(DEMO_SITE.forms);
  globalThis.__SITE_FORMS__ = F;
  for (const [type, { prefix }] of Object.entries(CELLS)) {
    const full = html(type, 'full', 'quote');
    const teaser = html(type, 'teaser', 'quote');
    check(JSON.stringify(ids(full, prefix)) === JSON.stringify(F[0].fields) && full.includes('data-form-id="quote"'),
      `${type} · full：quote 的全部字段（${ids(full, prefix).join(' / ')}）`);
    check(JSON.stringify(ids(teaser, prefix)) === JSON.stringify(['phone']) && /<button[^>]*type="submit"/.test(teaser),
      `${type} · teaser：只有 phone + 按钮（${ids(teaser, prefix).join(' / ')}）`);
    const contact = html(type, 'full', 'contact');
    check(JSON.stringify(ids(contact, prefix)) === JSON.stringify(F[1].fields) && contact.includes(F[1].buttonText),
      `${type} · form.id = contact ⟹ 换成那一张（${ids(contact, prefix).join(' / ')}，按钮「${F[1].buttonText}」）`);
    const none = html(type, 'none', 'quote');
    check(!/<form\b/.test(none) && (type !== 'footer' || !none.includes('data-footer-form')),
      `${type} · form=none：没有 <form>${type === 'footer' ? '、也没有 data-footer-form' : ''}`);
    check(/<form\b/.test(html(type, 'teaser', 'quote')), `${type} · 阳性对照：同一份数据切回 teaser ⟹ <form> 出现`);
  }
  // 改 quote.buttonText 一处 ⟹ 四个块都变。
  const before = Object.keys(CELLS).map((t) => html(t, 'teaser'));
  const NEW = 'Book my free inspection';
  globalThis.__SITE_FORMS__ = clone(F); globalThis.__SITE_FORMS__[0].buttonText = NEW;
  const after = Object.keys(CELLS).map((t) => html(t, 'teaser'));
  const missing = Object.keys(CELLS).filter((t, i) => !after[i].includes(NEW) || before[i].includes(NEW));
  check(missing.length === 0, `改 quote.buttonText 一处 ⟹ 四个块的 HTML 都含「${NEW}」`, `没变的：${missing.join(' · ')}`);
  // 反向对照：块写了 form.id = contact ⟹ 改 quote 的文字它不跟着变（证明它真按 id 取，不是恒取第一张）。
  check(!html('cta', 'teaser', 'contact').includes(NEW), '反向对照：选了 contact 的块不跟着 quote 变');
  // AC4 ②：form.id 为空 ⟹ quote 的按钮文字。
  check(Object.keys(CELLS).every((t) => html(t, 'full').includes(NEW)), 'form.id 为空 ⟹ 四个块用的都是第一张（quote）的按钮文字');
  // 没有表单库 ⟹ BlockLeadForm 的内置默认（AC5 的渲染那一半）。
  globalThis.__SITE_FORMS__ = [];
  const fallback = Object.entries(CELLS).filter(([t, { prefix }]) => {
    const h = html(t, 'full');
    return JSON.stringify(ids(h, prefix)) !== JSON.stringify(['name', 'phone', 'service']) || h.includes('data-form-id=') || !h.includes('Get a free quote');
  }).map(([t]) => t);
  check(fallback.length === 0, '站没有表单库 ⟹ 四个块都画内置默认（name / phone / service，按钮 Get a free quote，不挂 data-form-id）', `不对的：${fallback.join(' · ')}`);
}

// ══ AC7：page-deps 归属 ═══════════════════════════════════════════════════════════════════════════
console.log('\n── AC7 page-deps：服务清单按块归属');
{
  const pd = require(path.join(NEXT, 'scripts', 'lib', 'page-deps.js'));
  const r = pd.blockTypesReadingServices(NEXT);
  const want = ['hero', 'contact', 'cta'];
  check(want.every((t) => r.types.has(t)), `types 含 ${want.join(' / ')}（${[...r.types].sort().join(', ')}）`);
  check(r.unaccounted.length === 0 && r.unmapped.length === 0, `unaccounted / unmapped 都为空（${JSON.stringify(r.unaccounted)} / ${JSON.stringify(r.unmapped)}）`);
  const src = fs.readFileSync(path.join(NEXT, 'scripts', 'lib', 'page-deps.js'), 'utf-8');
  check(!/\['src\/components\/BlockLeadForm\.tsx'/.test(src), 'ACCOUNTED 里不再有 BlockLeadForm.tsx 那条「footer 站级外壳」豁免');
  // 反向对照：在一棵临时树里让 BlockLeadForm 重新自己读服务清单 ⟹ 它归不了属、被点名。
  const root = temp('site-forms-pd-');
  for (const rel of ['src', 'blocks']) cp.execSync(`cp -a "${path.join(NEXT, rel)}" "${path.join(root, rel)}"`);
  const f = path.join(root, 'src', 'components', 'BlockLeadForm.tsx');
  fs.writeFileSync(f, `${fs.readFileSync(f, 'utf-8')}\n// const s = getServices(locale);\n`);
  const r2 = pd.blockTypesReadingServices(root);
  check(r2.unaccounted.includes('src/components/BlockLeadForm.tsx'), `反向对照：BlockLeadForm 里再出现 getServices ⟹ 点名 unaccounted（${JSON.stringify(r2.unaccounted)}）`);
}

// ══ AC4 / AC5：真跑一次 skipAI 建站 + sync-config ════════════════════════════════════════════════
console.log('\n── AC4 新建站 · AC5 老站兼容（真跑 create-site.js skipAI + sync-config.js）');
{
  const work = path.join(temp('site-forms-tree-'), 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const payload = JSON.stringify({
    siteId: 'formstest', companyName: 'Northside Auto Care', industry: 'auto repair',
    location: 'Toronto', skipAI: true, language: 'en', secondaryLocales: ['fr'],
  });
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: payload, cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  const site = path.join(work, 'site');
  if (!fs.existsSync(path.join(site, 'en', 'seo.json'))) die(`skipAI 建站没立起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  const read = (loc) => { try { return JSON.parse(fs.readFileSync(path.join(site, loc, 'forms.json'), 'utf-8')); } catch (e) { return null; } };
  for (const loc of ['en', 'fr']) {
    const f = read(loc);
    check(Array.isArray(f) && f.length >= 2 && f[0].id === 'quote' && f[1].id === 'contact',
      `${loc}/forms.json 在、含 quote / contact、quote 在前（${f ? f.map((x) => x.id).join(', ') : '没有'}）`);
  }
  check(siteForms.formsProblems({ en: read('en'), fr: read('fr') }).length === 0, '两个语言的表单库校验 0 条（结构一致）');

  const sync = () => cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 180000 });
  const s1 = sync();
  const data1 = fs.readFileSync(path.join(work, 'src', 'lib', 'config-data.ts'), 'utf-8');
  check(s1.status === 0 && /export const formsByLocale = \{"en":\[\{"id":"quote"/.test(data1), `新站 sync-config rc=${s1.status}，config-data.ts 带着 formsByLocale（en 第一张是 quote）`);

  for (const loc of ['en', 'fr']) fs.rmSync(path.join(site, loc, 'forms.json'));
  const s2 = sync();
  const data2 = fs.readFileSync(path.join(work, 'src', 'lib', 'config-data.ts'), 'utf-8');
  check(s2.status === 0, `老站（删掉两个 forms.json）跑 sync-config ⟹ 退出码 0（实测 ${s2.status}）`, (s2.stderr || '').slice(-300));
  check(/export const formsByLocale = \{"en":\[\],"fr":\[\]\};/.test(data2), '老站的 config-data.ts：两个语言都是空表单库');
  // 反向对照：把 forms.json 塞进必需文件表 ⟹ 同一个老站 exit 1（证明上一条测的是那张表，不是别的原因放行）。
  const sc = path.join(work, 'scripts', 'sync-config.js');
  const orig = fs.readFileSync(sc, 'utf-8');
  const broken = orig.replace("['seo.json', 'services.json', 'navigation.json', 'pages/home.json']", "['seo.json', 'services.json', 'navigation.json', 'pages/home.json', 'forms.json']");
  if (broken === orig) bad('反向对照没改到 sync-config.js（锚点找不到）—— 这一格什么都没证明');
  else {
    fs.writeFileSync(sc, broken);
    const s3 = sync();
    check(s3.status === 1, `反向对照：forms.json 进了必需文件表 ⟹ 同一个老站 exit ${s3.status}（应为 1）`);
    fs.writeFileSync(sc, orig);
  }
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
