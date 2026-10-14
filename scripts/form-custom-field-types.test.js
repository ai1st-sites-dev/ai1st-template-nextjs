#!/usr/bin/env node
/**
 * form-custom-field-types.test.js — #1770（T10r-2）自定义字段补齐另外五种类型（多行 · 下拉 · 多选 · 单选 · 日期）+ 选项列表，
 * 模板这一侧的几条。#1769 那一种（text）的几条在 form-custom-fields.test.js，这里不重抄。
 *
 * 跑法:  node scripts/form-custom-field-types.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 管哪几条：
 *   AC1  表单校验（`site-forms.js`）：五种新类型各一条合法的过；select / checkbox / radio 只有 1 个选项 ⟹ 拒；两个语言同一个字段
 *        选项数不一致 ⟹ 拒；text 带 options ⟹ 拒；外加选项的边角（没文字 / 重复 / 超个数 / 文字指向不存在的选项）。
 *        🔴 变异臂：把新类型从允许表（§CUSTOM_FIELD_TYPES）里拿掉 ⟹ 第一格红（证明这把尺在量类型，不是恒绿）。
 *   存盘（`forms-write.js`）：加一个下拉 ⟹ 结构（含选项 id）写进每个语言、选项文字只写这个语言（别的语言先借）；只改 zh 的选项文字
 *        ⟹ en 一个字节不动；拖动排序 ⟹ 两个语言顺序一起变、zh 的文字不串位；删一个选项 / 改成不带选项的类型 ⟹ 每个语言的文字一起删；
 *        1 个选项 / 11 个选项 / text 带 options ⟹ 拒收。
 *   做什么 3（访客端，`BlockLeadForm.tsx`）：五种各画对应的控件；text 那一种一个字节不变（maxLength 仍是 200）。
 *   做什么 4（提交，happy-dom 真点）：必填的下拉 / 多选没选 ⟹ 不发、标红；下拉 / 单选交选项此刻的文字；多选按表单上的顺序「, 」连起来；
 *        日期原样 YYYY-MM-DD；多行字原样。
 *   做什么 2 / 7（编辑器，`FormCopyEditor.tsx`）：Type 六选一；选 Dropdown ⟹ 出选项列表（先放 Option 1 / Option 2）；加 / 改 / 删（剩 2 项删不了）；
 *        Save → Done 交的那一笔喂给真的 planFormsWrite 收下；改成不带选项的类型 ⟹ 选项连同文字一起去掉。拖动排序在 e2e（1770 spec）里量。
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

// ── 让 node 能 require .tsx（同 form-custom-fields.test.js 的做法；stub 目录名各用各的，并发跑不撞）──
const STUB_DIR = path.join(NEXT, 'scripts', '.form-custom-field-types-stubs');
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

let sf; let fw;
try {
  sf = require(path.join(NEXT, 'scripts', 'lib', 'site-forms.js'));
  fw = require(path.join(NEXT, 'scripts', 'lib', 'forms-write.js'));
} catch (e) { die(`载入失败: ${e.stack || e.message}`); }

const SEL = { id: 'car', type: 'select', options: ['o-toy', 'o-hon', 'o-for'] };
const BOX = { id: 'days', type: 'checkbox', options: ['o-mon', 'o-sat'] };
const RAD = { id: 'when', type: 'radio', options: ['o-am', 'o-pm'] };
const AREA = { id: 'more', type: 'textarea' };
const DATE = { id: 'day', type: 'date' };
const LABELS_EN = {
  car: 'What car do you drive?', 'car.o-toy': 'Toyota', 'car.o-hon': 'Honda', 'car.o-for': 'Ford',
  days: 'Which days work?', 'days.o-mon': 'Monday', 'days.o-sat': 'Saturday',
  when: 'Morning or afternoon?', 'when.o-am': 'Morning', 'when.o-pm': 'Afternoon',
  more: 'Tell us more', day: 'Preferred date',
};
/** 夹具：电话 + 五种新类型，下拉和多选必填。 */
const FORM_EN = {
  id: 'contact', name: 'Contact us', fields: ['phone', SEL, BOX, RAD, AREA, DATE], primary: 'phone',
  required: ['car', 'days'], labels: clone(LABELS_EN),
};
const FORM_ZH = {
  ...clone(FORM_EN), name: '联系我们',
  labels: { car: '您开什么车？', 'car.o-toy': '丰田', 'car.o-hon': '本田', 'car.o-for': '福特', days: '哪几天方便？', 'days.o-mon': '周一', 'days.o-sat': '周六',
    when: '上午还是下午？', 'when.o-am': '上午', 'when.o-pm': '下午', more: '再说说', day: '希望的日期' },
};

