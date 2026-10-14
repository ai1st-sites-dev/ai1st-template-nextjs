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
//   `required`（#1769）：字段 id 的数组（内置 / 自定义都行），整列替换，每一项都得在（改后的）`fields` 里；空数组 = 删掉这个键。
//   只带 `fields` 而原来的 `required` 里有字段被删了 ⟹ 那几项跟着去掉（同 `primary` 的落位）。
//   `fields` 里的自定义字段（#1769）是 `{ id, type }`，它的名字走 `labels[id]`。新加的自定义字段在别的语言里还没有名字
//   ⟹ 先用这个语言的名字（不然那个语言的表单库过不了检查、整笔被拒），老板切过去再改成那个语言的说法；删掉的
//   自定义字段，它在每个语言里的名字一起删。
//   `base`（#1644）：{ fields?, primary?, required? } —— 编辑器打开这张表单时手上的结构（原样），只用来比、**不写进磁盘**。
//   带了 `fields` 或 `primary` 就必须带它：跟磁盘上这张表单（这个语言那份 + 其余每个有这张表单的语言那份）的
//   `fields` / `primary` 原值比，任一份对不上 ⟹ 退出码 10、一个字节不写。为什么：`fields` 是整份绝对值交的，而编辑器手上
//   那份是构建时烤进静态页的；重建那一分半里换个语言 / 重开编辑器再交一笔结构，交上去的是旧的，会把上一笔悄悄改回去。
//   只改文案 / `labels` 的那一笔不带也不比（它们逐键只交改过的那几格，陈旧时根本不进这一笔）。
// 🔴 只认这九个键。别的键（`redirect` / 整张增删 / 改 `id` / …）**一律拒收**。
// 🔴 写到哪儿：文案三键和 `labels` 是给访客看的字，只写**这个语言**那份 `forms.json`；`fields` / `primary` 是结构，
//    各语言必须一致（`site-forms.js` §formsConsistencyProblems）⟹ 写进**每个语言**那份的同一张表单。
// 🔴 上限：文案是 `site-forms.js` §COPY_CAPS，字段名是 §LABEL_CAP。拒收的话全是给老板看的英文（原样进编辑器状态栏）。
// 🔴 改完的整站表单库再过一次 `formsProblems`，不过就不写 —— 上面那几条已经按构造挡住了本笔能造成的毛病，这是
//    兜底：磁盘上那份本来就坏的话，不在它上面再写一笔。那条检查的原话是给开发看的，挂在 `detail` 上（进 stderr），
//    状态栏只出一句老板看得懂的。
//
// 失败抛 `FormsWriteError`（带退出码，意思同 write-editor-save.js 文件头）：
//   4 这个语言没有表单库 / 没有这张表单   5 形状不对
//  10 结构的底稿（`base`）跟磁盘上的对不上 —— 编辑器打开之后这张表单的字段变过了（#1644）。那句话也给老板看
//  11 拒收：超过上限 / 带了不许改的键 / 字段组合不成立 / 改完的表单库过不了检查

const fs = require('fs');
const path = require('path');
const {
  COPY_CAPS, FORM_FIELDS, LABEL_CAP, MAX_CUSTOM_FIELDS, CUSTOM_FIELD_TYPES, CUSTOM_ID_RE,
  isCustomField, fieldId, lacksContactField, primaryChoices, formsProblems,
} = require('./site-forms.js');

const REFUSED = 11;
const STALE = 10;
const TEXT_KEYS = Object.keys(COPY_CAPS); // name · buttonText · successMessage
const FIELD_KEYS = ['fields', 'primary', 'labels', 'required'];
/** #1769 —— 结构那几样（各语言一致、要带底稿比）。 */
const STRUCTURE_KEYS = ['fields', 'primary', 'required'];
const BASE_KEY = 'base';
const STALE_MSG = 'This form was changed after the editor opened, so your edit was not saved (saving it would have undone that change). '
  + 'Close the editor and open it again in a minute or two to edit the latest version.';
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

