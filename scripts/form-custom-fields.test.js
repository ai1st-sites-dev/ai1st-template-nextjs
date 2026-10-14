#!/usr/bin/env node
/**
 * form-custom-fields.test.js — #1769（T10r-1）表单自定义字段「一行字 + 必填」在模板这一侧的几条。
 *
 * 跑法:  node scripts/form-custom-fields.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   AC1  表单校验（`site-forms.js`）：一条 text 自定义字段过；type 是词表外的 ⟹ 拒（#1770 起另外五种合法，那几格在 form-custom-field-types.test.js）；两个语言自定义字段 id 不一致 ⟹ 拒；
 *        内置 + 自定义混排、带 required ⟹ 过。外加形状边角（没名字 / options / 重复 id / 超个数 / required 指空）。
 *   存盘（`forms-write.js`）：加一个自定义字段 + 名字 + 必填，结构写进每个语言、名字只写这个语言（别的语言先借这一句）；
 *        删掉它 ⟹ 每个语言的名字一起删、required 跟着去掉；type select ⟹ 拒；只改名字 ⟹ 别的语言一个字节不动。
 *   做什么 3（访客端，`BlockLeadForm.tsx`）：full 按 fields 顺序画出自定义字段、名字是占位符、必填的带 required 和「 *」；
 *   做什么 2（编辑器，`FormCopyEditor.tsx`）：Add custom → Add field 页（Label · Type 只有 One line · Required）→ Save → Done 交的那一笔；
 *        那一笔喂给真的 planFormsWrite 收下、套到画布（applyFormCopyEdit）多一格；改名只交名字；内置字段的 Required；删掉跟着去掉。
 *   AC6  同一张表单 teaser ⟹ 只有 primary 那一格 + 按钮（hero 块真渲染）；
 *        提交（happy-dom 真点）：必填空着 / 只有空白 ⟹ 不发请求、那一格 is-invalid、出「请填必填项」；
 *        填了 ⟹ 一次 POST，meta.answers = [{ id, label, value }]（label 是此刻的名字），没填的选填字段不带。
 *
 * 🔴 每一段带反向对照（同一进程、单变量），证明判据真会红。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const FORM = path.join(SRC, 'components', 'BlockLeadForm.tsx');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
const clone = (v) => JSON.parse(JSON.stringify(v));

const TEMP = [];
const temp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TEMP.push(d); return d; };

// ── 让 node 能 require .tsx（同 site-forms.test.js 的做法）──────────────────────────────────────────
const STUB_DIR = path.join(NEXT, 'scripts', '.form-custom-fields-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => { const p = path.join(STUB_DIR, `${name}.js`); fs.writeFileSync(p, body); return p; };
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);module.exports=L;module.exports.default=L;\n"),
};
process.on('exit', () => {
  try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾 */ }
  for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } }
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

