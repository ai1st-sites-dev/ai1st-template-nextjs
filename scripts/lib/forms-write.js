'use strict';

// forms-write.js —— #1634 / #1637：编辑器存盘「表单那一半」的判与写（`scripts/write-editor-save.js` 调它）。
//
// 表单是站级资产（#1471，`site/<语言>/forms.json`，`lib/site-forms.js`）：块里只有 `form.id`，按钮字 / 成功提示 /
// 表单名 / 字段住在表单库里，改一处所有用这张表单的块都变。所以编辑器那个「编辑这张表单」面板改的是表单库里的
// **一张**，不是这一页。
//
// stdin 里的 `forms`：{ "id": "<表单 id>", "name"?, "buttonText"?, "successMessage"?,          ← #1634 文案
//                      "fields"?: [...], "primary"?: "…", "labels"?: { <字段>: "…" } }       ← #1637 字段
//   文案三键：带了且是非空字符串 ⟹ 写成它（去掉首尾空白）；空串或 null ⟹ **删掉这个键**，回到默认；没带 ⟹ 原样。
//   `labels`：按字段逐条，规则同上（只动带了的那几个字段；删空了整个 `labels` 键也删掉）。
//   `fields`：整列替换（顺序 = 表单里的上下顺序），词表内、不重复、至少一个、电话 / 邮箱至少有一个。
//   `primary`：必须在（改后的）`fields` 里，且是联系字段（`site-forms.js` §primaryChoices，r4）。只带 `fields` 而原来的
//   `primary` 不再可取 ⟹ 落到剩下的第一个联系字段。
// 🔴 只认这七个键。别的键（`redirect` / 整张增删 / 改 `id` / …）**一律拒收**。
// 🔴 写到哪儿：文案三键和 `labels` 是给访客看的字，只写**这个语言**那份 `forms.json`；`fields` / `primary` 是结构，
//    各语言必须一致（`site-forms.js` §formsConsistencyProblems）⟹ 写进**每个语言**那份的同一张表单。
// 🔴 上限：文案是 `site-forms.js` §COPY_CAPS，字段名是 §LABEL_CAP。拒收的话全是给老板看的英文（原样进编辑器状态栏）。
// 🔴 改完的整站表单库再过一次 `formsProblems`，不过就不写 —— 上面那几条已经按构造挡住了本笔能造成的毛病，这是
//    兜底：磁盘上那份本来就坏的话，不在它上面再写一笔。那条检查的原话是给开发看的，挂在 `detail` 上（进 stderr），
//    状态栏只出一句老板看得懂的。
//
// 失败抛 `FormsWriteError`（带退出码，意思同 write-editor-save.js 文件头）：
//   4 这个语言没有表单库 / 没有这张表单   5 形状不对
//  11 拒收：超过上限 / 带了不许改的键 / 字段组合不成立 / 改完的表单库过不了检查

const fs = require('fs');
const path = require('path');
const { COPY_CAPS, FORM_FIELDS, LABEL_CAP, lacksContactField, primaryChoices, formsProblems } = require('./site-forms.js');

const REFUSED = 11;
const TEXT_KEYS = Object.keys(COPY_CAPS); // name · buttonText · successMessage
const FIELD_KEYS = ['fields', 'primary', 'labels'];
const LABEL = { name: 'Form name', buttonText: 'Button text', successMessage: 'Success message' };
const NOT_SAVED = 'Nothing was saved.';

class FormsWriteError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    if (detail) this.detail = detail;
  }
}
const fail = (code, msg, detail) => { throw new FormsWriteError(code, msg, detail); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 一个语言目录下的 forms.json（读不到 / 不是 JSON ⟹ null）。 */
function readForms(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'forms.json'), 'utf-8')); } catch (e) { return null; }
}

/** 一格文字的新值：`undefined` = 删掉这个键；超长拒收。 */
function textValue(v, cap, what) {
  if (v === null || v === '') return undefined;
  if (typeof v !== 'string') fail(5, `${what} 必须是字符串`);
  const t = v.trim();
  if (!t) return undefined;
  if ([...t].length > cap) fail(REFUSED, `${what} can be at most ${cap} characters (this one has ${[...t].length}). ${NOT_SAVED}`);
  return t;
}

/** `fields` / `primary` 改动的结果（没带这两样 ⟹ null）。只判字段组合，不碰磁盘。 */
function nextStructure(form, forms) {
  if (!has(forms, 'fields') && !has(forms, 'primary')) return null;
  let fields = Array.isArray(form.fields) ? [...form.fields] : [];
  if (has(forms, 'fields')) {
    if (!Array.isArray(forms.fields) || forms.fields.some((x) => typeof x !== 'string')) fail(5, 'forms.fields 必须是字符串数组');
    const bad = forms.fields.filter((x) => !FORM_FIELDS.includes(x));
    if (bad.length) fail(REFUSED, `This form can't have a field called ${bad.join(', ')}. ${NOT_SAVED}`);
    if (new Set(forms.fields).size !== forms.fields.length) fail(REFUSED, `Each field can appear only once in a form. ${NOT_SAVED}`);
    if (!forms.fields.length) fail(REFUSED, `A form needs at least one field. ${NOT_SAVED}`);
    if (lacksContactField(forms.fields)) {
      fail(REFUSED, `A form needs a Phone or an Email field — visitors must leave one of them to send it. ${NOT_SAVED}`);
    }
    fields = [...forms.fields];
  }
  let primary = form.primary;
  if (has(forms, 'primary')) {
    if (typeof forms.primary !== 'string') fail(5, 'forms.primary 必须是字符串');
    if (!fields.includes(forms.primary)) fail(REFUSED, `The quick form field must be one of this form's fields. ${NOT_SAVED}`);
    if (!primaryChoices(fields).includes(forms.primary)) {
      fail(REFUSED, `The quick form field must be Phone or Email — the short form shows only that box, and visitors must leave one of them to send it. ${NOT_SAVED}`);
    }
    primary = forms.primary;
  } else if (!primaryChoices(fields).includes(primary)) {
    primary = primaryChoices(fields)[0]; // 做什么 2：删掉的正好是 primary ⟹ 落到剩下的第一个联系字段
  }
  return { fields, primary };
}