/** #1644 —— 结构的一格两边是否相同：两边都没有这个键算相同；数组逐项、按顺序比（#1769：项可以是自定义字段对象，按内容比）。 */
function sameStructureKey(a, b, k) {
  if (!has(a, k) || !has(b, k)) return !has(a, k) && !has(b, k);
  if (!Array.isArray(a[k])) return a[k] === b[k];
  return Array.isArray(b[k]) && a[k].length === b[k].length && a[k].every((x, j) => JSON.stringify(x) === JSON.stringify(b[k][j]));
}
/** #1644 —— 底稿跟磁盘上这张表单不一样的那几格（`[]` = 对得上）。 */
function staleKeys(base, onDisk) {
  return STRUCTURE_KEYS.filter((k) => !sameStructureKey(base, onDisk, k));
}

/** #1769 —— `fields` 里一项自定义字段的形状对不对（不对就拒收，话是给老板看的）。 */
function checkCustomField(x) {
  const extra = Object.keys(x).filter((k) => k !== 'id' && k !== 'type');
  if (typeof x.id !== 'string' || !CUSTOM_ID_RE.test(x.id) || FORM_FIELDS.includes(x.id) || extra.length) {
    fail(5, `forms.fields 里的自定义字段形状不对：${JSON.stringify(x)}（只能是 { id, type }，id 字母开头、≤ 40 个字符、不跟内置字段重名）`);
  }
  if (!CUSTOM_FIELD_TYPES.includes(x.type)) fail(REFUSED, `This form can't have a field of type ${String(x.type)}. ${NOT_SAVED}`);
}

