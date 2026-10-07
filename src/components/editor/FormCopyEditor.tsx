'use client';

// #1634 —— 编辑器里改表单文案：块的 `form` 槽下面那一格（选哪张表单 + 「Edit this form」）和点它弹出的面板。
//
// 表单是站级资产（#1471，`site/<语言>/forms.json`）：块里只存 `form.id`，按钮字 / 成功提示 / 表单名住在表单库里，
// 改一处所有用这张表单的块都变 —— 所以这里改的不是这个块，是表单库里那一张。面板里 Done 才交（EditorApp 把它
// 当成这一次存盘的一部分发出去：`ai1st:editor-save` 多带一个 `forms` 键），Cancel 什么都不交。
//
// 🔴 只改三样文字（`site-forms.js` §COPY_CAPS 那三个键，上限也取那里）。字段 / `primary` / 增删整张表单是 #1637。
// 🔴 清空一格 = 交一个空串 = 站里删掉这个键、回到默认那句（`BlockLeadForm` 自己的默认）。
// 🔴 站里只有一张表单时不画下拉（选不了别的），只留按钮。

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { COPY_CAPS, formIdOptions } from '../../../scripts/lib/site-forms.js';

/** 站级表单库里一张的摘要：下拉要 id / name，面板要三句文字的现值。 */
export interface EditorFormChoice { id: string; name: string; buttonText?: string; successMessage?: string }

/** 面板交出来的一笔：只带改过的键；空串 = 删掉这个键。 */
export interface FormCopyEdit { id: string; name?: string; buttonText?: string; successMessage?: string }

type CopyKey = 'name' | 'buttonText' | 'successMessage';
const KEYS: CopyKey[] = ['buttonText', 'successMessage', 'name'];
const LABEL: Record<CopyKey, string> = { buttonText: 'Button text', successMessage: 'Success message', name: 'Form name' };
const HINT: Record<CopyKey, string> = {
  buttonText: 'Shown on the submit button.',
  successMessage: 'Shown after a visitor sends the form. Leave empty to use the default.',
  name: 'Only you see this — it names the form in this list.',
};
const CAPS = COPY_CAPS as Record<CopyKey, number>;

/** EditorApp 递下来的：这个语言的表单库（存成功之后会换成新的）、打开面板、画布是不是锁着。 */
export const FormsContext = createContext<{ forms: EditorFormChoice[]; editForm: (id: string) => void; locked: boolean }>({
  forms: [], editForm: () => {}, locked: false,
});

/** 选哪张表单的下拉（不止一张时才有）+「Edit this form」。值是 `form.id`，空 = 第一张。 */
export function FormIdField({ value, onChange, readOnly }: { value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  const { forms, editForm, locked } = useContext(FormsContext);
  const id = typeof value === 'string' ? value : '';
  const current = forms.find((f) => f.id === id) || forms[0];
  return (
    <div data-editor-form-field>
      {forms.length > 1 && (
        <label style={{ display: 'block', marginBottom: 8 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Form</span>
          <select
            data-editor-form-select
            value={id}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: '100%', padding: 6, border: '1px solid #d0d5dd', borderRadius: 6 }}
          >
            {/* 选项与文字同 #1471 那个下拉（`site-forms.js` §formIdOptions）：第一项 = 留空 = 用第一张。 */}
            {formIdOptions(forms).map((o: { label: string; value: string }) => <option key={o.value || '_first'} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {current && (
        <button
          type="button"
          data-editor-form-edit={current.id}
          disabled={readOnly || locked}
          onClick={() => editForm(current.id)}
          style={{ width: '100%', padding: '6px 10px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
        >
          Edit this form
        </button>
      )}
    </div>
  );
}

/** 「Edit this form」弹出的面板。Done ⟹ 回改过的那几格（一格没改 ⟹ null）；Cancel ⟹ 什么都不回。 */
export function FormCopyDialog({ form, onCancel, onDone }: { form: EditorFormChoice; onCancel: () => void; onDone: (edit: FormCopyEdit | null) => void }) {
  const [vals, setVals] = useState<Record<CopyKey, string>>({
    name: form.name || '', buttonText: form.buttonText || '', successMessage: form.successMessage || '',
  });
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const over = KEYS.filter((k) => Array.from(vals[k].trim()).length > CAPS[k]);
  const done = () => {
    if (over.length) return;
    const edit: FormCopyEdit = { id: form.id };
    for (const k of KEYS) {
      const next = vals[k].trim();
      if (next !== (form[k] || '')) edit[k] = next;
    }
    onDone(Object.keys(edit).length > 1 ? edit : null);
  };
  return (
    <div
      data-editor-form-dialog={form.id}
      role="dialog"
      aria-modal="true"
      aria-label="Edit form"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(16,24,40,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, width: 'min(440px, calc(100vw - 32px))', boxShadow: '0 12px 32px rgba(16,24,40,.24)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Edit form</div>
        <div style={{ fontSize: 13, color: '#667085', marginBottom: 16 }}>Changes apply everywhere this form is used on the website.</div>
        {KEYS.map((k, i) => {
          const n = Array.from(vals[k].trim()).length;
          const big = k === 'successMessage';
          const common = {
            'data-editor-form-input': k,
            value: vals[k],
            onChange: (e: { target: { value: string } }) => setVals((v) => ({ ...v, [k]: e.target.value })),
            style: { width: '100%', padding: 8, border: `1px solid ${n > CAPS[k] ? '#d92d20' : '#d0d5dd'}`, borderRadius: 6, fontFamily: 'inherit', fontSize: 14 },
          };
          return (
            <label key={k} style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                <span>{LABEL[k]}</span>
                <span style={{ fontWeight: 400, color: n > CAPS[k] ? '#d92d20' : '#98a2b3' }}>{`${n} / ${CAPS[k]}`}</span>
              </span>
              {big
                ? <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }} />
                : <input {...common} ref={i === 0 ? first : undefined} type="text" />}
              <span style={{ display: 'block', fontSize: 12, color: '#667085', marginTop: 4 }}>{HINT[k]}</span>
            </label>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" data-editor-form-cancel onClick={onCancel}
            style={{ padding: '6px 14px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>Cancel</button>
          <button type="button" data-editor-form-done onClick={done} disabled={over.length > 0}
            style={{ padding: '6px 14px', border: 0, borderRadius: 6, background: over.length ? '#98a2b3' : '#1570ef', color: '#fff', cursor: over.length ? 'not-allowed' : 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** 一笔改动套到表单库上（存成功之后编辑器手上那份跟着换）。空串 = 删掉这个键。 */
export function applyFormCopyEdit(forms: EditorFormChoice[], edit: FormCopyEdit): EditorFormChoice[] {
  return forms.map((f) => {
    if (f.id !== edit.id) return f;
    const next: EditorFormChoice = { ...f };
    for (const k of KEYS) {
      if (!(k in edit)) continue;
      const v = edit[k];
      if (v) next[k] = v;
      else if (k === 'name') next.name = '';
      else delete next[k];
    }
    return next;
  });
}
