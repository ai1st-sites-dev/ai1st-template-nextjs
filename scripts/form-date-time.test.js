#!/usr/bin/env node
/**
 * form-date-time.test.js — #1792 表单的 Date 字段可以多问一个时间（`{ id, type: 'date', time: true }`），模板这一侧的几条。
 * 六种类型本身的几条在 form-custom-field-types.test.js（#1770），这里不重抄。
 *
 * 跑法:  node scripts/form-date-time.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条（正文验收）：
 *   验收 5   表单校验（`site-forms.js`）：date 带 time:true ⟹ 过；text / select 带 time ⟹ 拒；date 带 time:false / "yes" ⟹ 拒。
 *   验收 1   存盘（`forms-write.js`）：PM 点名的两道门 —— 未知键检查（`:100`）和逐键重建（`:136`）。加一个带时间的 Date
 *            ⟹ 两个语言的 forms.json 里那一格都是 `{"id","type":"date","time":true}`；换成 One line ⟹ `time` 键不在；
 *            非 date 带 time / time 不是 true ⟹ 拒收、一个字节不写。
 *   做什么 3 访客端（`BlockLeadForm.tsx`）：勾了 ⟹ 日期框右边一个 `<input type="time">`（≥576 并排各半、更窄上下叠的那套类名），
 *            时间框永远不带 required；没勾 ⟹ 跟 #1770 那一版逐字节相同（验收 4）。
 *   验收 3   提交（happy-dom 真点）：必填 + 勾时间：只选日期 ⟹ `YYYY-MM-DD`；日期 + 14:30 ⟹ `YYYY-MM-DD 14:30`；
 *            只选时间 ⟹ 不发、日期框标红；选填 + 只选时间 ⟹ 照发、这一格不进答案。
 *   做什么 2 编辑器（`FormCopyEditor.tsx`）：Type = Date 才有 Also ask for a time（下面那行灰字）；勾上 Save → Done 交的那一格带
 *            `time: true`，喂给真的 planFormsWrite 收下；Edit 打开带着勾；换成 One line ⟹ 这一行不出、交的那一格没有 `time`。
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

// ── 让 node 能 require .tsx（同 form-custom-field-types.test.js；stub 目录名各用各的，并发跑不撞）──
const STUB_DIR = path.join(NEXT, 'scripts', '.form-date-time-stubs');
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

let sf; let fw; let labels;
try {
  sf = require(path.join(NEXT, 'scripts', 'lib', 'site-forms.js'));
  fw = require(path.join(NEXT, 'scripts', 'lib', 'forms-write.js'));
  labels = require(path.join(SRC, 'lib', 'component-labels.ts'));
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

const DAY = { id: 'day', type: 'date', time: true };
/** 夹具：电话 + 一格带时间的日期（必填）。 */
const FORM_EN = { id: 'contact', name: 'Contact us', fields: ['phone', DAY], primary: 'phone', required: ['day'], labels: { day: 'Preferred date' } };

// ══ 验收 5：表单校验 ═══════════════════════════════════════════════════════════════════════════
console.log('── 验收 5 表单校验（site-forms.js）');
{
  const one = (f) => sf.formListProblems([f]);
  const only = (field, lab) => ({ id: 'contact', name: 'C', fields: ['phone', field], primary: 'phone', labels: lab });
  const p0 = one(clone(FORM_EN));
  check(p0.length === 0, 'date 带 time:true ⟹ 过', p0.join(' | '));
  const pPlain = one(only({ id: 'day', type: 'date' }, { day: 'Day' }));
  check(pPlain.length === 0, '对照：不带 time 的 date ⟹ 照旧过', pPlain.join(' | '));
  const pText = one(only({ id: 'q', type: 'text', time: true }, { q: 'Q' }));
  check(pText.length === 1 && /不认识的键/.test(pText[0]) && /time/.test(pText[0]), 'text 带 time ⟹ 拒（报一条，点名 time）', pText.join(' | '));
  const pSel = one(only({ id: 'car', type: 'select', options: ['o-a', 'o-b'], time: true }, { car: 'Car', 'car.o-a': 'A', 'car.o-b': 'B' }));
  check(pSel.length === 1 && /不认识的键/.test(pSel[0]) && /time/.test(pSel[0]), 'select 带 time ⟹ 拒', pSel.join(' | '));
  for (const v of [false, 'yes', 1]) {
    const p = one(only({ id: 'day', type: 'date', time: v }, { day: 'Day' }));
    check(p.length === 1 && /time 只能是 true/.test(p[0]), `date 带 time:${JSON.stringify(v)} ⟹ 拒（不问时间就不带这个键）`, p.join(' | '));
  }
  const two = sf.formsProblems({ en: [clone(FORM_EN)], zh: [{ ...clone(FORM_EN), labels: { day: '希望的日期' } }] });
  check(two.length === 0, '两个语言同一份结构（都带 time）⟹ 过', two.join(' | '));
  const half = sf.formsProblems({ en: [clone(FORM_EN)], zh: [{ ...clone(FORM_EN), fields: ['phone', { id: 'day', type: 'date' }], labels: { day: '希望的日期' } }] });
  check(half.length === 1 && /fields/.test(half[0]), '一个语言带 time、另一个不带 ⟹ 拒（time 是结构，各语言一致）', half.join(' | '));
}

