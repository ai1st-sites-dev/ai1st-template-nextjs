#!/usr/bin/env node
/**
 * editor-forms-relay.test.js —— #1637（PM 放行留言第 2 条）：dashboard 那一跳有没有把表单改动原样往 manager 送。
 *
 * 跑法:  node scripts/editor-forms-relay.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么有这一份：编辑器（站里，`FormCopyEditor.tsx`）把一笔 `forms` 用 postMessage 交给 dashboard，dashboard 带自己的凭证
 * PUT 给 manager。这一跳在 #1634 时没有任何自动检查：QA1 实测把 `VisualEditorPanel.tsx` §saveFieldsFrom 交出 `forms`
 * 的那一行删掉，`tsc` 照样 rc=0，全仓没有一个测试红（CI 对 dashboard 只有 `npm run build`）。#1637 在同一条路上多了
 * `fields` / `primary` / `labels` 三个键。
 *
 * 怎么测（不起浏览器）：把 dashboard 的两份源码用 TypeScript 去掉类型和注释，
 *   ① §saveFieldsFrom 真跑一次：带全七个键的 `forms` 原样出来（只带 forms、不带页面的那一笔也收）
 *   ② `api/pages.ts` §savePage 真跑一次（authFetch 换成替身）：请求体里的 `forms` 原样
 *   ③ 中间那两处（收到 editor-save 后放进 inflight、PUT 时交给 savePage）是组件里的对象展开，不起 React 跑不到 ——
 *      对**去掉注释之后**的代码查那两句还在（注释凑不够数）。
 * 🔴 dashboard 目录不在（模板单独同步出去的副本树）⟹ 退出码 2，不是通过。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PANEL = path.join(REPO, 'dashboard', 'src', 'components', 'VisualEditorPanel.tsx');
const PAGES = path.join(REPO, 'dashboard', 'src', 'api', 'pages.ts');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

for (const f of [PANEL, PAGES]) if (!fs.existsSync(f)) die(`找不到 ${path.relative(REPO, f)}（不在仓里跑？）`);
let ts;
try { ts = require('typescript'); } catch (e) { die(`没有 typescript：${e.message}`); }

/** 去掉类型和注释的 JS（CommonJS）。 */
const strip = (file) => ts.transpileModule(fs.readFileSync(file, 'utf-8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve, removeComments: true },
}).outputText;

/** 从 JS 里按花括号配对抠出一个顶层 function。 */
function extractFunction(js, name) {
  const at = js.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const open = js.indexOf('{', js.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < js.length; i += 1) {
    if (js[i] === '{') depth += 1;
    else if (js[i] === '}') { depth -= 1; if (depth === 0) return js.slice(at, i + 1); }
  }
  return null;
}

const FORMS = {
  id: 'contact',
  fields: ['message', 'email', 'phone'],
  primary: 'email',
  labels: { name: '您的姓名', email: '' },
  name: 'Contact us',
  buttonText: 'Send',
  successMessage: '',
};

console.log('══ #1637 dashboard 那一跳：forms 原样往 manager 送 ══');
const panelJs = strip(PANEL);

// ── ① saveFieldsFrom ──
console.log('── ① VisualEditorPanel §saveFieldsFrom');
const src = extractFunction(panelJs, 'saveFieldsFrom');
if (!src) die('VisualEditorPanel.tsx 里找不到 function saveFieldsFrom（改名了就改这里）');
// eslint-disable-next-line no-new-func
const saveFieldsFrom = new Function(`${src}\nreturn saveFieldsFrom;`)();
check('只带 forms（不带页面 / root / shared）的一笔也收，forms 七个键原样出来', () => {
  const out = saveFieldsFrom({ type: 'ai1st:editor-save', page: 'contact', locale: 'zh', forms: FORMS });
  assert.ok(out, 'saveFieldsFrom 回了 null —— 只改表单的那一笔会被丢掉');
  assert.deepStrictEqual(out.forms, FORMS);
  assert.strictEqual(out.page, 'contact');
  assert.strictEqual(out.locale, 'zh');
});
check('跟页面同一笔时 forms 也原样（页面那一半照常）', () => {
  const out = saveFieldsFrom({ page: 'contact', locale: null, json: { blocks: [] }, baseHash: 'h', forms: FORMS });
  assert.deepStrictEqual(out.forms, FORMS);
  assert.deepStrictEqual(out.json, { blocks: [] });
});
check('对照：forms 不是对象（数组 / 字符串）⟹ 不往下送', () => {
  assert.strictEqual(saveFieldsFrom({ page: 'contact', forms: [FORMS] }), null);
  assert.strictEqual(saveFieldsFrom({ page: 'contact', forms: 'contact' }), null);
});

// ── ② savePage 的请求体 ──
console.log('── ② api/pages.ts §savePage');
{
  const sent = [];
  const mod = { exports: {} };
  const stubRequire = (id) => {
    if (id === './client') {
      return {
        authFetch: async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => ({}) }; },
        apiError: (b, m) => new Error(m),
      };
    }
    throw new Error(`pages.ts 多 require 了 ${id}（这里的替身只认 ./client）`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', strip(PAGES))(stubRequire, mod, mod.exports);
  const done = mod.exports.savePage('s1', { page: 'contact', locale: 'zh', forms: FORMS, saveId: 'x' });
  done.then(() => {
    check('PUT /api/sites/s1/pages 的请求体里 forms 原样', () => {
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].url, '/api/sites/s1/pages');
      assert.deepStrictEqual(JSON.parse(sent[0].init.body).forms, FORMS);
    });
    third();
  }, (e) => { check('savePage 跑得完', () => { throw e; }); third(); });
}

// ── ③ 组件里的两处对象展开（去掉注释后查） ──
function third() {
  console.log('── ③ editor-save 收下后放进 inflight、PUT 时交给 savePage');
  // 🔴 同一句也出现在 §saveFieldsFrom 的返回值里 ⟹ 只认 inflight 那个对象字面量（`const f = { … put: false`）里的，
  //    否则删掉 inflight 那一句这一格照样绿（自测变异实测过）。
  check('inflight 那一笔带上 forms：`const f = { … ...(forms ? { forms } : {}) … put: false`', () => {
    const lit = panelJs.match(/const f = \{([^;]*?)put: false/);
    assert.ok(lit, '找不到 inflight 那个对象字面量（const f = { … put: false }）');
    assert.match(lit[1], /\.\.\.\(forms \? \{ forms \} : \{\}\)/);
  });
  check('savePage 那一笔带上 forms：`...(f.forms ? { forms: f.forms } : {})`', () => {
    assert.match(panelJs, /\.\.\.\(f\.forms \? \{ forms: f\.forms \} : \{\}\)/);
  });
  console.log(`\n${fail === 0 ? '✅' : '❌'} #1637 editor-forms-relay：${pass} 通过 · ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}
