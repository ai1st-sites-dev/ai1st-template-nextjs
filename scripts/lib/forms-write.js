'use strict';

// forms-write.js —— #1634：编辑器存盘「表单文案那一半」的判与写（`scripts/write-editor-save.js` 调它）。
//
// 表单是站级资产（#1471，`site/<语言>/forms.json`，`lib/site-forms.js`）：块里只有 `form.id`，按钮字 / 成功提示 /
// 表单名住在表单库里，改一处所有用这张表单的块都变。所以编辑器那个「编辑这张表单」面板改的是**这个语言**那份
// `forms.json` 里的**一张**，不是这一页。
//
// stdin 里的 `forms`：{ "id": "<表单 id>", "name"?: "…", "buttonText"?: "…", "successMessage"?: "…" }
//   · 带了且是非空字符串 ⟹ 写成它（去掉首尾空白）
//   · 带了但是空串或 null ⟹ **删掉这个键**，回到默认（`BlockLeadForm` 没有这个键时画它自己的默认那句）
//   · 没带 ⟹ 原样
// 🔴 只认这四个键。别的键（`fields` / `primary` / `redirect` / …）**一律拒收**：改字段是另一张票（#1637），
//    那一张要连各语言一致性一起做；这里放行一个 `fields` 就等于绕过了它。
// 🔴 上限是 `site-forms.js` §COPY_CAPS（建站时 AI 写的文案也按它截）。`formListProblems` 不查长度 ⟹ 这里自己查。
// 🔴 只写**这个语言**那份 `forms.json`；别的语言一个字节不动（`write-editor-save.js` 参数里的 locale）。
// 🔴 改完的整份表单库再过一次 `formsProblems`（这个语言 + 其余语言磁盘上的那几份），不过就不写 ——
//    文案改动按构造不会让它变坏，这是兜底：磁盘上那份本来就坏的话，不在它上面再写一笔。
//
// 失败抛 `FormsWriteError`（带退出码，意思同 write-editor-save.js 文件头）：
//   4 这个语言没有表单库 / 没有这张表单   5 形状不对
//  11 拒收：超过上限 / 带了不许改的键 / 改完的表单库过不了检查（那句话原样进编辑器状态栏）

const fs = require('fs');
const path = require('path');
const { COPY_CAPS, formsProblems } = require('./site-forms.js');

const REFUSED = 11;
const TEXT_KEYS = Object.keys(COPY_CAPS); // name · buttonText · successMessage
const LABEL = { name: 'Form name', buttonText: 'Button text', successMessage: 'Success message' };

class FormsWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, msg) => { throw new FormsWriteError(code, msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 一个语言目录下的 forms.json（读不到 / 不是 JSON ⟹ null）。 */
function readForms(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'forms.json'), 'utf-8')); } catch (e) { return null; }
}

/**
 * 判 + 算出 `forms.json` 要写的字节，**不落盘**（落盘归 `lib/page-write.js` §commitWrites，跟页面那一半一起）。
 * @param {object} a
 * @param {{ locale: string, localeDir: string, shape: object }} a.target  `page-write.js` §resolveTarget 的结果
 * @param {unknown} a.forms   stdin 里的 `forms`
 * @returns {{ file: string, content: string } | null}  一个字节都不用改 ⟹ `null`（不写这份文件）
 */
function planFormsWrite({ target, forms }) {
  if (!isObj(forms)) fail(5, 'forms 必须是一个对象 { id, name?, buttonText?, successMessage? }');
  const extra = Object.keys(forms).filter((k) => k !== 'id' && !TEXT_KEYS.includes(k));
  if (extra.length) {
    fail(REFUSED, `Only the button text, success message and form name can be changed here (not ${extra.join(', ')}). Nothing was saved.`);
  }
  if (typeof forms.id !== 'string' || !forms.id.trim()) fail(5, 'forms.id 必须是非空字符串');

  const file = path.join(target.localeDir, 'forms.json');
  const list = readForms(target.localeDir);
  if (!Array.isArray(list)) fail(4, `这个语言没有表单库：${path.basename(target.localeDir)}/forms.json`);
  const i = list.findIndex((f) => isObj(f) && f.id === forms.id);
  if (i < 0) fail(4, `表单库里没有这张表单：${JSON.stringify(forms.id)}`);

  const next = list.map((f) => (isObj(f) ? { ...f } : f));
  const form = next[i];
  for (const k of TEXT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(forms, k)) continue;
    const v = forms[k];
    if (v === null || v === '') { delete form[k]; continue; }
    if (typeof v !== 'string') fail(5, `forms.${k} 必须是字符串`);
    const t = v.trim();
    if (!t) { delete form[k]; continue; }
    if ([...t].length > COPY_CAPS[k]) {
      fail(REFUSED, `${LABEL[k]} can be at most ${COPY_CAPS[k]} characters (this one has ${[...t].length}). Nothing was saved.`);
    }
    form[k] = t;
  }

  // 改完的这一份 + 其余语言磁盘上的那几份，整站过一次（各语言一致只看 id / fields / primary，文案改动碰不到它）。
  const byLocale = { [target.locale || 'default']: next };
  if (!target.shape || !target.shape.flat) {
    const siteDir = path.dirname(target.localeDir);
    for (const loc of (target.shape && target.shape.locales) || []) {
      if (loc === target.locale) continue;
      const other = readForms(path.join(siteDir, loc));
      if (Array.isArray(other)) byLocale[loc] = other;
    }
  }
  const problems = formsProblems(byLocale);
  if (problems.length) fail(REFUSED, `This form can't be saved: ${problems[0]}`);

  const content = `${JSON.stringify(next, null, 2)}\n`;
  let before = '';
  try { before = fs.readFileSync(file, 'utf-8'); } catch (e) { before = ''; }
  if (before === content) return null;
  return { file, content };
}

module.exports = { FormsWriteError, REFUSED, TEXT_KEYS, planFormsWrite };
