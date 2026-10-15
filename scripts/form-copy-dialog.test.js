#!/usr/bin/env node
/**
 * form-copy-dialog.test.js —— #1637 r4：编辑器「Edit form」面板（`src/components/editor/FormCopyEditor.tsx` §FormCopyDialog）
 * 里快速表单那一格（`primary`）只能是联系字段。
 *
 * 跑法:  node scripts/form-copy-dialog.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 为什么有这一份：QA3 r3 / PM 量到默认 contact 表单（name / phone / email / message，primary phone）**删一下 phone**，
 * 面板就把 `primary` 落到剩下的第一个字段 `name` —— 快速表单（teaser）只画那一格，而提交要电话或邮箱 ⟹ 那张脸永远交不出去。
 * 存盘那一侧（`forms-write.test.js` ⑫）拒收这种表单；这一份盯的是面板自己：下拉只给联系字段、删掉 primary 落到联系字段，
 * 于是老板按 Done 交出去的那一笔本来就是对的，不会撞上一个看不懂的拒收。
 *
 * #1644 加了 ⑥~⑧：改了结构的那一笔带 `base`（面板打开时的 fields / primary，原样）；只改文字不带；
 * 超限的字段名所在字段被删掉 ⟹ 那一格不交（不然整笔被拒，连删字段也存不上）。
 *
 * #1768 起弹窗分页（第一页 · 联系方式 · 成功提示 · 字段列表 · 某一个字段）：①~⑧ 判的东西一样，只是先点进那一页再点；
 * 原来的「快速表单那一格」下拉换成字段页里的开关 + 字段列表上那枚「Short form」标签 —— options() / primaryValue() 读它们。
 * ⑨~⑪ 是 #1768 新的：分页本身、联系方式那一页交什么、开关怎么换 primary。
 *
 * 怎么测：happy-dom 里真挂上面板（hero-render.test.js AC6 同一做法），真点删除、真点 Done，读 onDone 交出来的那一笔。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NEXT = path.resolve(__dirname, '..');
const DIALOG = path.join(NEXT, 'src', 'components', 'editor', 'FormCopyEditor.tsx');

let pass = 0;
let fail = 0;
const check = (cond, m, detail) => {
  if (cond) { pass += 1; console.log(`  ✅ ${m}`); } else { fail += 1; console.log(`  ❌ ${m}${detail ? ` —— ${detail}` : ''}`); }
};
const die = (m) => { console.log(`💥 跑不起来: ${m}`); process.exit(2); };

let ts; let React; let Window;
try {
  ts = require('typescript');
  React = require('react');
  ({ Window } = require('happy-dom'));
} catch (e) { die(`依赖载入不了：${e.message}`); }
if (!fs.existsSync(DIALOG)) die(`找不到 ${path.relative(NEXT, DIALOG)}`);
for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf-8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
}

// 新站默认那一张（#1635）—— 从 site-forms.js 现取，不抄。
const { DEFAULT_SITE_FORMS } = require(path.join(NEXT, 'scripts', 'lib', 'site-forms.js'));
const DEFAULT = DEFAULT_SITE_FORMS[0];

async function mount(form, extra = {}) {
  const win = new Window({ url: 'https://site.example/~editor/home' });
  const g = globalThis;
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
    Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const { FormCopyDialog } = require(DIALOG);
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const host = win.document.createElement('div');
  win.document.body.appendChild(host);
  const got = { done: undefined, cancelled: false };
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(FormCopyDialog, { form, ...extra, onCancel: () => { got.cancelled = true; }, onDone: (e, c) => { got.done = e; got.contact = c; } }));
  });
  const q = (sel) => host.querySelector(sel);
  const click = async (sel) => {
    const el = q(sel);
    if (!el) throw new Error(`页面上没有 ${sel}`);
    await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); });
  };
  const unmount = async () => { await act(async () => { root.unmount(); }); };
  const on = () => q('[data-editor-form-dialog]').getAttribute('data-editor-form-page-on');
  /** 回第一页（一路点 ←）。 */
  const home = async () => { while (on() !== 'main') await click('[data-editor-form-back]'); };
  /** 进某一页：'main' / 'contact' / 'success' / 'fields' / 'field:<f>'。 */
  const go = async (page) => {
    if (on() === page) return;
    await home();
    if (page === 'main') return;
    if (page.startsWith('field:')) {
      await click('[data-editor-form-page="fields"]');
      await click(`[data-editor-form-field-edit="${page.slice(6)}"]`);
      return;
    }
    await click(`[data-editor-form-page="${page}"]`);
  };
  /** 快速表单能露哪几格（字段页里有开关的那几个，按字段顺序）—— 原来下拉的选项。 */
  const options = async () => {
    await go('fields');
    const rows = [...host.querySelectorAll('[data-editor-form-row]')].map((r) => r.getAttribute('data-editor-form-row'));
    const out = [];
    for (const f of rows) { await go(`field:${f}`); if (q(`[data-editor-form-primary="${f}"]`)) out.push(f); }
    await go('fields');
    return out;
  };
  /** 实际露的那一格：字段列表上那枚「Short form」标签。 */
  const primaryValue = async () => {
    await go('fields');
    const t = [...host.querySelectorAll('[data-editor-form-primary-tag]')].map((e) => e.getAttribute('data-editor-form-primary-tag'));
    return t.length === 1 ? t[0] : JSON.stringify(t);
  };
  /** 往一格里打字（React 认的那种：原型上的 value setter + input 事件）。 */
  const type = async (sel, val) => {
    const el = q(sel);
    if (!el) throw new Error(`页面上没有 ${sel}`);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
    await act(async () => { el.dispatchEvent(new win.Event('input', { bubbles: true })); });
  };
  /** #1768 r5 —— 下拉选一项（React 的 select 收 change）。 */
  const pick = async (sel, val) => {
    const el = q(sel);
    if (!el) throw new Error(`页面上没有 ${sel}`);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, val);
    await act(async () => { el.dispatchEvent(new win.Event('change', { bubbles: true })); });
  };
  return { got, q, click, type, pick, options, primaryValue, unmount, go, on };
}

