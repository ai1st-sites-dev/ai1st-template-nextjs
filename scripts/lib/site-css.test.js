#!/usr/bin/env node
/**
 * site-css.test.js — 网站表单字段的圆角跟 Corner style（`--radius-button`）走（#1645 AC1）。
 *
 *   node scripts/lib/site-css.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 * 真编一份 site.css 并**过 purge**（跟 `writeSiteCss` 同一条路：compile → purge，content 是模板真实的 .tsx）——
 * purge 是这份文件里最容易静默删掉一条规则的那一步，只验 `compileSiteCss` 的输出量不到它。
 * 然后对 `BlockLeadForm` 真会画出来的每种字段（挂的类 = `form-control form-control-lg` 这样一对），找**生效**的那条
 * `border-radius`：选择器列表里含它任一个类的顶层规则里、最后一条声明（都是 0-1-0，靠源码次序决胜）。
 *   ① 单行输入框 / 下拉框 × 不带尺寸 / -lg / -sm 六种：生效值读 `var(--radius-button, …)`
 *   ② `textarea.form-control`：生效值是 `min(var(--radius-button, …), 0.5rem)` —— 胶囊档 9999px 时封顶 0.5rem
 *      （按「那条规则用 0.5rem 封了顶」判，不在这里替浏览器算 CSS 表达式 —— PM 裁定）
 *   ③ 阳性对照：把 §FORM_RADIUS 从 scss 里拿掉再编 + purge 一次，同一把尺必须读出 ① ② 全红
 *   ④ purge 对照：content 里没有 `textarea` 这个词时，② 那条被 purge 删掉、同一把尺读红 ——
 *      证明 ② 读的是 purge 之后的产物，今天它留得下来靠的是 `BlockLeadForm.tsx` 里字面的 `<textarea`
 *   ⑤ 变量缺席时等于改前：①里那个 var() 的退路 == 拿掉 §FORM_RADIUS 后同一种字段的生效值（Webpixels 原值）。
 *      这一格同时守次序 —— -lg / -sm 那条排到不带尺寸那条前面，变量在时看不出来，退路会全变成 `--x-border-radius`
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const siteCss = require('./site-css.js');

const NEXT_DIR = path.resolve(__dirname, '..', '..');
const PRIMARY = '#2563eb';
// 字段种类 → 它挂的类（`BlockLeadForm.tsx` 的 `sz`；不带尺寸那两种今天没人画，Webpixels 自己有，一起守）
const FIELDS = {
  'input': ['.form-control'],
  'select': ['.form-select'],
  'input-lg': ['.form-control', '.form-control-lg'],
  'select-lg': ['.form-select', '.form-select-lg'],
  'input-sm': ['.form-control', '.form-control-sm'],
  'select-sm': ['.form-select', '.form-select-sm'],
};
const N = Object.keys(FIELDS).length;
const TEXTAREA = 'textarea.form-control';

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };

/** 顶层规则里（不进 @media 之类），选择器列表含 sels 任一个的、最后一条 border-radius 的值。 */
function winningRadius(css, sels) {
  let val = null;
  // 前一条规则的 `}` 用后行断言看、不吃掉（同 outline-hover-ink.test.js 的 #1586 教训）。
  const re = /(?:^|(?<=\}))\s*([^{}@]+?)\s*\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (!m[1].split(',').map((s) => s.trim()).some((x) => sels.includes(x))) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0 && d.slice(0, i).trim() === 'border-radius') val = d.slice(i + 1).trim();
    }
  }
  return val;
}

const READS_VAR = /^var\(\s*--radius-button\s*,\s*(.+)\)$/;
const CAPPED = /^min\(\s*var\(\s*--radius-button\s*,.*\)\s*,\s*0?\.5rem\s*\)$/;

/** 一份 CSS 量一遍：回 { fields: {sel: val}, fieldsOk, textarea, textareaOk } */
function measure(css) {
  const fields = {};
  for (const [k, sels] of Object.entries(FIELDS)) fields[k] = winningRadius(css, sels);
  const textarea = winningRadius(css, [TEXTAREA]);
  return {
    fields,
    fieldsOk: Object.keys(FIELDS).filter((k) => READS_VAR.test(fields[k] || '')),
    textarea,
    textareaOk: CAPPED.test(textarea || ''),
  };
}