/**
 * 判 + 算出要写的那几份 `forms.json`，**不落盘**（落盘归 `lib/page-write.js` §commitWrites，跟页面那一半一起）。
 * @param {object} a
 * @param {{ locale: string, localeDir: string, shape: object }} a.target  `page-write.js` §resolveTarget 的结果
 * @param {unknown} a.forms   stdin 里的 `forms`
 * @returns {{ file: string, content: string }[]}  只含真有字节变化的那几份（一份都不用改 ⟹ 空数组）
 */
function planFormsWrite({ target, forms }) {
  if (!isObj(forms)) fail(5, 'forms 必须是一个对象 { id, name?, buttonText?, successMessage?, fields?, primary?, labels? }');
  const extra = Object.keys(forms).filter((k) => k !== 'id' && !TEXT_KEYS.includes(k) && !FIELD_KEYS.includes(k));
  if (extra.length) {
    fail(REFUSED, `Only the fields, field names, button text, success message and form name can be changed here (not ${extra.join(', ')}). ${NOT_SAVED}`);
  }
  if (typeof forms.id !== 'string' || !forms.id.trim()) fail(5, 'forms.id 必须是非空字符串');
  if (has(forms, 'labels') && !isObj(forms.labels)) fail(5, 'forms.labels 必须是对象 { 字段: 字段名 }');

  const list = readForms(target.localeDir);
  if (!Array.isArray(list)) fail(4, `这个语言没有表单库：${path.basename(target.localeDir)}/forms.json`);
  const i = list.findIndex((f) => isObj(f) && f.id === forms.id);
  if (i < 0) fail(4, `表单库里没有这张表单：${JSON.stringify(forms.id)}`);

  // ── 这个语言：文案 + 字段名 + 结构 ──
  const next = list.map((f) => (isObj(f) ? { ...f } : f));
  const form = next[i];
  for (const k of TEXT_KEYS) {
    if (!has(forms, k)) continue;
    const v = textValue(forms[k], COPY_CAPS[k], LABEL[k]);
    if (v === undefined) delete form[k]; else form[k] = v;
  }
  if (has(forms, 'labels')) {
    const labels = isObj(form.labels) ? { ...form.labels } : {};
    for (const [k, raw] of Object.entries(forms.labels)) {
      if (!FORM_FIELDS.includes(k)) fail(REFUSED, `This form has no field called ${k}. ${NOT_SAVED}`);
      const v = textValue(raw, LABEL_CAP, `The ${k} field name`);
      if (v === undefined) delete labels[k]; else labels[k] = v;
    }
    if (Object.keys(labels).length) form.labels = labels; else delete form.labels;
  }
  const structure = nextStructure(form, forms);
  if (structure) Object.assign(form, structure);

  // ── 其余语言：磁盘上那几份；改了结构就把同一张表单的 fields / primary 换成同一份（文字一个字不动）──
  const byLocale = { [target.locale || 'default']: next };
  const dirs = { [target.locale || 'default']: target.localeDir };
  if (!target.shape || !target.shape.flat) {
    const siteDir = path.dirname(target.localeDir);
    for (const loc of (target.shape && target.shape.locales) || []) {
      if (loc === target.locale) continue;
      const dir = path.join(siteDir, loc);
      const other = readForms(dir);
      if (!Array.isArray(other)) continue;
      byLocale[loc] = !structure ? other : other.map((f) => (isObj(f) && f.id === forms.id ? { ...f, ...structure } : f));
      dirs[loc] = dir;
    }
  }

  const problems = formsProblems(byLocale);
  if (problems.length) {
    fail(REFUSED, `This form can't be saved because the website's form settings need a fix from our team first. ${NOT_SAVED}`, problems.join('\n'));
  }

  // 写哪几份：这个语言恒在；别的语言只在改了结构时才算（没改结构 ⟹ 一个字节不动，连重排版都不做）。
  // 「没变」按内容判，不按字节：磁盘那份排版不同但内容一样 ⟹ 不写。
  const out = [];
  for (const [loc, nextList] of Object.entries(byLocale)) {
    if (dirs[loc] !== target.localeDir && !structure) continue;
    const file = path.join(dirs[loc], 'forms.json');
    const content = `${JSON.stringify(nextList, null, 2)}\n`;
    const before = readForms(dirs[loc]);
    if (before !== null && `${JSON.stringify(before, null, 2)}\n` === content) continue;
    out.push({ file, content });
  }
  return out;
}

module.exports = { FormsWriteError, REFUSED, TEXT_KEYS, FIELD_KEYS, planFormsWrite };