/** `fields` / `primary` / `required` 改动的结果（三样都没带 ⟹ null）。只判字段组合，不碰磁盘。 */
function nextStructure(form, forms) {
  if (!STRUCTURE_KEYS.some((k) => has(forms, k))) return null;
  let fields = Array.isArray(form.fields) ? [...form.fields] : [];
  if (has(forms, 'fields')) {
    if (!Array.isArray(forms.fields) || forms.fields.some((x) => typeof x !== 'string' && !isCustomField(x))) {
      fail(5, 'forms.fields 必须是数组，每一项是内置字段名（字符串）或自定义字段 { id, type }');
    }
    const bad = forms.fields.filter((x) => typeof x === 'string' && !FORM_FIELDS.includes(x));
    if (bad.length) fail(REFUSED, `This form can't have a field called ${bad.join(', ')}. ${NOT_SAVED}`);
    forms.fields.filter(isCustomField).forEach(checkCustomField);
    if (forms.fields.filter(isCustomField).length > MAX_CUSTOM_FIELDS) {
      fail(REFUSED, `A form can have at most ${MAX_CUSTOM_FIELDS} fields of your own. ${NOT_SAVED}`);
    }
    const ids = forms.fields.map(fieldId);
    if (new Set(ids).size !== ids.length) fail(REFUSED, `Each field can appear only once in a form. ${NOT_SAVED}`);
    if (!forms.fields.length) fail(REFUSED, `A form needs at least one field. ${NOT_SAVED}`);
    if (lacksContactField(forms.fields)) {
      fail(REFUSED, `A form needs a Phone or an Email field — visitors must leave one of them to send it. ${NOT_SAVED}`);
    }
    fields = forms.fields.map((x) => (isCustomField(x) ? { id: x.id, type: x.type } : x));
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
  // #1769 —— 必填：带了就整列替换（每项都得在 fields 里）；没带 ⟹ 原来那列去掉已经不在 fields 里的。
  const have = fields.map(fieldId);
  let required = Array.isArray(form.required) ? form.required.filter((x) => have.includes(x)) : [];
  if (has(forms, 'required')) {
    if (!Array.isArray(forms.required) || forms.required.some((x) => typeof x !== 'string')) fail(5, 'forms.required 必须是字段 id 的数组');
    const stray = forms.required.filter((x) => !have.includes(x));
    if (stray.length) fail(REFUSED, `Only a field that is on this form can be required (not ${stray.join(', ')}). ${NOT_SAVED}`);
    required = [...new Set(forms.required)];
  }
  return { fields, primary, required: required.length ? required : undefined };
}

/** #1769 —— 把结构写到一张表单上：`required` 为空就删掉这个键（不留 `[]`）。 */
function applyStructure(f, structure) {
  const out = { ...f, fields: structure.fields, primary: structure.primary };
  if (structure.required) out.required = structure.required; else delete out.required;
  return out;
}

/** #1769 —— 结构改了之后这一语言的 `labels`：删掉已经不在的自定义字段的名字；新出现的自定义字段没有名字 ⟹ 用 `fallback` 里的。 */
function labelsForStructure(labels, structure, fallback) {
  const custom = structure.fields.filter(isCustomField).map((c) => c.id);
  const out = {};
  for (const [k, v] of Object.entries(isObj(labels) ? labels : {})) {
    if (FORM_FIELDS.includes(k) || custom.includes(k)) out[k] = v;
  }
  for (const id of custom) {
    if ((typeof out[id] !== 'string' || !out[id].trim()) && isObj(fallback) && typeof fallback[id] === 'string') out[id] = fallback[id];
  }
  return Object.keys(out).length ? out : undefined;
}

/** 这个站除 `target` 那个语言之外的每个语言目录（平铺站 = 没有）：[{ loc, dir }]。 */
function otherLocales(target) {
  if (target.shape && target.shape.flat) return [];
  const siteDir = path.dirname(target.localeDir);
  return ((target.shape && target.shape.locales) || []).filter((loc) => loc !== target.locale).map((loc) => ({ loc, dir: path.join(siteDir, loc) }));
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
  const extra = Object.keys(forms).filter((k) => k !== 'id' && k !== BASE_KEY && !TEXT_KEYS.includes(k) && !FIELD_KEYS.includes(k));
  if (extra.length) {
    fail(REFUSED, `Only the fields, field names, button text, success message and form name can be changed here (not ${extra.join(', ')}). ${NOT_SAVED}`);
  }
  if (typeof forms.id !== 'string' || !forms.id.trim()) fail(5, 'forms.id 必须是非空字符串');
  if (has(forms, 'labels') && !isObj(forms.labels)) fail(5, 'forms.labels 必须是对象 { 字段: 字段名 }');
  // #1644 —— 带了结构就必须带底稿（这道检查不许因为漏带就跳过，同 write-page.js 的 baseHash）。
  const touchesStructure = STRUCTURE_KEYS.some((k) => has(forms, k));
  if (has(forms, BASE_KEY) && !isObj(forms[BASE_KEY])) fail(5, 'forms.base 必须是对象 { fields?, primary?, required? }');
  if (touchesStructure && !has(forms, BASE_KEY)) fail(5, '改了 fields / primary / required 的那一笔必须带 forms.base（编辑器打开时的 fields / primary / required）');

  const list = readForms(target.localeDir);
  if (!Array.isArray(list)) fail(4, `这个语言没有表单库：${path.basename(target.localeDir)}/forms.json`);
  const i = list.findIndex((f) => isObj(f) && f.id === forms.id);
  if (i < 0) fail(4, `表单库里没有这张表单：${JSON.stringify(forms.id)}`);
  const others = otherLocales(target);
  // #1644 —— 底稿跟各语言磁盘上的这张表单比（结构各语言一致，这一笔本来就要写进每个语言），在算新结构之前。
  //    任一份对不上 ⟹ 10、不写。只带文案 / labels 的那一笔不比。
  if (touchesStructure) {
    const stale = [];
    const check = (loc, f) => {
      const keys = staleKeys(forms[BASE_KEY], f);
      if (keys.length) stale.push(`${loc}: ${keys.map((k) => `${k} 底稿 ${JSON.stringify(forms[BASE_KEY][k])} ≠ 磁盘 ${JSON.stringify(f[k])}`).join('；')}`);
    };
    check(target.locale || 'default', list[i]);
    for (const { loc, dir } of others) {
      const other = readForms(dir);
      const same = Array.isArray(other) ? other.find((f) => isObj(f) && f.id === forms.id) : null;
      if (same) check(loc, same);
    }
    if (stale.length) fail(STALE, STALE_MSG, `表单 ${JSON.stringify(forms.id)} 的结构在编辑器打开之后变过了：\n${stale.join('\n')}`);
  }

  // ── 这个语言：文案 + 字段名 + 结构 ──
  const next = list.map((f) => (isObj(f) ? { ...f } : f));
  const form = next[i];
  for (const k of TEXT_KEYS) {
    if (!has(forms, k)) continue;
    const v = textValue(forms[k], COPY_CAPS[k], LABEL[k]);
    if (v === undefined) delete form[k]; else form[k] = v;
  }
  // #1769 —— 结构先算：`labels` 能写哪些键取决于改后的 `fields`（新加的自定义字段跟它的名字在同一笔里交）。
  const structure = nextStructure(form, forms);
  const customIds = (structure ? structure.fields : (Array.isArray(form.fields) ? form.fields : [])).filter(isCustomField).map((c) => c.id);
  if (has(forms, 'labels')) {
    const labels = isObj(form.labels) ? { ...form.labels } : {};
    for (const [k, raw] of Object.entries(forms.labels)) {
      if (!FORM_FIELDS.includes(k) && !customIds.includes(k)) fail(REFUSED, `This form has no field called ${k}. ${NOT_SAVED}`);
      const v = textValue(raw, LABEL_CAP, `The ${k} field name`);
      if (v === undefined) delete labels[k]; else labels[k] = v;
    }
    if (Object.keys(labels).length) form.labels = labels; else delete form.labels;
  }
  if (structure) {
    Object.assign(form, applyStructure(form, structure));
    if (!structure.required) delete form.required;
    const labels = labelsForStructure(form.labels, structure);
    if (labels) form.labels = labels; else delete form.labels;
  }

  // ── 其余语言：磁盘上那几份；改了结构就把同一张表单的 fields / primary 换成同一份（文字一个字不动）──
  const byLocale = { [target.locale || 'default']: next };
  const dirs = { [target.locale || 'default']: target.localeDir };
  for (const { loc, dir } of others) {
    const other = readForms(dir);
    if (!Array.isArray(other)) continue;
    // #1769 —— 别的语言：结构换成同一份；自定义字段的名字按 §labelsForStructure（删掉的跟着删，新加的先用这个语言的名字）。
    byLocale[loc] = !structure ? other : other.map((f) => {
      if (!isObj(f) || f.id !== forms.id) return f;
      const out = applyStructure(f, structure);
      const labels = labelsForStructure(f.labels, structure, form.labels);
      if (labels) out.labels = labels; else delete out.labels;
      return out;
    });
    dirs[loc] = dir;
  }

  const problems = formsProblems(byLocale);
  if (problems.length) {
    fail(REFUSED, `This form can't be saved because the website's form settings need a fix from our team first. ${NOT_SAVED}`, problems.join('\n'));
  }

  // 写哪几份：这个语言恒在；别的语言只在改了结构时才算（没改结构 ⟹ 一个字节不动，连重排版都不做）。
  // 📌 #1769 —— 只改了某个自定义字段在**这个语言**的名字（`labels`），别的语言不动：名字各语言各自翻。
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

module.exports = { FormsWriteError, REFUSED, STALE, TEXT_KEYS, FIELD_KEYS, STRUCTURE_KEYS, planFormsWrite };