// ══ AC1：表单校验 ═══════════════════════════════════════════════════════════════════════════════
console.log('── AC1 表单校验（site-forms.js）');
{
  const one = (f) => sf.formListProblems([f]);
  const only = (field, labels) => ({ id: 'contact', name: 'C', fields: ['phone', field], primary: 'phone', labels });
  const LEGAL = {
    textarea: only(AREA, { more: 'Tell us more' }),
    select: only(SEL, { car: 'Car', 'car.o-toy': 'Toyota', 'car.o-hon': 'Honda', 'car.o-for': 'Ford' }),
    checkbox: only(BOX, { days: 'Days', 'days.o-mon': 'Mon', 'days.o-sat': 'Sat' }),
    radio: only(RAD, { when: 'When', 'when.o-am': 'AM', 'when.o-pm': 'PM' }),
    date: only(DATE, { day: 'Day' }),
  };
  const firstCell = () => Object.entries(LEGAL).map(([t, f]) => [t, one(clone(f))]);
  for (const [t, p] of firstCell()) check(p.length === 0, `${t}：一条合法的 ⟹ 过`, p.join(' | '));
  // 🔴 变异臂：把新类型逐个从允许表里拿掉（同一个数组对象，校验读的就是它）⟹ 上面那一格必须红；放回去再绿。
  for (const t of Object.keys(LEGAL)) {
    const i = sf.CUSTOM_FIELD_TYPES.indexOf(t);
    sf.CUSTOM_FIELD_TYPES.splice(i, 1);
    const p = one(clone(LEGAL[t]));
    sf.CUSTOM_FIELD_TYPES.splice(i, 0, t);
    check(p.some((x) => /type/.test(x) && /不认识/.test(x)), `变异臂：允许表里拿掉 ${t} ⟹ 那一格红（报 type 不认识）`, p.join(' | ') || '（0 条 —— 尺子恒绿）');
  }
  check(firstCell().every(([, p]) => p.length === 0), '变异臂收尾：放回去之后五格照旧过（没把允许表弄坏）');
  check(one(clone(FORM_EN)).length === 0, '五种混排、带 required（下拉 + 多选）⟹ 过', one(clone(FORM_EN)).join(' | '));

  for (const t of ['select', 'checkbox', 'radio']) {
    const f = clone(LEGAL[t]); const c = f.fields[1];
    for (const o of c.options.slice(1)) delete f.labels[sf.optionLabelKey(c.id, o)]; // 删掉的选项连文字一起删，只量「个数」这一条
    c.options = c.options.slice(0, 1);
    const p = one(f);
    check(p.length === 1 && /1 个选项/.test(p[0]), `${t} 只有 1 个选项 ⟹ 拒（报一条）`, p.join(' | '));
  }
  const two = sf.formsProblems({ en: [clone(FORM_EN)], zh: [clone(FORM_ZH)] });
  check(two.length === 0, '对照：两个语言同一份结构、选项文字各自翻 ⟹ 过', two.join(' | '));
  const zhShort = clone(FORM_ZH); zhShort.fields[1].options = ['o-toy', 'o-hon']; delete zhShort.labels['car.o-for'];
  const gotCount = sf.formsProblems({ en: [clone(FORM_EN)], zh: [zhShort] });
  check(gotCount.length === 1 && /contact/.test(gotCount[0]) && /fields/.test(gotCount[0]) && /en/.test(gotCount[0]) && /zh/.test(gotCount[0]),
    '两个语言同一张表单的同一个字段选项数不一致 ⟹ 拒（报一条）', gotCount.join(' | '));
  const zhOrder = clone(FORM_ZH); zhOrder.fields[1].options = ['o-hon', 'o-toy', 'o-for'];
  check(sf.formsProblems({ en: [clone(FORM_EN)], zh: [zhOrder] }).length === 1, '两个语言选项顺序不一致 ⟹ 同样拒（顺序也是结构）');
  const textOpt = only({ id: 'q', type: 'text', options: ['o-a', 'o-b'] }, { q: 'Q', 'q.o-a': 'A', 'q.o-b': 'B' });
  const pText = one(textOpt);
  check(pText.some((x) => /不认识的键/.test(x) && /options/.test(x)), 'text 带 options ⟹ 拒', pText.join(' | '));
  for (const t of ['textarea', 'date']) {
    const f = clone(LEGAL[t]); f.fields[1].options = ['o-a', 'o-b']; f.labels[`${f.fields[1].id}.o-a`] = 'A'; f.labels[`${f.fields[1].id}.o-b`] = 'B';
    check(one(f).some((x) => /不认识的键/.test(x)), `${t} 带 options ⟹ 拒`);
  }
  const edge = (name, mutate, re) => {
    const f = clone(FORM_EN); mutate(f);
    const p = one(f);
    check(p.some((x) => re.test(x)), name, p.join(' | ') || '（0 条）');
  };
  edge('选项在这个语言里没有文字 ⟹ 拒', (f) => { delete f.labels['car.o-for']; }, /选项 "o-for" 没有文字/);
  edge('select 没有 options ⟹ 拒', (f) => { delete f.fields[1].options; }, /options 必须是选项 id 的数组/);
  edge('选项 id 重复 ⟹ 拒', (f) => { f.fields[1].options = ['o-toy', 'o-toy', 'o-hon']; }, /重复的选项 id/);
  edge('选项 id 形状不对（带点）⟹ 拒', (f) => { f.fields[1].options = ['o.toy', 'o-hon']; }, /options 必须是选项 id 的数组/);
  edge(`超过 ${sf.MAX_OPTIONS} 个选项 ⟹ 拒`, (f) => {
    for (let i = 0; i < sf.MAX_OPTIONS; i += 1) { f.fields[1].options.push(`o-x${i}`); f.labels[`car.o-x${i}`] = `X${i}`; }
  }, /要 2~10 个/);
  edge('labels 里有一个不存在的选项的文字 ⟹ 拒', (f) => { f.labels['car.o-ghost'] = 'Ghost'; }, /词表外/);
  edge(`选项文字超过 ${sf.LABEL_CAP} 字 ⟹ 拒`, (f) => { f.labels['car.o-toy'] = 'x'.repeat(sf.LABEL_CAP + 1); }, /labels\.car\.o-toy 必须是/);
  const tenOk = clone(FORM_EN);
  tenOk.fields[1].options = []; for (let i = 0; i < sf.MAX_OPTIONS; i += 1) { tenOk.fields[1].options.push(`o-x${i}`); tenOk.labels[`car.o-x${i}`] = 'x'.repeat(sf.LABEL_CAP); }
  for (const k of ['car.o-toy', 'car.o-hon', 'car.o-for']) delete tenOk.labels[k];
  check(one(tenOk).length === 0, `对照：恰好 ${sf.MAX_OPTIONS} 个选项、每项恰好 ${sf.LABEL_CAP} 字 ⟹ 过`, one(tenOk).join(' | '));
  check(sf.optionLabelKey('car', 'o-toy') === 'car.o-toy' && !sf.CUSTOM_ID_RE.test('car.o-toy'), '选项文字的键 = 字段id.选项id，且这个键按构造不可能是一个字段 id（不撞）');
}