let sf; let fw; let DEMO; let Hero;
try {
  sf = require(path.join(NEXT, 'scripts', 'lib', 'site-forms.js'));
  fw = require(path.join(NEXT, 'scripts', 'lib', 'forms-write.js'));
  DEMO = require(path.join(NEXT, 'scripts', 'lib', 'demo-content')).DEMO_CONTENT;
  Hero = require(path.join(NEXT, 'blocks', 'hero', 'Section.tsx')).default;
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

const CAR = { id: 'car', type: 'text' };
const NOTE = { id: 'f-note', type: 'text' };
/** 夹具：默认那张 contact，中间插一个必填的「What car do you drive?」和一个选填的「Anything else?」。 */
const FORM_EN = {
  id: 'contact', name: 'Contact us',
  fields: ['name', CAR, 'phone', 'email', NOTE, 'message'],
  primary: 'phone',
  required: ['car', 'name'],
  labels: { car: 'What car do you drive?', 'f-note': 'Anything else?' },
  buttonText: 'Get in touch', successMessage: 'Thanks — we will get back to you shortly.',
};
const FORM_ZH = { ...clone(FORM_EN), name: '联系我们', labels: { car: '您开什么车？', 'f-note': '还有别的吗？' } };

// ══ AC1：表单校验 ═══════════════════════════════════════════════════════════════════════════════
console.log('── AC1 表单校验（site-forms.js）');
{
  const one = (f) => sf.formListProblems([f]);
  const only = { ...clone(FORM_EN), fields: ['phone', CAR], required: undefined, labels: { car: 'What car do you drive?' } };
  check(one(only).length === 0, '一条 text 自定义字段 ⟹ 过', one(only).join(' | '));
  // #1770 —— select / textarea / date 从这一列挪走了（它们现在合法，form-custom-field-types.test.js 量）；留下词表外的。
  for (const type of ['file', 'email', 42, undefined]) {
    const f = clone(only); f.fields[1].type = type;
    const got = one(f);
    check(got.length === 1 && /type/.test(got[0]) && /car/.test(got[0]), `type = ${JSON.stringify(type)} ⟹ 拒（报一条）`, got.join(' | '));
  }
  check(one(clone(FORM_EN)).length === 0, '内置 + 自定义混排、带 required（内置 name + 自定义 car）⟹ 过', one(clone(FORM_EN)).join(' | '));
  const ok2 = sf.formsProblems({ en: [clone(FORM_EN)], zh: [clone(FORM_ZH)] });
  check(ok2.length === 0, '对照：两个语言同一份结构、名字各自翻 ⟹ 过', ok2.join(' | '));
  const zhOther = clone(FORM_ZH); zhOther.fields[1] = { id: 'vehicle', type: 'text' }; zhOther.required = ['vehicle', 'name']; zhOther.labels = { vehicle: '您开什么车？', 'f-note': '还有别的吗？' };
  const got = sf.formsProblems({ en: [clone(FORM_EN)], zh: [zhOther] });
  check(got.length === 1 && /contact/.test(got[0]) && /en/.test(got[0]) && /zh/.test(got[0]), '两个语言的同一张表单自定义字段 id 不一致 ⟹ 拒（报一条）', got.join(' | '));
  const zhReq = clone(FORM_ZH); zhReq.required = ['name'];
  const gotReq = sf.formsProblems({ en: [clone(FORM_EN)], zh: [zhReq] });
  check(gotReq.length === 1 && /required/.test(gotReq[0]), '两个语言 required 不一致 ⟹ 拒，报文点名 required', gotReq.join(' | '));

  // 形状边角：各报，且对照不报。
  const edge = (name, mutate, re) => {
    const f = clone(FORM_EN); mutate(f);
    const p = one(f);
    check(p.length >= 1 && p.some((x) => re.test(x)), name, p.join(' | ') || '（0 条）');
  };
  edge('自定义字段没有名字（这个语言 labels 里没有它）⟹ 拒', (f) => { delete f.labels.car; }, /"car" 没有名字/);
  edge('text 字段带 options ⟹ 拒（#1770 起按类型拒）', (f) => { f.fields[1].options = ['A']; }, /不认识的键/);
  edge('自定义字段 id 跟内置重名 ⟹ 拒', (f) => { f.fields[1] = { id: 'email', type: 'text' }; f.required = ['name']; f.labels = { 'f-note': 'x', email: 'x' }; }, /重名|不止一次/);
  edge('两个自定义字段同 id ⟹ 拒', (f) => { f.fields.push({ id: 'car', type: 'text' }); }, /不止一次/);
  edge('id 形状不对（空格开头）⟹ 拒', (f) => { f.fields[1] = { id: ' car', type: 'text' }; f.required = ['name']; }, /id/);
  edge(`超过 ${sf.MAX_CUSTOM_FIELDS} 个 ⟹ 拒`, (f) => {
    for (let i = 0; i < sf.MAX_CUSTOM_FIELDS; i += 1) { f.fields.push({ id: `q${i}`, type: 'text' }); f.labels[`q${i}`] = `Q${i}`; }
  }, /最多/);
  edge('required 指向不在 fields 里的字段 ⟹ 拒', (f) => { f.required = ['car', 'service']; }, /required 里有不在 fields 里/);
  edge('labels 里有一个不存在的自定义字段的名字 ⟹ 拒', (f) => { f.labels.ghost = 'Ghost'; }, /词表外/);
  const tenOk = clone(FORM_EN); tenOk.fields = ['phone']; tenOk.required = undefined; tenOk.labels = {};
  for (let i = 0; i < sf.MAX_CUSTOM_FIELDS; i += 1) { tenOk.fields.push({ id: `q${i}`, type: 'text' }); tenOk.labels[`q${i}`] = `Q${i}`; }
  check(one(tenOk).length === 0, `对照：恰好 ${sf.MAX_CUSTOM_FIELDS} 个 ⟹ 过`, one(tenOk).join(' | '));
  // primary / 联系字段那两条照旧只看内置字段
  check(sf.primaryChoices(FORM_EN.fields).join() === 'phone,email' && !sf.lacksContactField(FORM_EN.fields), 'primaryChoices / lacksContactField 对混排的 fields 照旧（自定义字段不算联系字段）');
  const noContact = clone(FORM_EN); noContact.fields = ['name', CAR]; noContact.primary = 'name';
  check(one(noContact).some((x) => /既没有 phone 也没有 email/.test(x)), '「电话和邮箱至少一个」照旧：只有 name + 自定义字段 ⟹ 报');
}

// ══ 存盘：forms-write.js ══════════════════════════════════════════════════════════════════════════
console.log('\n── 存盘（forms-write.js §planFormsWrite）');
{
  const BASE_EN = { id: 'contact', name: 'Contact us', fields: ['name', 'phone', 'email', 'message'], primary: 'phone', buttonText: 'Get in touch' };
  const BASE_ZH = { ...BASE_EN, name: '联系我们', buttonText: '联系' };
  /** 一个 en + zh 双语站的两份 forms.json；`apply(forms, loc)` 以那个语言的身份存一笔（判 + 落盘）。 */
  const setup = () => {
    const site = temp('fcf-site-');
    for (const [loc, f] of [['en', BASE_EN], ['zh', BASE_ZH]]) {
      fs.mkdirSync(path.join(site, loc), { recursive: true });
      fs.writeFileSync(path.join(site, loc, 'forms.json'), `${JSON.stringify([f], null, 2)}\n`);
    }
    const file = (loc) => path.join(site, loc, 'forms.json');
    const plan = (forms, loc = 'en') => fw.planFormsWrite({ target: { locale: loc, localeDir: path.join(site, loc), shape: { locales: ['en', 'zh'] } }, forms });
    const apply = (forms, loc = 'en') => { const ws = plan(forms, loc); for (const w of ws) fs.writeFileSync(w.file, w.content); return ws; };
    const read = (loc) => JSON.parse(fs.readFileSync(file(loc), 'utf-8'))[0];
    const base = (loc = 'en') => { const f = read(loc); return { fields: f.fields, primary: f.primary, ...(f.required ? { required: f.required } : {}) }; };
    return { apply, read, base, file };
  };
  const { apply, read, base, file } = setup();
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', CAR, 'email', 'message'], required: ['car'], labels: { car: 'What car do you drive?' } });
  const en = read('en'); const zh = read('zh');
  check(JSON.stringify(en.fields) === JSON.stringify(['name', 'phone', CAR, 'email', 'message']) && JSON.stringify(zh.fields) === JSON.stringify(en.fields),
    '加一个自定义字段 ⟹ en 与 zh 的 fields 一样（结构写进每个语言）', JSON.stringify(zh.fields));
  check(JSON.stringify(en.required) === '["car"]' && JSON.stringify(zh.required) === '["car"]', 'required 写进每个语言');
  check(en.labels.car === 'What car do you drive?' && zh.labels.car === 'What car do you drive?' && zh.buttonText === '联系',
    'zh 还没有这个字段的名字 ⟹ 先借 en 那一句（不然 zh 那份过不了检查、整笔被拒）；zh 别的字不动');
  check(sf.formsProblems({ en: [read('en')], zh: [read('zh')] }).length === 0, '写完的两份表单库过检查');

  // 只改 zh 的名字 ⟹ 只写 zh；en 一个字节不动
  const enBefore = fs.readFileSync(file('en'), 'utf-8');
  const ws = apply({ id: 'contact', labels: { car: '您开什么车？' } }, 'zh');
  check(ws.length === 1 && ws[0].file === file('zh') && read('zh').labels.car === '您开什么车？' && fs.readFileSync(file('en'), 'utf-8') === enBefore,
    '只改 zh 里这个字段的名字 ⟹ 只写 zh 一份，en 逐字节不变（名字各语言各自翻）', ws.map((w) => w.file).join(', '));

  // 删掉自定义字段 ⟹ 每个语言的名字一起删、required 跟着去掉
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', 'email', 'message'] });
  const en2 = read('en'); const zh2 = read('zh');
  check(!('labels' in en2) && !('labels' in zh2) && !('required' in en2) && !('required' in zh2),
    '删掉自定义字段 ⟹ en / zh 的名字都删、required 里那一项也去掉（没剩东西 ⟹ 键整个删）', JSON.stringify({ en2, zh2 }));

  // 拒收（每格一个新夹具；拒了 ⟹ 磁盘不动）
  const refused = (forms, re, name) => {
    const s2 = setup();
    const before = [fs.readFileSync(s2.file('en'), 'utf-8'), fs.readFileSync(s2.file('zh'), 'utf-8')];
    let e = null;
    try { s2.apply({ id: 'contact', ...(forms.fields || forms.required ? { base: s2.base() } : {}), ...forms }); } catch (x) { e = x; }
    const same = fs.readFileSync(s2.file('en'), 'utf-8') === before[0] && fs.readFileSync(s2.file('zh'), 'utf-8') === before[1];
    check(e && (e.code === fw.REFUSED || e.code === 5) && re.test(e.message) && same, name, e ? `${e.code} ${e.message}` : '没拒');
  };
  // #1770 —— 原来这格用 select（那时不认识）；select 现在合法，换成一个词表外的类型量同一件事。
  refused({ fields: ['phone', { id: 'car', type: 'file' }], labels: { car: 'Car' } }, /type file/, '词表外的 type（file）⟹ 拒收，一个字节不写');
  refused({ fields: ['phone', CAR], required: ['service'] }, /Only a field that is on this form/, 'required 指向表单上没有的字段 ⟹ 拒收');
  refused({ labels: { ghost: 'Ghost' } }, /no field called ghost/, '给一个不存在的自定义字段写名字 ⟹ 拒收');
  refused({ fields: ['phone', { id: 'car', type: 'text', options: ['A'] }], labels: { car: 'Car' } }, /不能带 options/, 'text 字段带 options ⟹ 拒收（#1770 起按类型拒）');

  // 结构的底稿带上 required 一起比（#1644 那道检查）
  {
    const s3 = setup();
    s3.apply({ id: 'contact', base: s3.base(), fields: ['name', 'phone', CAR], required: ['car'], labels: { car: 'Car' } });
    let e = null;
    try { s3.apply({ id: 'contact', base: { fields: s3.read('en').fields, primary: 'phone' }, required: [] }); } catch (x) { e = x; }
    check(e && e.code === fw.STALE, '底稿里漏了磁盘上的 required ⟹ 退出码 10（编辑器手上那份旧了），不写', e ? `${e.code}` : '没拒');
    let e3 = null;
    try { s3.apply({ id: 'contact', base: s3.base(), required: [] }); } catch (x) { e3 = x; }
    check(!e3 && !('required' in s3.read('en')) && !('required' in s3.read('zh')), '对照：底稿对得上 ⟹ 收，required: [] 把键删掉（两个语言）', e3 ? e3.message : '');
  }
}

// ══ 做什么 3 / AC6：访客端渲染 ════════════════════════════════════════════════════════════════════
console.log('\n── 访客端渲染（BlockLeadForm）');
const loadForm = () => { delete require.cache[FORM]; return require(FORM).default; };
{
  const F = loadForm();
  const html = (mode, form = FORM_EN) => renderToStaticMarkup(React.createElement(F, { mode, forms: [form], locale: 'en', siteId: 's', leadApi: 'https://lead.example', idPrefix: 'ct' }));
  const full = html('full');
  const order = Array.from(full.matchAll(/<(?:input|select|textarea)[^>]*\bid="ct-([A-Za-z0-9_-]+)"/g)).map((m) => m[1]).filter((x) => x !== 'hp');
  check(JSON.stringify(order) === JSON.stringify(['name', 'car', 'phone', 'email', 'f-note', 'message']), `full：按 fields 的顺序画，自定义字段夹在中间（${order.join(' / ')}）`);
  const car = (full.match(/<input[^>]*id="ct-car"[^>]*>/) || [''])[0];
  check(/placeholder="What car do you drive\? \*"/.test(car) && /\brequired=""/.test(car) && /aria-required="true"/.test(car) && /type="text"/.test(car) && /class="form-control form-control-lg"/.test(car),
    '必填的自定义字段：type=text、form-control、占位符 = 名字 + 「 *」、带 required', car);
  const note = (full.match(/<input[^>]*id="ct-f-note"[^>]*>/) || [''])[0];
  check(/placeholder="Anything else\?"/.test(note) && !/\brequired/.test(note), '选填的自定义字段：占位符就是名字，不带 required', note);
  const name = (full.match(/<input[^>]*id="ct-name"[^>]*>/) || [''])[0];
  check(/\brequired=""/.test(name) && /placeholder="Name \*"/.test(name), '内置字段也能必填（name 在 required 里）', name);
  check(/<div class="col-12"><input[^>]*id="ct-car"/.test(full), '自定义字段占整行（col-12）');
  const zh = renderToStaticMarkup(React.createElement(F, { mode: 'full', forms: [FORM_ZH], locale: 'zh', siteId: 's', leadApi: 'x', idPrefix: 'ct' }));
  check(/placeholder="您开什么车？ \*"/.test(zh), 'zh 那份表单库 ⟹ 自定义字段的名字是 zh 那句');
  const plain = clone(FORM_EN); delete plain.required;
  check(!/\brequired/.test(html('full', plain)), '反向对照：同一张表单去掉 required ⟹ 一格都不带 required');

  // AC6：teaser 只有 primary
  const teaser = html('teaser');
  const tIds = Array.from(teaser.matchAll(/<(?:input|select|textarea)[^>]*\bid="ct-([A-Za-z0-9_-]+)"/g)).map((m) => m[1]).filter((x) => x !== 'hp');
  check(JSON.stringify(tIds) === '["phone"]' && /<button[^>]*type="submit"/.test(teaser) && !/What car/.test(teaser), `AC6 teaser：只有 primary（${tIds.join(' / ')}）+ 按钮，没有自定义字段`);
  // hero 块真渲染（块 → BlockLeadForm），同一张表单 teaser
  const SITE = { siteId: 't', leadApi: 'https://lead.example', defaultLocale: 'en', locales: ['en'], formsByLocale: { en: [FORM_EN] }, servicesByLocale: { en: [] } };
  const d = clone(DEMO.hero); d.form = { id: 'contact' }; d.options = { ...(d.options || {}), form: 'teaser' };
  const hero = renderToStaticMarkup(React.createElement(Hero, { data: d, locale: 'en', iconTable: {}, site: SITE, block: { id: 'h', type: 'hero', shape: 'lead-form', data: {} } }));
  const hIds = Array.from(hero.matchAll(/<(?:input|select|textarea)[^>]*\bid="hro-([A-Za-z0-9_-]+)"/g)).map((m) => m[1]).filter((x) => x !== 'hp');
  check(JSON.stringify(hIds) === '["phone"]' && /data-form-id="contact"/.test(hero), `AC6 hero 块 teaser：只有 phone（${hIds.join(' / ')}）`);
  d.options.form = 'full';
  const heroFull = renderToStaticMarkup(React.createElement(Hero, { data: d, locale: 'en', iconTable: {}, site: SITE, block: { id: 'h', type: 'hero', shape: 'lead-form', data: {} } }));
  check(/id="hro-car"/.test(heroFull), '反向对照：同一个 hero 块切成 full ⟹ 自定义字段出现');
}

// ══ 提交（happy-dom 真点）══════════════════════════════════════════════════════════════════════════
console.log('\n── 提交（happy-dom）');
(async () => {
  let Window;
  try { ({ Window } = require('happy-dom')); } catch (e) { die(`happy-dom 载入不了：${e.message}`); }
  const run = async (fill) => {
    const win = new Window({ url: 'https://site.example/contact' });
    const g = globalThis;
    const saved = {};
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
      saved[k] = Object.getOwnPropertyDescriptor(g, k);
      Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
    }
    g.IS_REACT_ACT_ENVIRONMENT = true;
    const calls = [];
    win.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
    g.fetch = win.fetch;
    try {
      const F = loadForm();
      const { createRoot } = require('react-dom/client');
      const { act } = require('react');
      const host = win.document.createElement('div');
      win.document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => { root.render(React.createElement(F, { mode: 'full', forms: [FORM_EN], locale: 'en', siteId: 's', leadApi: 'https://lead.example', idPrefix: 'ct' })); });
      const setVal = async (sel, val) => {
        const el = host.querySelector(sel);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
        await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); });
      };
      for (const [sel, v] of Object.entries(fill)) await setVal(sel, v);
      await act(async () => { host.querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const car = host.querySelector('#ct-car');
      return { calls, html: host.innerHTML, carInvalid: car ? car.className.includes('is-invalid') : null, focused: win.document.activeElement && win.document.activeElement.id };
    } finally {
      for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
    }
  };
  try {
    const base = { '#ct-name': 'Pat', '#ct-phone': '416-555-0199', '#ct-message': 'Brakes squeal' };
    const empty = await run(base);
    check(empty.calls.length === 0, '必填的自定义字段没填 ⟹ 不发请求', `发了 ${empty.calls.length} 次`);
    check(empty.carInvalid === true && /data-part="form-error"[^>]*>Please fill in the required fields\.</.test(empty.html) && empty.focused === 'ct-car',
      '那一格标红（is-invalid）、出「Please fill in the required fields.」、光标落到它', `invalid=${empty.carInvalid} focused=${empty.focused}`);
    const blank = await run({ ...base, '#ct-car': '   ' });
    check(blank.calls.length === 0 && blank.carInvalid === true, '只填了空白 ⟹ 同样不发（浏览器自己的 required 拦不住这种）');
    const done = await run({ ...base, '#ct-car': '  2019 Civic ' });
    const body = done.calls[0] ? JSON.parse(done.calls[0].init.body) : {};
    check(done.calls.length === 1 && done.calls[0].url === 'https://lead.example/api/leads', '填了 ⟹ 一次 POST /api/leads');
    check(JSON.stringify(body.meta && body.meta.answers) === JSON.stringify([{ id: 'car', label: 'What car do you drive?', value: '2019 Civic' }]),
      'meta.answers = [{ id, label（此刻的名字）, value（去掉首尾空白）}]；选填那格没填 ⟹ 不带', JSON.stringify(body.meta));
    check(body.meta.formId === 'contact' && body.meta.formName === 'Contact us' && body.meta.formMode === 'full' && body.message === 'Brakes squeal',
      'formId / formName / formMode / message 照旧');
    check(/data-part="form-success"/.test(done.html), '成功提示出现');
    const both = await run({ ...base, '#ct-car': 'Civic', '#ct-f-note': 'Weekends only' });
    const b2 = both.calls[0] ? JSON.parse(both.calls[0].init.body) : {};
    check(JSON.stringify((b2.meta.answers || []).map((a) => a.id)) === '["car","f-note"]', '两格都填 ⟹ answers 两条，按表单上的顺序', JSON.stringify(b2.meta));
    const noName = await run({ '#ct-phone': '416-555-0199', '#ct-car': 'Civic' });
    check(noName.calls.length === 0, '内置字段 name 在 required 里、没填 ⟹ 同样不发');
  } catch (e) {
    bad(`happy-dom 那一段抛了：${e.stack || e.message}`);
  }
  // ══ 做什么 2：编辑器弹窗（FormCopyDialog，happy-dom 真点）════════════════════════════════════════
  console.log('\n── 编辑器：Add custom / Add field / Required（FormCopyDialog）');
  try {
    const DIALOG = path.join(SRC, 'components', 'editor', 'FormCopyEditor.tsx');
    const mount = async (form) => {
      const win = new Window({ url: 'https://site.example/~editor/home' });
      const g = globalThis;
      for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
        Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
      }
      g.IS_REACT_ACT_ENVIRONMENT = true;
      delete require.cache[DIALOG];
      const mod = require(DIALOG);
      const { createRoot } = require('react-dom/client');
      const { act } = require('react');
      const host = win.document.createElement('div');
      win.document.body.appendChild(host);
      const got = { done: undefined };
      const root = createRoot(host);
      await act(async () => { root.render(React.createElement(mod.FormCopyDialog, { form, onCancel: () => {}, onDone: (e) => { got.done = e; } })); });
      const q = (sel) => host.querySelector(sel);
      const click = async (sel) => { const el = q(sel); if (!el) throw new Error(`页面上没有 ${sel}`); await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }); };
      const type = async (sel, val) => {
        const el = q(sel); if (!el) throw new Error(`页面上没有 ${sel}`);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
        await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); });
      };
      const rows = () => [...host.querySelectorAll('[data-editor-form-row]')].map((r) => r.getAttribute('data-editor-form-row'));
      const page = () => q('[data-editor-form-dialog]').getAttribute('data-editor-form-page-on');
      const unmount = async () => { await act(async () => { root.unmount(); }); };
      return { got, q, click, type, rows, page, unmount, apply: mod.applyFormCopyEdit, host };
    };
    const DEF = clone(sf.DEFAULT_SITE_FORMS[0]); // name / phone / email / message，primary phone，没有 required

    // ① Add custom → Add field 页 → Save → 字段列表多一行 → Done 交出去的那一笔
    const d = await mount(clone(DEF));
    await d.click('[data-editor-form-page="fields"]');
    await d.click('[data-editor-form-add-open]');
    check(!!d.q('[data-editor-form-add-custom]'), '「+ Add field」菜单里有 Add custom（内置字段都在用时也有）');
    await d.click('[data-editor-form-add-custom]');
    const opts = [...d.host.querySelectorAll('[data-editor-form-custom-type] option')].map((o) => o.textContent);
    check(d.page() === 'custom:' && d.q('[data-editor-form-title]').textContent.includes('Add field')
      && opts[0] === 'One line' && opts.length === sf.CUSTOM_FIELD_TYPES.length && /A short text answer\./.test(d.host.textContent) && !!d.q('[data-editor-form-custom-required]'),
    `Add field 页：Label 一格 · Type 下拉默认 One line（说明「A short text answer.」，#1770 起六种）· Required 开关（${JSON.stringify(opts)}）`);
    check(d.q('[data-editor-form-custom-save]').disabled, 'Label 空着 ⟹ Save 灰着');
    await d.type('[data-editor-form-custom-label]', 'What car do you drive?');
    await d.click('[data-editor-form-custom-required]');
    await d.click('[data-editor-form-custom-save]');
    const rowsAfter = d.rows();
    const newId = rowsAfter[rowsAfter.length - 1];
    check(d.page() === 'fields' && rowsAfter.length === 5 && sf.CUSTOM_ID_RE.test(newId) && !sf.FORM_FIELDS.includes(newId),
      `Save ⟹ 回到 Form fields，最后多一行（id ${newId}）`, JSON.stringify(rowsAfter));
    check(d.q(`[data-editor-form-row-name="${newId}"]`).textContent === 'What car do you drive?' && !!d.q(`[data-editor-form-required-tag="${newId}"]`),
      '那一行显示名字 + 「Required」标签');
    await d.click('[data-editor-form-done]');
    const e1 = d.got.done || {};
    check(JSON.stringify(e1.fields) === JSON.stringify([...DEF.fields, { id: newId, type: 'text' }]) && e1.primary === 'phone'
      && JSON.stringify(e1.required) === JSON.stringify([newId]) && e1.labels && e1.labels[newId] === 'What car do you drive?',
    'Done ⟹ 交 fields（多一个 { id, type: text }）+ required + 这个语言的名字', JSON.stringify(e1));
    check(JSON.stringify(e1.base) === JSON.stringify({ fields: DEF.fields, primary: DEF.primary }), 'base = 打开时的结构原样（没有 required 键）', JSON.stringify(e1.base));
    // 这一笔交给真的存盘代码：收下、两个语言都过检查（编辑器 → forms-write.js 那一跳）
    {
      const site = temp('fcf-dialog-');
      for (const loc of ['en', 'zh']) { fs.mkdirSync(path.join(site, loc)); fs.writeFileSync(path.join(site, loc, 'forms.json'), JSON.stringify([clone(DEF)])); }
      const ws = fw.planFormsWrite({ target: { locale: 'en', localeDir: path.join(site, 'en'), shape: { locales: ['en', 'zh'] } }, forms: e1 });
      for (const w of ws) fs.writeFileSync(w.file, w.content);
      const byLoc = { en: JSON.parse(fs.readFileSync(path.join(site, 'en', 'forms.json'), 'utf-8')), zh: JSON.parse(fs.readFileSync(path.join(site, 'zh', 'forms.json'), 'utf-8')) };
      check(ws.length === 2 && sf.formsProblems(byLoc).length === 0 && JSON.stringify(byLoc.zh[0].required) === JSON.stringify([newId]),
        '弹窗交的那一笔喂给 forms-write.js §planFormsWrite ⟹ 收下，写两个语言，表单库过检查', sf.formsProblems(byLoc).join(' | '));
      // 画布那一侧（EditorApp §canvasForms 用的 applyFormCopyEdit）：套上这一笔之后 BlockLeadForm 画出那一格
      const applied = d.apply([clone(DEF)], e1)[0];
      const F2 = loadForm();
      const canvas = renderToStaticMarkup(React.createElement(F2, { mode: 'full', forms: [applied], locale: 'en', siteId: 's', leadApi: 'x', idPrefix: 'ct' }));
      const cell = (canvas.match(new RegExp(`<input[^>]*id="ct-${newId}"[^>]*>`)) || [''])[0];
      check(cell.includes('placeholder="What car do you drive? *"') && /\brequired=""/.test(cell),
        'applyFormCopyEdit 套上这一笔 ⟹ 画布上的表单多一格（带「 *」）');
    }
    await d.unmount();

    // ② ← 回去 = 不要了
    const b = await mount(clone(DEF));
    await b.click('[data-editor-form-page="fields"]');
    await b.click('[data-editor-form-add-open]');
    await b.click('[data-editor-form-add-custom]');
    await b.type('[data-editor-form-custom-label]', 'Never saved');
    await b.click('[data-editor-form-back]');
    check(b.page() === 'fields' && b.rows().length === 4, '在 Add field 页点 ← ⟹ 回到列表，什么都没加');
    await b.click('[data-editor-form-done]');
    check(b.got.done === null, '对照：什么都没改 ⟹ Done 交 null');
    await b.unmount();

    // ③ 改一个已有的自定义字段：Edit 打开同一页（带着现值），改名 ⟹ 只交 labels，id 不变、结构不交
    const withCar = { ...clone(DEF), fields: [...DEF.fields, { id: 'car', type: 'text' }], required: ['car'], labels: { car: 'What car do you drive?' } };
    const c = await mount(clone(withCar));
    await c.click('[data-editor-form-page="fields"]');
    await c.click('[data-editor-form-field-edit="car"]');
    check(c.page() === 'custom:car' && c.q('[data-editor-form-custom-label]').value === 'What car do you drive?' && c.q('[data-editor-form-custom-required]').checked,
      '自定义字段那一行的 Edit ⟹ 同一页，带着现在的名字和 Required');
    await c.type('[data-editor-form-custom-label]', 'Which vehicle?');
    await c.click('[data-editor-form-custom-save]');
    await c.click('[data-editor-form-done]');
    check(JSON.stringify(c.got.done) === JSON.stringify({ id: 'contact', labels: { car: 'Which vehicle?' } }), '改名 ⟹ 只交这一格名字（id 不变，结构不交）', JSON.stringify(c.got.done));
    await c.unmount();

    // ④ 内置字段的那一页有 Required；⑤ 删掉自定义字段 ⟹ required 跟着去掉、它的名字不交
    const r = await mount(clone(withCar));
    await r.click('[data-editor-form-page="fields"]');
    await r.click('[data-editor-form-field-edit="name"]');
    check(!!r.q('[data-editor-form-required="name"]') && !r.q('[data-editor-form-required="name"]').checked, '内置字段（name）的 Edit 页有 Required 开关，现在是关的');
    await r.click('[data-editor-form-required="name"]');
    await r.click('[data-editor-form-back]');
    await r.click('[data-editor-form-remove="car"]');
    await r.click('[data-editor-form-done]');
    const e4 = r.got.done || {};
    check(JSON.stringify(e4.required) === '["name"]' && JSON.stringify(e4.fields) === JSON.stringify(DEF.fields) && !(e4.labels && 'car' in e4.labels)
      && JSON.stringify(e4.base) === JSON.stringify({ fields: withCar.fields, primary: 'phone', required: ['car'] }),
    '开 name 的 Required、删 car ⟹ required = [name]、fields 不含 car、不交 car 的名字；base 带着打开时的 required', JSON.stringify(e4));
    await r.unmount();
  } catch (e) {
    bad(`编辑器弹窗那一段抛了：${e.stack || e.message}`);
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail === 0 ? 0 : 1);
})();
