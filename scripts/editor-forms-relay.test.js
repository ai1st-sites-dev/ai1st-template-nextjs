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
 * 怎么测（不起浏览器）：把 dashboard 的源码用 TypeScript 去掉类型和注释，
 *   #1801 起编辑器搬进 dashboard，这一跳换了三个文件（VisualEditorPanel 删了）：
 *   ① `src/editor/host.ts` §saveFieldsFrom 真跑一次：带全八个键的 `forms` 原样出来（只带 forms、不带页面的那一笔也收）
 *   ② `api/siteContent.ts` §saveChanges 真跑一次（authFetch 换成替身）：`POST /content` 请求体的 `changes.forms` 原样
 *   ③ 中间那一处（`EditorPanel` §doSave 把收下的那一笔去掉 `keep` 整份交给 saveChanges）是组件里的对象解构，不起 React 跑不到 ——
 *      对**去掉注释之后**的代码查那两句还在（注释凑不够数）。
 * 🔴 dashboard 目录不在（模板单独同步出去的副本树）⟹ 退出码 2，不是通过。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const HOST = path.join(REPO, 'dashboard', 'src', 'editor', 'host.ts');
const PANEL = path.join(REPO, 'dashboard', 'src', 'editor', 'EditorPanel.tsx');
const API = path.join(REPO, 'dashboard', 'src', 'api', 'siteContent.ts');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

for (const f of [HOST, PANEL, API]) if (!fs.existsSync(f)) die(`找不到 ${path.relative(REPO, f)}（不在仓里跑？）`);
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
  // #1644 —— 结构的底稿（只比不写）也要原样过这一跳，少了它存盘那一侧会拒收这一笔。
  base: { fields: ['name', 'phone', 'email', 'message'], primary: 'phone' },
  name: 'Contact us',
  buttonText: 'Send',
  successMessage: '',
};

console.log('══ #1637 dashboard 那一跳：forms 原样往 manager 送（#1801：编辑器 → host.ts → EditorPanel → POST /content）══');
const load = (file, stubs = {}) => {
  const mod = { exports: {} };
  const req = (id) => { if (stubs[id]) return stubs[id]; throw new Error(`${path.basename(file)} 多 require 了 ${id}（替身只认 ${Object.keys(stubs).join(', ') || '无'}）`); };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', strip(file))(req, mod, mod.exports);
  return mod.exports;
};
const panelJs = strip(PANEL);

// ── ① saveFieldsFrom ──
console.log('── ① host.ts §saveFieldsFrom');
const { saveFieldsFrom } = load(HOST);
if (typeof saveFieldsFrom !== 'function') die('host.ts 里找不到 export function saveFieldsFrom（改名了就改这里）');
check('只带 forms（不带页面 / root / shared）的一笔也收，forms 八个键原样出来（#1644 加了 base）', () => {
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

// ── ② saveChanges 的请求体 ──
console.log('── ② api/siteContent.ts §saveChanges');
{
  const sent = [];
  const api = load(API, {
    './client': {
      authFetch: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, json: async () => ({ version: 2 }) }; },
      apiError: (b, m) => new Error(m),
    },
  });
  const { keep: _k, ...changes } = saveFieldsFrom({ page: 'contact', locale: 'zh', forms: FORMS });
  api.saveChanges('s1', 1, changes).then((r) => {
    check('POST /api/sites/s1/content 的请求体里 changes.forms 原样、baseVersion 照带', () => {
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].url, '/api/sites/s1/content');
      assert.strictEqual(sent[0].init.method, 'POST');
      const body = JSON.parse(sent[0].init.body);
      assert.deepStrictEqual(body.changes.forms, FORMS);
      assert.strictEqual(body.baseVersion, 1);
      assert.strictEqual(r.ok, true);
    });
    third();
  }, (e) => { check('saveChanges 跑得完', () => { throw e; }); third(); });
}

// ── ③ EditorPanel 里那一处（去掉注释后查） ──
function third() {
  console.log('── ③ EditorPanel §doSave：收下的那一笔去掉 keep 整份交给 saveChanges');
  check('`const { keep, ...changes } = fields;`', () => {
    assert.match(panelJs, /const \{ keep, \.\.\.changes \} = fields;/);
  });
  check('`saveChanges(siteId, base, changes, !!keep)`', () => {
    // 转出来的 CommonJS 把引进来的函数写成 `(0, siteContent_1.saveChanges)(…)`。
    assert.match(panelJs, /(?:\(0, \w+\.)?saveChanges\)?\(siteId, base, changes, !!keep\)/);
  });
  check('editor-save 那一支经 saveFieldsFrom 收下再交 doSave', () => {
    assert.match(panelJs, /case 'ai1st:editor-save': \{\s*const fields = (?:\(0, \w+\.)?saveFieldsFrom\)?\(d\);\s*if \(fields\)\s*void doSaveRef\.current\(fields\);/);
  });
  console.log(`\n${fail === 0 ? '✅' : '❌'} #1637 editor-forms-relay：${pass} 通过 · ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}