// ══ 存盘：forms-write.js ══════════════════════════════════════════════════════════════════════════
console.log('\n── 存盘（forms-write.js §planFormsWrite）');
{
  const BASE_EN = { id: 'contact', name: 'Contact us', fields: ['name', 'phone', 'email', 'message'], primary: 'phone', buttonText: 'Get in touch' };
  const BASE_ZH = { ...BASE_EN, name: '联系我们', buttonText: '联系' };
  const setup = () => {
    const site = temp('fcft-site-');
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
  const carLabels = { car: 'What car do you drive?', 'car.o-toy': 'Toyota', 'car.o-hon': 'Honda', 'car.o-for': 'Ford' };
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', clone(SEL), 'email'], required: ['car'], labels: carLabels });
  const en = read('en'); const zh = read('zh');
  check(JSON.stringify(en.fields[2]) === JSON.stringify(SEL) && JSON.stringify(zh.fields) === JSON.stringify(en.fields),
    '加一个下拉 ⟹ en 与 zh 的 fields 一样，选项 id 在结构里', JSON.stringify(zh.fields));
  check(en.labels['car.o-for'] === 'Ford' && zh.labels['car.o-for'] === 'Ford' && zh.labels.car === 'What car do you drive?',
    'zh 还没有选项文字 ⟹ 先借 en 那几句（不然 zh 那份过不了检查、整笔被拒）');
  check(sf.formsProblems({ en: [read('en')], zh: [read('zh')] }).length === 0, '写完的两份表单库过检查');

  const enBefore = fs.readFileSync(file('en'), 'utf-8');
  const ws = apply({ id: 'contact', labels: { 'car.o-toy': '丰田', 'car.o-hon': '本田', 'car.o-for': '福特', car: '您开什么车？' } }, 'zh');
  check(ws.length === 1 && ws[0].file === file('zh') && read('zh').labels['car.o-toy'] === '丰田' && fs.readFileSync(file('en'), 'utf-8') === enBefore,
    '只改 zh 的选项文字 ⟹ 只写 zh 一份，en 逐字节不变（文字各语言各自翻）', ws.map((w) => w.file).join(', '));

  // 拖动排序：第 3 项到第 1 位 ⟹ 两个语言顺序一起变、zh 的文字跟着选项 id 走（不串位）
  const reordered = { ...clone(SEL), options: ['o-for', 'o-toy', 'o-hon'] };
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', reordered, 'email'], required: ['car'] });
  const zh2 = read('zh');
  check(JSON.stringify(read('en').fields[2].options) === '["o-for","o-toy","o-hon"]' && JSON.stringify(zh2.fields[2].options) === '["o-for","o-toy","o-hon"]',
    '拖动排序（第 3 项 → 第 1 位）⟹ en / zh 的选项顺序一起变');
  check(zh2.labels['car.o-for'] === '福特' && zh2.labels['car.o-toy'] === '丰田' && read('en').labels['car.o-for'] === 'Ford',
    '排序之后 zh 的文字跟着选项走（福特仍是 o-for）—— 按下标做键这里就会串位');

  // 删一个选项 ⟹ 每个语言的那句文字一起删
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', { ...clone(SEL), options: ['o-for', 'o-toy'] }, 'email'], required: ['car'] });
  check(!('car.o-hon' in read('en').labels) && !('car.o-hon' in read('zh').labels) && read('zh').labels['car.o-toy'] === '丰田',
    '删掉一个选项 ⟹ en / zh 里它的文字都删，别的选项文字不动');

  // 改类型：下拉 → 一行字 ⟹ 选项连同每个语言的文字一起删，字段名和必填留着
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', { id: 'car', type: 'text' }, 'email'], required: ['car'] });
  const en3 = read('en'); const zh3 = read('zh');
  check(JSON.stringify(en3.fields[2]) === '{"id":"car","type":"text"}' && JSON.stringify(zh3.fields[2]) === '{"id":"car","type":"text"}'
    && !Object.keys(en3.labels).some((k) => k.startsWith('car.')) && !Object.keys(zh3.labels).some((k) => k.startsWith('car.'))
    && zh3.labels.car === '您开什么车？' && JSON.stringify(zh3.required) === '["car"]',
  '改成 text ⟹ 两个语言的 options 和选项文字都没了；字段名（zh 那句）和 required 留着', JSON.stringify({ en3, zh3 }));
  // 改回带选项的：一行字 → 单选（新选项，zh 先借 en 的）
  apply({ id: 'contact', base: base(), fields: ['name', 'phone', { id: 'car', type: 'radio', options: ['o-1', 'o-2'] }, 'email'], required: ['car'],
    labels: { 'car.o-1': 'Option 1', 'car.o-2': 'Option 2' } });
  check(read('zh').labels['car.o-1'] === 'Option 1' && sf.formsProblems({ en: [read('en')], zh: [read('zh')] }).length === 0, '一行字 → 单选（两项）⟹ 收下，zh 先借 en 的选项文字，过检查');

  const refused = (forms, re, name) => {
    const s2 = setup();
    const before = [fs.readFileSync(s2.file('en'), 'utf-8'), fs.readFileSync(s2.file('zh'), 'utf-8')];
    let e = null;
    try { s2.apply({ id: 'contact', ...(forms.fields ? { base: s2.base() } : {}), ...forms }); } catch (x) { e = x; }
    const same = fs.readFileSync(s2.file('en'), 'utf-8') === before[0] && fs.readFileSync(s2.file('zh'), 'utf-8') === before[1];
    check(e && (e.code === fw.REFUSED || e.code === 5) && re.test(e.message) && same, name, e ? `${e.code} ${e.message}` : '没拒');
  };
  refused({ fields: ['phone', { id: 'car', type: 'select', options: ['o-a'] }], labels: { car: 'Car', 'car.o-a': 'A' } }, /2 to 10 options/, '下拉只有 1 个选项 ⟹ 拒收，一个字节不写');
  const eleven = Array.from({ length: 11 }, (_, i) => `o-${i}`);
  refused({ fields: ['phone', { id: 'car', type: 'checkbox', options: eleven }], labels: Object.fromEntries([['car', 'Car'], ...eleven.map((o) => [`car.${o}`, o])]) },
    /2 to 10 options/, '多选 11 个选项 ⟹ 拒收');
  refused({ fields: ['phone', { id: 'car', type: 'text', options: ['o-a', 'o-b'] }], labels: { car: 'Car' } }, /不能带 options/, 'text 带 options ⟹ 拒收');
  refused({ fields: ['phone', { id: 'car', type: 'select', options: ['o-a', 'o-b'] }], labels: { car: 'Car', 'car.o-a': 'A' } }, /form settings need a fix/, '有一个选项没文字 ⟹ 拒收（兜底的整站检查）');
  refused({ fields: ['phone', { id: 'car', type: 'radio', options: ['o-a', 'o-b'] }], labels: { car: 'Car', 'car.o-a': 'A', 'car.o-b': 'B', 'car.o-c': 'C' } }, /no field called car\.o-c/, '给不存在的选项写文字 ⟹ 拒收');
}

// ══ 做什么 3：访客端渲染 ══════════════════════════════════════════════════════════════════════════
console.log('\n── 访客端渲染（BlockLeadForm）');
const loadForm = () => { delete require.cache[FORM]; return require(FORM).default; };
{
  const F = loadForm();
  const html = (form = FORM_EN, locale = 'en', size = 'lg') => renderToStaticMarkup(React.createElement(F, { mode: 'full', forms: [form], locale, siteId: 's', leadApi: 'https://lead.example', idPrefix: 'ct', size }));
  const full = html();
  const sel = (full.match(/<select[^>]*id="ct-car"[^>]*>[\s\S]*?<\/select>/) || [''])[0];
  const selOpts = Array.from(sel.matchAll(/<option value="([^"]*)"(?: selected="")?>([^<]*)<\/option>/g)).map((m) => `${m[1]}=${m[2]}`);
  check(/class="form-select form-select-lg"/.test(sel) && /\brequired=""/.test(sel)
    && JSON.stringify(selOpts) === JSON.stringify(['=What car do you drive? *', 'o-toy=Toyota', 'o-hon=Honda', 'o-for=Ford']),
  `下拉：form-select、必填带 required；第一项是名字 + 「 *」，其余按 options 的顺序、文字是这个语言的（${selOpts.join(' / ')}）`, sel);
  const box = (full.match(/<fieldset[^>]*id="ct-days"[\s\S]*?<\/fieldset>/) || [''])[0];
  const boxIn = Array.from(box.matchAll(/<input[^>]*>/g)).map((m) => m[0]);
  check(/data-field-type="checkbox"/.test(box) && /<legend[^>]*>Which days work\? \*<\/legend>/.test(box) && boxIn.length === 2
    && boxIn.every((x) => /type="checkbox"/.test(x) && /form-check-input/.test(x) && !/\brequired/.test(x)) && />Monday<\/label>/.test(box) && /aria-required="true"/.test(box),
  '多选：一组 form-check 复选框，名字是组标题（带 *）；框上不带 required（浏览器会要求每个都勾），组上 aria-required', box);
  const rad = (full.match(/<fieldset[^>]*id="ct-when"[\s\S]*?<\/fieldset>/) || [''])[0];
  const radIn = Array.from(rad.matchAll(/<input[^>]*>/g)).map((m) => m[0]);
  check(radIn.length === 2 && radIn.every((x) => /type="radio"/.test(x) && /name="ct-when"/.test(x) && !/\brequired/.test(x)) && /<legend[^>]*>Morning or afternoon\?<\/legend>/.test(rad),
    '单选：一组同名 radio（选填 ⟹ 不带 required，标题不带 *）', rad);
  const radReq = renderToStaticMarkup(React.createElement(F, { mode: 'full', forms: [{ ...clone(FORM_EN), required: ['when'] }], locale: 'en', siteId: 's', leadApi: 'x', idPrefix: 'ct' }));
  check(Array.from(((radReq.match(/<fieldset[^>]*id="ct-when"[\s\S]*?<\/fieldset>/) || [''])[0]).matchAll(/<input[^>]*>/g)).every((m) => /\brequired=""/.test(m[0])),
    '对照：单选设成必填 ⟹ 每个 radio 带 required（浏览器按组判）');
  const area = (full.match(/<textarea[^>]*id="ct-more"[^>]*>/) || [''])[0];
  check(/maxLength="500"|maxlength="500"/.test(area) && /placeholder="Tell us more"/.test(area) && /class="form-control form-control-lg"/.test(area), '多行字：textarea、maxLength 500、占位符 = 名字', area);
  const date = (full.match(/<label[^>]*for="ct-day"[^>]*>[^<]*<\/label><input[^>]*>/) || [''])[0];
  check(/type="date"/.test(date) && />Preferred date<\/label>/.test(date) && /class="form-label mb-1"/.test(date), '日期：<input type="date">，名字是它上面那行字（日期框不显示占位符）', date);
  check(/class="form-label small mb-1"/.test(html(FORM_EN, 'en', 'sm')), '页脚那一号（sm）的标题小一号');
  const zh = html(FORM_ZH, 'zh');
  check(/<option value="o-for">福特<\/option>/.test(zh) && />周六<\/label>/.test(zh) && /<legend[^>]*>哪几天方便？ \*<\/legend>/.test(zh), 'zh 那份表单库 ⟹ 选项文字是 zh 那几句');
  // 做什么 6：text 那一种一个字节不变 —— 同一个 text 字段，跟 #1769 那一版的 markup 逐字节比（只这一格）
  const T = { id: 'q', type: 'text' };
  const textForm = { id: 'contact', name: 'C', fields: ['phone', T], primary: 'phone', labels: { q: 'Your question' }, required: ['q'] };
  const textCell = (renderToStaticMarkup(React.createElement(F, { mode: 'full', forms: [textForm], locale: 'en', siteId: 's', leadApi: 'x', idPrefix: 'ct' })).match(/<input[^>]*id="ct-q"[^>]*>/) || [''])[0];
  const want = '<input id="ct-q" class="form-control form-control-lg" type="text" placeholder="Your question *" aria-label="Your question" maxLength="200" data-field="q" required="" aria-required="true" value=""/>';
  check(textCell === want, 'text 字段的那一格跟 #1769 逐字节相同（maxLength 仍是 200）', textCell);
}

// ══ 做什么 4：提交（happy-dom 真点）══════════════════════════════════════════════════════════════
console.log('\n── 提交（happy-dom）');
(async () => {
  let Window;
  try { ({ Window } = require('happy-dom')); } catch (e) { die(`happy-dom 载入不了：${e.message}`); }
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent'];
  const run = async (act1) => {
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
      await act(async () => { root.render(React.createElement(F, { mode: 'full', forms: [FORM_EN], locale: 'en', siteId: 's', leadApi: 'https://lead.example', idPrefix: 'ct' })); });
      const setVal = async (sel, val) => {
        const el = host.querySelector(sel);
        if (!el) throw new Error(`页面上没有 ${sel}`);
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
        await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); });
      };
      const click = async (sel) => { const el = host.querySelector(sel); if (!el) throw new Error(`页面上没有 ${sel}`); await act(async () => { el.click(); }); };
      await act1({ setVal, click });
      await act(async () => { host.querySelector('form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const cls = (sel) => (host.querySelector(sel) ? host.querySelector(sel).className : '');
      return { calls, html: host.innerHTML, cls, focused: win.document.activeElement && win.document.activeElement.id };
    } finally {
      for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
    }
  };
  try {
    const phone = async ({ setVal }) => { await setVal('#ct-phone', '416-555-0199'); };
    const none = await run(phone);
    check(none.calls.length === 0, '必填的下拉和多选都没选 ⟹ 不发请求', `发了 ${none.calls.length} 次`);
    check(/is-invalid/.test(none.cls('#ct-car')) && /is-invalid/.test(none.cls('#ct-days--o-mon')) && /is-invalid/.test(none.cls('#ct-days--o-sat'))
      && /Please fill in the required fields\./.test(none.html) && none.focused === 'ct-car',
    '下拉标红、多选那一组每个框标红、出「请填必填项」、光标落到第一格（下拉）', `car=${none.cls('#ct-car')} focused=${none.focused}`);
    const onlySel = await run(async (u) => { await phone(u); await u.setVal('#ct-car', 'o-hon'); });
    check(onlySel.calls.length === 0 && !/is-invalid/.test(onlySel.cls('#ct-car')) && /is-invalid/.test(onlySel.cls('#ct-days--o-mon')) && onlySel.focused === 'ct-days--o-mon',
      '只选了下拉、多选一项没勾 ⟹ 仍不发；只有多选那一组标红，光标落到它的第一个框（fieldset 拿不到焦点）', `focused=${onlySel.focused}`);
    const all = await run(async (u) => {
      await phone(u);
      await u.setVal('#ct-car', 'o-for');
      await u.click('#ct-days--o-sat'); await u.click('#ct-days--o-mon'); // 先勾周六再勾周一：答案仍按表单上的顺序
      await u.click('#ct-when--o-pm');
      await u.setVal('#ct-more', '  Two lines\nhere  ');
      await u.setVal('#ct-day', '2026-11-03');
    });
    const body = all.calls[0] ? JSON.parse(all.calls[0].init.body) : {};
    const want = [
      { id: 'car', label: 'What car do you drive?', value: 'Ford' },
      { id: 'days', label: 'Which days work?', value: 'Monday, Saturday' },
      { id: 'when', label: 'Morning or afternoon?', value: 'Afternoon' },
      { id: 'more', label: 'Tell us more', value: 'Two lines\nhere' },
      { id: 'day', label: 'Preferred date', value: '2026-11-03' },
    ];
    check(all.calls.length === 1 && JSON.stringify(body.meta && body.meta.answers) === JSON.stringify(want),
      '都填了 ⟹ 一次 POST；下拉 / 单选交选项此刻的文字，多选按表单上的顺序「, 」连起来（不按勾的先后），多行字原样（去首尾空白），日期原样 YYYY-MM-DD',
      JSON.stringify(body.meta && body.meta.answers));
    check(/data-part="form-success"/.test(all.html), '成功提示出现');
    const untick = await run(async (u) => { await phone(u); await u.setVal('#ct-car', 'o-toy'); await u.click('#ct-days--o-mon'); await u.click('#ct-days--o-sat'); await u.click('#ct-days--o-mon'); });
    const b2 = untick.calls[0] ? JSON.parse(untick.calls[0].init.body) : {};
    check(JSON.stringify((b2.meta.answers || []).map((a) => a.value)) === '["Toyota","Saturday"]', '勾了再取消的那一项不进答案；选填的几格没填 ⟹ 不带', JSON.stringify(b2.meta));
  } catch (e) {
    bad(`提交那一段抛了：${e.stack || e.message}`);
  }

  // ══ 做什么 2 / 7：编辑器 Add field 页的类型和选项列表（happy-dom 真点）══════════════════════════════
  console.log('\n── 编辑器：Type 六选一 / 选项列表 / 改类型（FormCopyDialog）');
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
      const opts = () => qa('[data-editor-form-option]').map((r) => r.getAttribute('data-editor-form-option'));
      const optText = () => qa('[data-editor-form-option-input]').map((i) => i.value);
      const unmount = async () => { await act(async () => { root.unmount(); }); };
      return { got, q, qa, click, setVal, opts, optText, unmount, apply: mod.applyFormCopyEdit, host };
    };
    const DEF = clone(sf.DEFAULT_SITE_FORMS[0]);
    const d = await mount(clone(DEF));
    await d.click('[data-editor-form-page="fields"]');
    await d.click('[data-editor-form-add-open]');
    await d.click('[data-editor-form-add-custom]');
    const types = d.qa('[data-editor-form-custom-type] option').map((o) => `${o.value}=${o.textContent}`);
    check(JSON.stringify(types) === JSON.stringify(['text=One line', 'textarea=Multiple lines', 'select=Dropdown', 'checkbox=Checkboxes', 'radio=Radio buttons', 'date=Date']),
      `Type 下拉六选一，顺序叫法照 Durable（${types.join(' / ')}）`);
    check(!d.q('[data-editor-form-options]'), 'One line ⟹ 没有选项列表');
    await d.setVal('[data-editor-form-custom-type]', 'select', 'change');
    check(/One choice from a dropdown list\./.test(d.host.textContent) && d.opts().length === 2 && JSON.stringify(d.optText()) === '["Option 1","Option 2"]'
      && d.opts().every((o) => sf.CUSTOM_ID_RE.test(o)),
    '选 Dropdown ⟹ 说明换成它那句，出选项列表，先放两项 Option 1 / Option 2（id 合 CUSTOM_ID_RE）', JSON.stringify(d.opts()));
    check(d.qa('[data-editor-form-option-remove]').every((b) => b.disabled), '只剩 2 项 ⟹ 每项的删除按钮都灰着（少于 2 项就不是「选」了）');
    await d.click('[data-editor-form-option-add]');
    check(d.opts().length === 3 && d.optText()[2] === 'Option 3' && d.qa('[data-editor-form-option-remove]').every((b) => !b.disabled), '+ Add option ⟹ 第 3 项，删除按钮能点了');
    const [o1, o2, o3] = d.opts();
    await d.setVal(`[data-editor-form-option-input="${o1}"]`, 'Toyota');
    await d.setVal(`[data-editor-form-option-input="${o2}"]`, 'Honda');
    await d.setVal(`[data-editor-form-option-input="${o3}"]`, '');
    await d.setVal('[data-editor-form-custom-label]', 'What car do you drive?');
    check(d.q('[data-editor-form-custom-save]').disabled && !!d.q('[data-editor-form-option-why]'), '有一项文字空着 ⟹ Save 灰着、说清楚原因');
    await d.setVal(`[data-editor-form-option-input="${o3}"]`, 'Ford');
    check(!d.q('[data-editor-form-custom-save]').disabled, '对照：填上 ⟹ Save 能点');
    for (let i = 3; i < sf.MAX_OPTIONS; i += 1) await d.click('[data-editor-form-option-add]');
    check(d.opts().length === sf.MAX_OPTIONS && !d.q('[data-editor-form-option-add]') && !!d.q('[data-editor-form-option-max]'), `加到 ${sf.MAX_OPTIONS} 项 ⟹ + Add option 没了、换成上限那句`);
    for (const o of d.opts().slice(3)) await d.click(`[data-editor-form-option-remove="${o}"]`);
    check(JSON.stringify(d.optText()) === '["Toyota","Honda","Ford"]', '删回 3 项，留下的文字不动');
    await d.click('[data-editor-form-custom-required]');
    await d.click('[data-editor-form-custom-save]');
    const fid = d.qa('[data-editor-form-row]').map((r) => r.getAttribute('data-editor-form-row')).pop();
    await d.click('[data-editor-form-done]');
    const e1 = d.got.done || {};
    const field = (e1.fields || []).find((x) => typeof x === 'object');
    check(field && field.id === fid && field.type === 'select' && JSON.stringify(field.options) === JSON.stringify([o1, o2, o3]),
      'Done ⟹ fields 里多一个 { id, type: select, options: [三个选项 id] }', JSON.stringify(field));
    check(e1.labels && e1.labels[fid] === 'What car do you drive?' && e1.labels[`${fid}.${o1}`] === 'Toyota' && e1.labels[`${fid}.${o3}`] === 'Ford'
      && JSON.stringify(e1.required) === JSON.stringify([fid]),
    'labels 带字段名 + 每项选项的文字（键 = 字段id.选项id），required 带上它', JSON.stringify(e1.labels));
    {
      const site = temp('fcft-dialog-');
      for (const loc of ['en', 'zh']) { fs.mkdirSync(path.join(site, loc)); fs.writeFileSync(path.join(site, loc, 'forms.json'), JSON.stringify([clone(DEF)])); }
      const ws = fw.planFormsWrite({ target: { locale: 'en', localeDir: path.join(site, 'en'), shape: { locales: ['en', 'zh'] } }, forms: e1 });
      for (const w of ws) fs.writeFileSync(w.file, w.content);
      const byLoc = { en: JSON.parse(fs.readFileSync(path.join(site, 'en', 'forms.json'), 'utf-8')), zh: JSON.parse(fs.readFileSync(path.join(site, 'zh', 'forms.json'), 'utf-8')) };
      check(ws.length === 2 && sf.formsProblems(byLoc).length === 0, '弹窗交的那一笔喂给 forms-write.js §planFormsWrite ⟹ 收下，写两个语言，表单库过检查', sf.formsProblems(byLoc).join(' | '));
      const applied = d.apply([clone(DEF)], e1)[0];
      const F2 = loadForm();
      const canvas = renderToStaticMarkup(React.createElement(F2, { mode: 'full', forms: [applied], locale: 'en', siteId: 's', leadApi: 'x', idPrefix: 'ct' }));
      check(new RegExp(`<select[^>]*id="ct-${fid}"`).test(canvas) && canvas.indexOf('>Toyota<') < canvas.indexOf('>Ford<'), 'applyFormCopyEdit 套上这一笔 ⟹ 画布上出下拉，选项按顺序');
    }
    await d.unmount();

    // 改一个已有的下拉：Edit 打开带着现在的选项；改成 Date ⟹ 选项列表不见、Save → Done 交的 fields 里没有 options、选项文字不交
    const withCar = { ...clone(DEF), fields: [...DEF.fields, clone(SEL)], required: ['car'], labels: { car: 'What car do you drive?', 'car.o-toy': 'Toyota', 'car.o-hon': 'Honda', 'car.o-for': 'Ford' } };
    const c = await mount(clone(withCar));
    await c.click('[data-editor-form-page="fields"]');
    await c.click('[data-editor-form-field-edit="car"]');
    check(c.q('[data-editor-form-custom-type]').value === 'select' && JSON.stringify(c.optText()) === '["Toyota","Honda","Ford"]', 'Edit 一个已有的下拉 ⟹ 带着现在的类型和选项');
    await c.setVal('[data-editor-form-custom-type]', 'radio', 'change');
    check(JSON.stringify(c.optText()) === '["Toyota","Honda","Ford"]', '在带选项的类型之间换（下拉 → 单选）⟹ 选项原样保留');
    await c.setVal('[data-editor-form-custom-type]', 'date', 'change');
    check(!c.q('[data-editor-form-options]'), '换成 Date ⟹ 选项列表不见');
    await c.click('[data-editor-form-custom-save]');
    await c.click('[data-editor-form-done]');
    const e2 = c.got.done || {};
    const f2 = (e2.fields || []).find((x) => typeof x === 'object');
    check(JSON.stringify(f2) === '{"id":"car","type":"date"}' && !Object.keys(e2.labels || {}).some((k) => k.startsWith('car.')),
      '下拉 → 日期 ⟹ 交 { id, type: date }（没有 options），选项文字一句都不交（存盘那一侧删每个语言的）', JSON.stringify(e2));
    const after = c.apply([clone(withCar)], e2)[0];
    check(!Object.keys(after.labels).some((k) => k.startsWith('car.')) && after.labels.car === 'What car do you drive?', 'applyFormCopyEdit ⟹ 画布那份也删掉选项文字、字段名留着');
    await c.unmount();

    // 只改一项选项的文字 ⟹ 只交那一句，结构不交
    const t = await mount(clone(withCar));
    await t.click('[data-editor-form-page="fields"]');
    await t.click('[data-editor-form-field-edit="car"]');
    await t.setVal('[data-editor-form-option-input="o-hon"]', 'Honda Civic');
    await t.click('[data-editor-form-custom-save]');
    await t.click('[data-editor-form-done]');
    check(JSON.stringify(t.got.done) === JSON.stringify({ id: 'contact', labels: { 'car.o-hon': 'Honda Civic' } }), '只改一项选项的文字 ⟹ 只交那一句（结构不交）', JSON.stringify(t.got.done));
    await t.unmount();
  } catch (e) {
    bad(`编辑器那一段抛了：${e.stack || e.message}`);
  }

  console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
  process.exit(fail === 0 ? 0 : 1);
})();