function compileWithout(rule) {
  const sass = require('sass');
  const scss = siteCss.siteScss(PRIMARY);
  if (!rule || !scss.includes(rule)) return null;
  return sass.compileString(scss.replace(rule, ''), {
    loadPaths: [path.join(NEXT_DIR, 'node_modules')],
    sourceMap: false, quietDeps: true, silenceDeprecations: ['import'], logger: sass.Logger.silent,   // 同 compileSiteCss
  }).css;
}

(async () => {
  let live; let ctrl; let noTextarea; let tmp;
  try {
    const raw = siteCss.compileSiteCss(PRIMARY);
    live = measure(await siteCss.purgeSiteCss(raw));
    const rawCtrl = compileWithout(siteCss.FORM_RADIUS);
    ctrl = rawCtrl === null ? null : measure(await siteCss.purgeSiteCss(rawCtrl));
    // ④：一份只出现字段类、不出现 textarea 的 content
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-css-test-'));
    fs.writeFileSync(path.join(tmp, 'Form.tsx'),
      `export const F = () => <input className="${[...new Set(Object.values(FIELDS).flat())].map((s) => s.slice(1)).join(' ')} btn" />;\n`);
    noTextarea = measure(await siteCss.purgeSiteCss(raw, { rootDir: tmp, content: ['*.tsx'] }));
  } catch (e) {
    console.log(`🔴 跑不起来：${e.message}`);
    process.exit(2);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('① compile + purge 之后，六种字段生效的 border-radius 读 --radius-button');
  for (const [s, v] of Object.entries(live.fields)) console.log(`     ${s}: ${v}`);
  if (live.fieldsOk.length === N) ok(`${N}/${N} 读 var(--radius-button, …)`);
  else bad(`只有 ${live.fieldsOk.length}/${N} 读 --radius-button —— §FORM_RADIUS 被删了、被 purge 掉了，或被后面一条同特异度的规则盖掉了`);

  console.log('② textarea.form-control：生效值用 0.5rem 封顶（胶囊档 9999px 时是 0.5rem）');
  console.log(`     ${TEXTAREA}: ${live.textarea}`);
  if (live.textareaOk) ok('min(var(--radius-button, …), 0.5rem)');
  else bad('不是 min(var(--radius-button, …), 0.5rem) —— 胶囊档下留言框会变成胶囊');

  console.log('③ 阳性对照：拿掉 §FORM_RADIUS 再编 + purge，同一把尺必须读红');
  if (!ctrl) bad('site-css.js 没导出 FORM_RADIUS，或 siteScss 里找不到它的原文 —— 对照造不出来');
  else {
    console.log(`     拿掉后：读 --radius-button ${ctrl.fieldsOk.length}/${N} · textarea ${ctrl.textarea}`);
    if (ctrl.fieldsOk.length > 0) bad('拿掉那条规则后 ① 仍有格子读绿 —— ① 量的不是那条规则');
    else if (ctrl.textareaOk) bad('拿掉那条规则后 ② 仍读绿 —— ② 量的不是那条规则');
    else ok('拿掉后 ① ② 都红（尺子咬得住）');
  }

  console.log('④ purge 对照：content 里没有 `textarea` 这个词时，② 那条被 purge 删掉');
  console.log(`     ${TEXTAREA}: ${noTextarea.textarea} · 字段 ${noTextarea.fieldsOk.length}/${N}`);
  if (noTextarea.textareaOk) bad('content 里没有 textarea 也读绿 —— ② 量的不是 purge 之后的产物');
  else if (noTextarea.fieldsOk.length !== N) bad('对照 content 里字段类都在，① 却没留全 —— 对照本身坏了');
  else ok('textarea 那条被删、六个字段留下（② 读的是 purge 之后的产物）');

  console.log('⑤ 变量缺席时等于改前：① 的退路 == 拿掉 §FORM_RADIUS 后的生效值');
  if (!ctrl) bad('对照造不出来（见 ③）');
  else {
    const off = [];
    for (const k of Object.keys(FIELDS)) {
      const m = READS_VAR.exec(live.fields[k] || '');
      const fb = m ? m[1].trim() : null;
      console.log(`     ${k}: 退路 ${fb} · 改前 ${ctrl.fields[k]}`);
      if (fb !== ctrl.fields[k]) off.push(k);
    }
    if (off.length) bad(`${off.join(' / ')} 的退路不等于改前 —— 尺寸那条被删了，或排到了不带尺寸那条前面`);
    else ok(`${N}/${N} 退路等于 Webpixels 原值`);
  }

  console.log(failed ? `\n🔴 ${failed} 格失败` : '\n✅ 全过');
  process.exit(failed ? 1 : 0);
})();