// ══ 验收 1：存盘（forms-write.js 那两道门）════════════════════════════════════════════════════════
console.log('\n── 验收 1 存盘（forms-write.js §planFormsWrite）');
{
  const BASE_EN = { id: 'contact', name: 'Contact us', fields: ['name', 'phone', 'email', 'message'], primary: 'phone', buttonText: 'Get in touch' };
  const BASE_ZH = { ...BASE_EN, name: '联系我们', buttonText: '联系' };
  const setup = () => {
    const site = temp('fdt-site-');
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
  const { apply, read, base } = setup();
  let threw = null;
  try { apply({ id: 'contact', base: base(), fields: ['name', 'phone', clone(DAY), 'email'], required: ['day'], labels: { day: 'Preferred date' } }); } catch (e) { threw = e; }
  check(!threw, '加一格带时间的 Date ⟹ 收下（:100 的未知键检查放行 time）', threw ? `${threw.code} ${threw.message}` : '');
  check(JSON.stringify(read('en').fields[2]) === '{"id":"day","type":"date","time":true}' && JSON.stringify(read('zh').fields) === JSON.stringify(read('en').fields),
    'en / zh 的 forms.json 里那一格都是 {"id":"day","type":"date","time":true}（:136 的逐键重建把 time 搬过去了）', JSON.stringify(read('zh').fields));
  check(sf.formsProblems({ en: [read('en')], zh: [read('zh')] }).length === 0, '写完的两份表单库过检查');

  // 后面几笔接着上一笔的磁盘状态：上一笔被拒（变异臂里会这样）时它们会抛 —— 记一格红，别让进程半路退出、后面几段没跑。
  try {
    apply({ id: 'contact', base: base(), fields: ['name', 'phone', { id: 'day', type: 'text' }, 'email'], required: ['day'] });
    check(JSON.stringify(read('en').fields[2]) === '{"id":"day","type":"text"}' && JSON.stringify(read('zh').fields[2]) === '{"id":"day","type":"text"}',
      '换成 One line（不带 time）⟹ 两个语言里 time 键都不在', JSON.stringify(read('en').fields[2]));
    apply({ id: 'contact', base: base(), fields: ['name', 'phone', { id: 'day', type: 'date', time: true }, 'email'], required: ['day'] });
    apply({ id: 'contact', base: base(), fields: ['name', 'phone', { id: 'day', type: 'date' }, 'email'], required: ['day'] });
    check(JSON.stringify(read('en').fields[2]) === '{"id":"day","type":"date"}', '取消勾选（date 不带 time）⟹ 存下的那一格没有 time 键', JSON.stringify(read('en').fields[2]));
  } catch (e) {
    bad(`换类型 / 取消勾那几笔抛了：${e.code || ''} ${e.message}`);
  }

  const refused = (field, re, name) => {
    const s2 = setup();
    const before = [fs.readFileSync(s2.file('en'), 'utf-8'), fs.readFileSync(s2.file('zh'), 'utf-8')];
    let e = null;
    try { s2.apply({ id: 'contact', base: s2.base(), fields: ['phone', field], labels: { [field.id]: 'Q' } }); } catch (x) { e = x; }
    const same = fs.readFileSync(s2.file('en'), 'utf-8') === before[0] && fs.readFileSync(s2.file('zh'), 'utf-8') === before[1];
    check(e && e.code === 5 && re.test(e.message) && same, name, e ? `${e.code} ${e.message}` : '没拒');
  };
  refused({ id: 'q', type: 'text', time: true }, /time 只有 date 能带/, 'text 带 time ⟹ 拒收（exit 5），一个字节不写');
  refused({ id: 'q', type: 'date', time: 'yes' }, /time 只有 date 能带、而且只能是 true/, 'date 带 time:"yes" ⟹ 拒收，一个字节不写');
}

// ══ 做什么 3：访客端渲染 ════════════════════════════════════════════════════════════════════════
console.log('\n── 访客端渲染（BlockLeadForm）');
const loadForm = () => { delete require.cache[FORM]; return require(FORM).default; };
{
  const F = loadForm();
  const html = (form, locale = 'en') => renderToStaticMarkup(React.createElement(F, { mode: 'full', forms: [form], locale, siteId: 's', leadApi: 'x', idPrefix: 'ct' }));
  const on = html(clone(FORM_EN));
  const row = (on.match(/<div class="row g-2" data-field-datetime="day">[\s\S]*?<\/div><\/div><\/div>/) || [''])[0];
  const cols = Array.from(row.matchAll(/<div class="col-12 col-sm-6">/g)).length;
  const dateIn = (row.match(/<input[^>]*id="ct-day"[^>]*>/) || [''])[0];
  const timeIn = (row.match(/<input[^>]*id="ct-day-time"[^>]*>/) || [''])[0];
  check(cols === 2 && row.indexOf('id="ct-day"') < row.indexOf('id="ct-day-time"'),
    '勾了 ⟹ 一行两格（col-12 col-sm-6：≥576 并排各半，更窄上下叠），日期在左、时间在右', row || on);
  check(/type="date"/.test(dateIn) && /\brequired=""/.test(dateIn), '日期框照旧是 type=date，必填带 required', dateIn);
  check(/type="time"/.test(timeIn) && !/required/.test(timeIn) && /aria-label="Preferred date – Time"/.test(timeIn),
    '时间框 type=time、不带 required（Required 只管日期）、读屏名字「Preferred date – Time」', timeIn);
  // PM 裁定第 4 条：`step` 不在档上的值会被浏览器用它自己的语言拦下整张表单（Chromium 实测 step=900 + 14:37）⟹ 不写 step。
  check(!/\bstep=/.test(timeIn), '时间框不带 step（手打 14:37 不会被浏览器拦下，e2e 在真 Chromium 里量）', timeIn);
  const zhTime = (html({ ...clone(FORM_EN), labels: { day: '希望的日期' } }, 'zh').match(/<input[^>]*id="ct-day-time"[^>]*>/) || [''])[0];
  check(/aria-label="希望的日期 – 时间"/.test(zhTime), 'zh ⟹ 读屏名字里那个词是「时间」', zhTime);
  const LOCS = Object.keys(labels.COMPONENT_LABELS);
  const missing = LOCS.filter((l) => !(typeof labels.COMPONENT_LABELS[l].formTime === 'string' && labels.COMPONENT_LABELS[l].formTime.trim()));
  check(LOCS.length === 14 && missing.length === 0, `formTime 在 ${LOCS.length} 种语言里都有`, `缺 ${missing.join(', ')}`);
  // 验收 4：没勾 ⟹ 跟 #1770 那一版逐字节相同（这一串是 #1770 的 BlockLeadForm 对同一张表单画出来的那一格）
  const off = html({ ...clone(FORM_EN), fields: ['phone', { id: 'day', type: 'date' }] });
  const cell = (off.match(/<label[^>]*for="ct-day"[^>]*>[^<]*<\/label><input[^>]*>/) || [''])[0];
  const want = '<label for="ct-day" class="form-label mb-1">Preferred date *</label><input id="ct-day" class="form-control form-control-lg" type="date" aria-label="Preferred date" data-field="day" required="" aria-required="true" value=""/>';
  check(cell === want && !/type="time"/.test(off) && !/data-field-datetime/.test(off), '没勾 ⟹ 那一格跟 #1770 逐字节相同、没有时间框', cell);
}

// ══ 验收 3：提交（happy-dom 真点）════════════════════════════════════════════════════════════════
console.log('\n── 验收 3 提交（happy-dom）');
(async () => {
  let Window;
  try { ({ Window } = require('happy-dom')); } catch (e) { die(`happy-dom 载入不了：${e.message}`); }
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent'];
  const run = async (form, act1) => {
    const win = new Window({ url: 'https://site.example/contact' });
    const g = globalThis;
    const saved = {};
    for (const k of globals) { saved[k] = Object.getOwnPropertyDescriptor(g, k); Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true }); }
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
      await act(async () => { root.render(React.createElement(F, { mode: 'full', forms: [form], locale: 'en', siteId: 's', leadApi: 'https://lead.example', idPrefix: 'ct' })); });
      const setVal = async (sel, val) => {
        const el = host.querySelector(sel);
        if (!el) throw new Error(`页面上没有 ${sel}`);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
        await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); });
      };
      await act1({ setVal });
      await act(async () => { host.querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const cls = (sel) => (host.querySelector(sel) ? host.querySelector(sel).className : '');
      const answers = calls[0] ? (JSON.parse(calls[0].init.body).meta || {}).answers : undefined;
      return { calls, answers, html: host.innerHTML, cls };
    } finally {
      for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
    }
  };
  try {
    const phone = async ({ setVal }) => { await setVal('#ct-phone', '416-555-0199'); };
    const dOnly = await run(clone(FORM_EN), async (u) => { await phone(u); await u.setVal('#ct-day', '2026-10-20'); });
    check(dOnly.calls.length === 1 && JSON.stringify(dOnly.answers) === '[{"id":"day","label":"Preferred date","value":"2026-10-20"}]',
      '必填 + 勾时间：只选日期 ⟹ 交得出去，答案 2026-10-20', JSON.stringify(dOnly.answers));
    const both = await run(clone(FORM_EN), async (u) => { await phone(u); await u.setVal('#ct-day', '2026-10-20'); await u.setVal('#ct-day-time', '14:30'); });
    check(both.calls.length === 1 && JSON.stringify(both.answers) === '[{"id":"day","label":"Preferred date","value":"2026-10-20 14:30"}]',
      '日期 + 14:30 ⟹ 答案 2026-10-20 14:30（24 小时制，一个空格隔开）', JSON.stringify(both.answers));
    const tOnly = await run(clone(FORM_EN), async (u) => { await phone(u); await u.setVal('#ct-day-time', '14:30'); });
    check(tOnly.calls.length === 0 && /is-invalid/.test(tOnly.cls('#ct-day')) && !/is-invalid/.test(tOnly.cls('#ct-day-time'))
      && /Please fill in the required fields\./.test(tOnly.html),
    '只选时间 ⟹ 不发；日期框标红（时间框不红），出「请填必填项」', `calls=${tOnly.calls.length} day=${tOnly.cls('#ct-day')}`);
    const optional = { ...clone(FORM_EN), required: [] };
    const optT = await run(optional, async (u) => { await phone(u); await u.setVal('#ct-day-time', '09:15'); });
    check(optT.calls.length === 1 && optT.answers === undefined, '选填 + 只选时间 ⟹ 照发，这一格不进答案（当没填）', JSON.stringify(optT.answers));
    // 对照：没勾时间的 Date ⟹ 跟 #1770 一样只交日期，页面上根本没有时间框
    const plain = await run({ ...clone(FORM_EN), fields: ['phone', { id: 'day', type: 'date' }] }, async (u) => { await phone(u); await u.setVal('#ct-day', '2026-10-20'); });
    check(plain.calls.length === 1 && JSON.stringify(plain.answers) === '[{"id":"day","label":"Preferred date","value":"2026-10-20"}]' && !/ct-day-time/.test(plain.html),
      '对照：没勾时间 ⟹ 答案 2026-10-20、没有时间框（#1770 原样）', JSON.stringify(plain.answers));
  } catch (e) {
    bad(`提交那一段抛了：${e.stack || e.message}`);
  }

  // ══ 做什么 2 / 验收 1：编辑器 Add field / Edit field 页（happy-dom 真点）══════════════════════════════
  console.log('\n── 编辑器：Also ask for a time（FormCopyDialog）');
  try {
    const DIALOG = path.join(SRC, 'components', 'editor', 'FormCopyEditor.tsx');
    const mount = async (form) => {
      const win = new Window({ url: 'https://site.example/~editor/home' });
      const g = globalThis;
      for (const k of globals) Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
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
      const qa = (sel) => [...host.querySelectorAll(sel)];
      const click = async (sel) => { const el = q(sel); if (!el) throw new Error(`页面上没有 ${sel}`); await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }); };
      const setVal = async (sel, val, ev = 'input') => {
        const el = q(sel); if (!el) throw new Error(`页面上没有 ${sel}`);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
        await act(async () => { el.dispatchEvent(new win.Event(ev, { bubbles: true })); });
      };
      const unmount = async () => { await act(async () => { root.unmount(); }); };
      return { got, q, qa, click, setVal, unmount, host };
    };
    const TIME = '[data-editor-form-custom-time]';
    const DEF = clone(sf.DEFAULT_SITE_FORMS[0]);
    const d = await mount(clone(DEF));
    await d.click('[data-editor-form-page="fields"]');
    await d.click('[data-editor-form-add-open]');
    check(!d.q(TIME), 'Type = One line ⟹ 没有 Also ask for a time');
    for (const t of ['textarea', 'select', 'checkbox', 'radio']) {
      await d.setVal('[data-editor-form-custom-type]', t, 'change');
      if (d.q(TIME)) { bad(`Type = ${t} 时也出了 Also ask for a time`); break; }
    }
    await d.setVal('[data-editor-form-custom-type]', 'date', 'change');
    const box = d.q(TIME);
    const row = box ? box.closest('label') : null;
    const req = d.q('[data-editor-form-custom-required]');
    check(box && !box.checked && /Also ask for a time/.test(row.textContent) && /Visitors can leave the time empty\./.test(row.textContent)
      && (row.compareDocumentPosition(req) & 4) !== 0,
    'Type = Date ⟹ 出 Also ask for a time + 灰字 Visitors can leave the time empty.，默认不勾，在 Required 上面', row ? row.textContent : '没出');
    await d.click(TIME);
    await d.setVal('[data-editor-form-custom-label]', 'Preferred date');
    await d.click('[data-editor-form-custom-required]');
    await d.click('[data-editor-form-custom-save]');
    const fid = d.qa('[data-editor-form-row]').map((r) => r.getAttribute('data-editor-form-row')).pop();
    await d.click('[data-editor-form-done]');
    const e1 = d.got.done || {};
    const field = (e1.fields || []).find((x) => typeof x === 'object');
    check(JSON.stringify(field) === JSON.stringify({ id: fid, type: 'date', time: true }), '勾上 → Add field → Done ⟹ 交的那一格是 { id, type: date, time: true }', JSON.stringify(field));
    {
      const site = temp('fdt-dialog-');
      for (const loc of ['en', 'zh']) { fs.mkdirSync(path.join(site, loc)); fs.writeFileSync(path.join(site, loc, 'forms.json'), JSON.stringify([clone(DEF)])); }
      const ws = fw.planFormsWrite({ target: { locale: 'en', localeDir: path.join(site, 'en'), shape: { locales: ['en', 'zh'] } }, forms: e1 });
      for (const w of ws) fs.writeFileSync(w.file, w.content);
      const onDisk = JSON.parse(fs.readFileSync(path.join(site, 'zh', 'forms.json'), 'utf-8'))[0].fields.find((x) => typeof x === 'object');
      check(ws.length === 2 && JSON.stringify(onDisk) === JSON.stringify({ id: fid, type: 'date', time: true }),
        '弹窗交的那一笔喂给真的 planFormsWrite ⟹ 两个语言的 forms.json 里都是 {"type":"date","time":true}', JSON.stringify(onDisk));
    }
    await d.unmount();

    // Edit 一个带时间的 Date ⟹ 勾着；换成 One line ⟹ 这一行不出，交的那一格没有 time
    const withDay = { ...clone(DEF), fields: [...DEF.fields, clone(DAY)], labels: { day: 'Preferred date' } };
    const c = await mount(clone(withDay));
    await c.click('[data-editor-form-page="fields"]');
    await c.click('[data-editor-form-field-edit="day"]');
    check(c.q(TIME) && c.q(TIME).checked, 'Edit 一个带时间的 Date ⟹ Also ask for a time 勾着');
    await c.setVal('[data-editor-form-custom-type]', 'text', 'change');
    check(!c.q(TIME), '换成 One line ⟹ 这一行不出');
    await c.click('[data-editor-form-custom-save]');
    await c.click('[data-editor-form-done]');
    const f2 = ((c.got.done || {}).fields || []).find((x) => typeof x === 'object');
    check(JSON.stringify(f2) === '{"id":"day","type":"text"}', '存下 ⟹ 交的那一格是 {"id":"day","type":"text"}，没有 time', JSON.stringify(f2));
    await c.unmount();

    // 取消勾 ⟹ 交的那一格没有 time（不是 time:false）
    const u = await mount(clone(withDay));
    await u.click('[data-editor-form-page="fields"]');
    await u.click('[data-editor-form-field-edit="day"]');
    await u.click(TIME);
    await u.click('[data-editor-form-custom-save]');
    await u.click('[data-editor-form-done]');
    const f3 = ((u.got.done || {}).fields || []).find((x) => typeof x === 'object');
    check(JSON.stringify(f3) === '{"id":"day","type":"date"}', '取消勾 → Save → Done ⟹ 交 {"id":"day","type":"date"}（没有 time 键，不是 false）', JSON.stringify(f3));
    await u.unmount();
  } catch (e) {
    bad(`编辑器那一段抛了：${e.stack || e.message}`);
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail === 0 ? 0 : 1);
})();