(async () => {
  try {
    console.log('── ① 默认表单：快速表单开关只列联系字段');
    {
      check(JSON.stringify(DEFAULT.fields) === JSON.stringify(['name', 'phone', 'email', 'message']) && DEFAULT.primary === 'phone',
        `前提：新站默认 contact 是 name / phone / email / message，primary phone（现取：${JSON.stringify([DEFAULT.fields, DEFAULT.primary])}）`);
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      check(JSON.stringify((await p.options())) === JSON.stringify(['phone', 'email']), `快速表单开关选项只有 phone / email（读到 ${JSON.stringify((await p.options()))}）`);
      check((await p.primaryValue()) === 'phone', `快速表单开关当前值是 phone（读到 ${(await p.primaryValue())}）`);
      await p.unmount();
    }

    console.log('── ② 一次删除不再造出死表单：删 phone ⟹ primary 落到 email');
    {
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await p.go('fields'); await p.click('[data-editor-form-remove="phone"]');
      check(JSON.stringify((await p.options())) === JSON.stringify(['email']), `删掉 phone 后快速表单开关只剩 email（读到 ${JSON.stringify((await p.options()))}）`);
      check((await p.primaryValue()) === 'email', `快速表单开关当前值落到 email，不是 name（读到 ${(await p.primaryValue())}）`);
      await p.click('[data-editor-form-done]');
      const e = p.got.done;
      check(!!e && JSON.stringify(e.fields) === JSON.stringify(['name', 'email', 'message']) && e.primary === 'email',
        `Done 交出的那一笔：fields ["name","email","message"]、primary email（读到 ${JSON.stringify(e)}）`);
      await p.unmount();
    }

    console.log('── ③ 删的不是 primary ⟹ primary 不动；删到只剩一个联系字段 ⟹ 另一个的删除按钮不可用');
    {
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await p.go('fields'); await p.click('[data-editor-form-remove="name"]');
      check((await p.primaryValue()) === 'phone', `删 name ⟹ primary 仍是 phone（读到 ${(await p.primaryValue())}）`);
      await p.go('fields'); await p.click('[data-editor-form-remove="email"]');
      check(JSON.stringify((await p.options())) === JSON.stringify(['phone']) && (await p.primaryValue()) === 'phone', `再删 email ⟹ 快速表单开关只剩 phone 且选中它（读到 ${JSON.stringify((await p.options()))} / ${(await p.primaryValue())}）`);
      await p.go('fields'); check(p.q('[data-editor-form-remove="phone"]').disabled === true, '这时 phone 的删除按钮不可用（电话 / 邮箱至少留一个）');
      await p.unmount();
    }

    console.log('── ④ 磁盘上 primary 不合格的旧表单：读成落位值；再加一个联系字段，显示的那一格不跳');
    {
      // 磁盘上的 primary 不合格（name）—— 面板读成落位值，不把它当成一个可选项。
      const p = await mount({ id: 'contact', name: 'Contact us', fields: ['name', 'email', 'message'], primary: 'name' });
      check(JSON.stringify((await p.options())) === JSON.stringify(['email']) && (await p.primaryValue()) === 'email',
        `primary 是 name 的旧表单打开 ⟹ 快速表单开关只有 email 且显示 email（读到 ${JSON.stringify((await p.options()))} / ${(await p.primaryValue())}）`);
      // #1768 r5 —— 加自带字段走 Add field 页：Type 里选 Phone → Add field。
      await p.go('fields'); await p.click('[data-editor-form-add-open]'); await p.pick('[data-editor-form-custom-type]', 'field:phone'); await p.click('[data-editor-form-custom-save]');
      check(JSON.stringify((await p.options())) === JSON.stringify(['email', 'phone']), `加 phone ⟹ 快速表单开关 email / phone（按字段顺序；读到 ${JSON.stringify((await p.options()))}）`);
      check((await p.primaryValue()) === 'email', `加 phone 之后快速表单开关仍显示 email（读到 ${(await p.primaryValue())}）`);
      await p.click('[data-editor-form-done]');
      check(p.got.done && JSON.stringify(p.got.done.fields) === JSON.stringify(['name', 'email', 'message', 'phone']) && p.got.done.primary === 'email',
        `Done 交出的那一笔 primary 是 email（看到什么交什么；读到 ${JSON.stringify(p.got.done)}）`);
      await p.unmount();
    }

    console.log('── ⑤ Cancel：什么都不交');
    {
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await p.go('fields'); await p.click('[data-editor-form-remove="phone"]');
      await p.click('[data-editor-form-cancel]');
      check(p.got.cancelled === true && p.got.done === undefined, 'Cancel ⟹ onCancel 被调，onDone 一次都没调');
      await p.unmount();
    }

    // ── #1644 ──
    console.log('── ⑥ #1644 改了结构 ⟹ 那一笔带 base = 面板打开时的 fields / primary（原样，不规整）');
    {
      // 磁盘上带一个词表外的字段（面板不显示它）、primary 不合格 —— base 照样原样交，存盘那一侧拿它跟磁盘原值比。
      const opened = { id: 'contact', name: 'Contact us', fields: ['name', 'phone', 'email', 'message', 'fax'], primary: 'name' };
      const p = await mount({ ...opened, fields: [...opened.fields] });
      await p.go('fields'); await p.click('[data-editor-form-remove="name"]');
      await p.click('[data-editor-form-done]');
      const e = p.got.done;
      check(!!e && JSON.stringify(e.base) === JSON.stringify({ fields: opened.fields, primary: opened.primary }),
        `base 是打开时的原样（读到 ${JSON.stringify(e && e.base)}）`);
      await p.unmount();
      const q = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await q.go('fields'); await q.click('[data-editor-form-remove="name"]');
      await q.click('[data-editor-form-done]');
      check(q.got.done && JSON.stringify(q.got.done.base) === JSON.stringify({ fields: DEFAULT.fields, primary: DEFAULT.primary }),
        `默认表单删 name ⟹ base 是 ${JSON.stringify({ fields: DEFAULT.fields, primary: DEFAULT.primary })}（读到 ${JSON.stringify(q.got.done && q.got.done.base)}）`);
      await q.unmount();
    }

    console.log('── ⑦ #1644 只改按钮文字 / 字段名 ⟹ 那一笔不带 base（也不带 fields）');
    {
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await p.go('main'); await p.type('[data-editor-form-input="buttonText"]', 'Send 1644');
      await p.go('field:phone'); await p.type('[data-editor-form-label="phone"]', 'Mobile');
      await p.click('[data-editor-form-done]');
      const e = p.got.done;
      check(!!e && e.buttonText === 'Send 1644' && e.labels && e.labels.phone === 'Mobile' && !('base' in e) && !('fields' in e),
        `交出 { buttonText, labels }，没有 base / fields（读到 ${JSON.stringify(e)}）`);
      await p.unmount();
    }

    console.log('── ⑧ #1644 AC6：给 phone 填 41 字再删掉 phone ⟹ Done 能点，那一笔里没有 phone 这个 label 键');
    {
      const long = 'x'.repeat(41);
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await p.go('field:phone'); await p.type('[data-editor-form-label="phone"]', long);
      check(p.q('[data-editor-form-done]').disabled === true, '填了 41 字、phone 还在 ⟹ Done 是灰的');
      await p.go('fields'); await p.click('[data-editor-form-remove="phone"]');
      check(p.q('[data-editor-form-done]').disabled === false, '删掉 phone 之后 Done 能点');
      await p.click('[data-editor-form-done]');
      const e = p.got.done;
      check(!!e && JSON.stringify(e.fields) === JSON.stringify(['name', 'email', 'message']) && !(e.labels && 'phone' in e.labels),
        `交出删字段那一笔、labels 里没有 phone（读到 ${JSON.stringify(e)}）`);
      await p.unmount();
      // 反向对照：41 字填在一个仍然留着的字段上 ⟹ Done 灰着、面板说是字段名超了；点了也不交。
      const q = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await q.go('field:email'); await q.type('[data-editor-form-label="email"]', long);
      await q.go('fields'); await q.click('[data-editor-form-remove="phone"]');
      check(q.q('[data-editor-form-done]').disabled === true, '反向对照：41 字在留着的 email 上 ⟹ Done 还是灰的');
      check(/A field name can be at most 40 characters/.test(q.q('[data-editor-form-dialog]').textContent), '反向对照：面板写着「A field name can be at most 40 characters」');
      await q.go('field:email'); check(q.q('[data-editor-form-label="email"]').value === long, '反向对照：超了的那一格就是 email 那一行（它还在面板上，老板改得到）');
      await q.click('[data-editor-form-done]');
      check(q.got.done === undefined, '反向对照：点 Done 什么都没交');
      await q.unmount();
    }

    // ── #1768 ──
    console.log('── ⑨ #1768 分页：第一页标题 = 表单名、三行 + Submit button label + 表单名；子页 ← 回来，子页里改的字还在');
    {
      const biz = { phone: '416-555-0100', email: 'shop@example.com', address: '1 Main St' };
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] }, { business: biz });
      check(p.on() === 'main', `打开在第一页（读到 ${p.on()}）`);
      check(p.q('[data-editor-form-title]').textContent === DEFAULT.name, `标题是表单名「${DEFAULT.name}」（读到「${p.q('[data-editor-form-title]').textContent}」）`);
      const rows = [...p.q('[data-editor-form-dialog]').querySelectorAll('[data-editor-form-section]')].map((e) => e.textContent.replace(/Edit$/, ''));
      check(JSON.stringify(rows) === JSON.stringify(['Contact information', 'Success message', 'Form fields']), `三行依次是联系方式 · 成功提示 · 表单字段（读到 ${JSON.stringify(rows)}）`);
      check(!!p.q('[data-editor-form-input="buttonText"]') && !!p.q('[data-editor-form-input="name"]') && !p.q('[data-editor-form-input="successMessage"]'),
        '第一页有 Submit button label、表单名两格，成功提示不在第一页');
      await p.go('success');
      await p.type('[data-editor-form-input="successMessage"]', 'Thanks 1768');
      await p.click('[data-editor-form-back]');
      check(p.on() === 'main', '成功提示页点 ← ⟹ 回第一页');
      await p.go('success');
      check(p.q('[data-editor-form-input="successMessage"]').value === 'Thanks 1768', '再进成功提示页，刚才打的字还在');
      await p.go('field:email');
      await p.click('[data-editor-form-back]');
      check(p.on() === 'fields', '字段页点 ← ⟹ 回字段列表，不是第一页');
      await p.click('[data-editor-form-done]');
      check(p.got.done && p.got.done.successMessage === 'Thanks 1768' && p.got.contact === null, `在子页上点 Done ⟹ 交出成功提示那一笔、联系方式 null（读到 ${JSON.stringify([p.got.done, p.got.contact])}）`);
      await p.unmount();
      const n = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      check(!n.q('[data-editor-form-section="contact"]'), '不传 business ⟹ 没有联系方式那一行');
      await n.unmount();
    }

    console.log('── ⑩ #1768 联系方式：Done 只交改过的那几格；只改联系方式 ⟹ 表单那一笔是 null；Cancel（在子页改过）什么都不交');
    {
      const biz = { phone: '416-555-0100', email: 'shop@example.com', address: '1 Main St' };
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] }, { business: biz });
      await p.go('contact');
      check(p.q('[data-editor-form-contact-note]').textContent === 'Shown on your whole website', '页面顶上那句「Shown on your whole website」');
      check(['phone', 'email', 'address'].every((k) => p.q(`[data-editor-form-contact="${k}"]`).value === biz[k]), '三格的现值是站里的资料');
      await p.type('[data-editor-form-contact="phone"]', '416-555-0199');
      await p.click('[data-editor-form-done]');
      check(p.got.done === null && JSON.stringify(p.got.contact) === JSON.stringify({ phone: '416-555-0199' }),
        `交出 (null, {phone})（读到 ${JSON.stringify([p.got.done, p.got.contact])}）`);
      await p.unmount();
      const q = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] }, { business: biz });
      await q.go('contact');
      await q.type('[data-editor-form-contact="email"]', 'other@example.com');
      await q.go('success');
      await q.type('[data-editor-form-input="successMessage"]', 'Should not stay');
      await q.click('[data-editor-form-back]');
      await q.click('[data-editor-form-cancel]');
      check(q.got.cancelled === true && q.got.done === undefined && q.got.contact === undefined, 'Cancel ⟹ onDone 一次都没调（联系方式、成功提示都没交）');
      await q.unmount();
    }

    console.log('── ⑪ #1768 字段页的「Show this one in the short form」开关 = primary');
    {
      const p = await mount({ ...DEFAULT, fields: [...DEFAULT.fields] });
      await p.go('field:email');
      check(p.q('[data-editor-form-primary="email"]').checked === false, 'email 的开关一开始是关的（默认 primary phone）');
      await p.click('[data-editor-form-primary="email"]');
      check((await p.primaryValue()) === 'email', `开 email ⟹ 字段列表上的 Short form 挪到 email（读到 ${await p.primaryValue()}）`);
      await p.go('field:phone');
      check(p.q('[data-editor-form-primary="phone"]').checked === false, '同时 phone 的开关自动关了');
      await p.go('field:name');
      check(!p.q('[data-editor-form-primary="name"]'), 'name 不是联系字段 ⟹ 没有这个开关');
      await p.go('fields'); await p.click('[data-editor-form-remove="phone"]');
      await p.go('field:email');
      check(p.q('[data-editor-form-primary="email"]').disabled === true, '只剩 email 一个联系字段 ⟹ 它的开关灰着（关不掉）');
      await p.click('[data-editor-form-done]');
      check(p.got.done && p.got.done.primary === 'email', `Done ⟹ primary email（读到 ${JSON.stringify(p.got.done)}）`);
      await p.unmount();
    }
  } catch (e) {
    fail += 1;
    console.log(`  ❌ happy-dom 那一段抛了：${e.stack || e.message}`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} #1637 FormCopyDialog primary：${pass} 通过 · ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
