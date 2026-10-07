#!/usr/bin/env node
/**
 * component-labels-form.test.js —— #1641：表单组件（BlockLeadForm）自己的六句兜底字在字表里每种语言都有。
 *
 * 跑法:  node scripts/component-labels-form.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 载的是**真的** `src/lib/component-labels.ts`（TypeScript 去掉类型后跑），不抄一份字表。
 *   ① 表里每一种语言，六个新键都有、是非空字符串（getLabels 会逐键回退英文 ⟹ 漏一种语言不会报错，只会悄悄变英文，所以直接查表本身）
 *   ② 非英文那几种，六句没有一句跟英文逐字相同（漏译 = 抄了英文，也是悄悄变英文）
 *   ③ getLabels('xx')（表里没有的语言）六个键 = 英文那一行逐字，也就是改之前 BlockLeadForm 写死的原文
 *   ④ BlockLeadForm.tsx 里那六句英文原文已经一句都不在了（去掉注释之后查）
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const LABELS = path.join(NEXT, 'src', 'lib', 'component-labels.ts');
const FORM = path.join(NEXT, 'src', 'components', 'BlockLeadForm.tsx');
const KEYS = ['formSubmit', 'formThanks', 'formNeedEmail', 'formNeedPhone', 'formFailed', 'formSending'];
/** 改之前 BlockLeadForm.tsx 写死的原文（#1641 正文「做什么」1 那张表）。 */
const ORIGINAL = {
  formSubmit: 'Get a free quote',
  formThanks: "Thanks! We've got your details and will be in touch.",
  formNeedEmail: 'Please enter your email.',
  formNeedPhone: 'Please enter your phone number.',
  formFailed: 'Something went wrong. Please try again or call us.',
  formSending: 'Sending…',
};

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

let ts;
try { ts = require('typescript'); } catch (e) { die(`没有 typescript：${e.message}`); }
const strip = (file) => ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve, removeComments: true },
}).outputText;

const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('require', 'module', 'exports', strip(LABELS))(require, mod, mod.exports);
const { COMPONENT_LABELS, getLabels } = mod.exports;
if (!COMPONENT_LABELS || typeof getLabels !== 'function') die('component-labels.ts 没导出 COMPONENT_LABELS / getLabels');
const LOCALES = Object.keys(COMPONENT_LABELS);

console.log(`══ #1641 表单兜底字：${LOCALES.length} 种语言 × ${KEYS.length} 个键 ══`);
check(`字表是 14 种语言（en 在里面）：${LOCALES.join(' ')}`, () => {
  assert.strictEqual(LOCALES.length, 14);
  assert.ok(LOCALES.includes('en'));
});
for (const loc of LOCALES) {
  check(`① ${loc}：六个键都是非空字符串`, () => {
    const row = COMPONENT_LABELS[loc];
    const bad = KEYS.filter((k) => typeof row[k] !== 'string' || !row[k].trim());
    assert.deepStrictEqual(bad, [], `${loc} 缺 / 空：${bad.join(', ')}`);
  });
  if (loc === 'en') continue;
  check(`② ${loc}：六句没有一句跟英文逐字相同`, () => {
    const same = KEYS.filter((k) => COMPONENT_LABELS[loc][k] === COMPONENT_LABELS.en[k]);
    assert.deepStrictEqual(same, [], `${loc} 跟英文一样：${same.join(', ')}`);
  });
}
check('③ en 那一行 = 改之前写死的原文，逐字', () => {
  for (const k of KEYS) assert.strictEqual(COMPONENT_LABELS.en[k], ORIGINAL[k], k);
});
check("③ getLabels('xx')（表里没有）六个键回英文那一行，逐字", () => {
  const l = getLabels('xx');
  for (const k of KEYS) assert.strictEqual(l[k], ORIGINAL[k], k);
});
check('④ BlockLeadForm.tsx（去掉注释）里六句英文原文一句都不在了', () => {
  const js = strip(FORM);
  const left = Object.values(ORIGINAL).filter((t) => js.includes(t) || js.includes(JSON.stringify(t).slice(1, -1)));
  assert.deepStrictEqual(left, []);
});

console.log(`\n${fail === 0 ? '✅' : '❌'} #1641 component-labels-form：${pass} 通过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
