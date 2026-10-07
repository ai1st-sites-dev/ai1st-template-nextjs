'use client';

// #1634 —— 编辑器里改表单文案：块的 `form` 槽下面那一格（选哪张表单 + 「Edit this form」）和点它弹出的面板。
//
// 表单是站级资产（#1471，`site/<语言>/forms.json`）：块里只存 `form.id`，按钮字 / 成功提示 / 表单名住在表单库里，
// 改一处所有用这张表单的块都变 —— 所以这里改的不是这个块，是表单库里那一张。面板里 Done 才交（EditorApp 把它
// 当成这一次存盘的一部分发出去：`ai1st:editor-save` 多带一个 `forms` 键），Cancel 什么都不交。
//
// 🔴 三样文字（`site-forms.js` §COPY_CAPS 那三个键，上限也取那里）+ #1637 的字段：增删、拖动换顺序、字段名（`labels`，
//    上限 §LABEL_CAP）、快速表单露哪一格（`primary`）。不加 / 删整张表单、不改 id、不改跳转。
// 🔴 字段词表是封闭的（§FORM_FIELDS）；「加 xxx」只给还没用上的。删到既没有电话也没有邮箱 ⟹ 删除按钮不可用并写出原因，
//    判据是 §lacksContactField（站里校验、存盘用的同一个），不另写一份。
// 🔴 删掉的字段正好是 `primary` ⟹ `primary` 落到剩下的第一个（存盘那一侧 `forms-write.js` 也这么落）。
// 🔴 清空一格 = 交一个空串 = 站里删掉这个键、回到默认那句（`BlockLeadForm` 自己的默认 / 语言默认）。
// 🔴 站里只有一张表单时不画下拉（选不了别的），只留按钮。

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { COPY_CAPS, FORM_FIELDS, LABEL_CAP, formIdOptions, lacksContactField } from '../../../scripts/lib/site-forms.js';

export type FormField = 'name' | 'phone' | 'email' | 'message' | 'service';
type Labels = Partial<Record<FormField, string>>;

/** 站级表单库里一张的摘要：下拉要 id / name，面板要三句文字、字段、字段名的现值。 */
export interface EditorFormChoice {
  id: string; name: string; buttonText?: string; successMessage?: string;
  fields?: FormField[]; primary?: FormField; labels?: Labels;
}

/** 面板交出来的一笔：只带改过的键；空串 = 删掉这个键。改了字段就连 `primary` 一起带（各语言一致，存盘写到每个语言）。 */
export interface FormCopyEdit {
  id: string; name?: string; buttonText?: string; successMessage?: string;
  fields?: FormField[]; primary?: FormField; labels?: Labels;
}

type CopyKey = 'name' | 'buttonText' | 'successMessage';
const KEYS: CopyKey[] = ['buttonText', 'successMessage', 'name'];
const LABEL: Record<CopyKey, string> = { buttonText: 'Button text', successMessage: 'Success message', name: 'Form name' };
const HINT: Record<CopyKey, string> = {
  buttonText: 'Shown on the submit button.',
  successMessage: 'Shown after a visitor sends the form. Leave empty to use the default.',
  name: 'Only you see this — it names the form in this list.',
};
const CAPS = COPY_CAPS as Record<CopyKey, number>;
const VOCAB = FORM_FIELDS as FormField[];
/** 字段是哪一种（行里那个小标签、「加 xxx」按钮、`primary` 下拉）—— 老板没改名时访客看到的是语言默认那句。 */
const KIND: Record<FormField, string> = { name: 'Name', phone: 'Phone', email: 'Email', message: 'Message', service: 'Service' };
const WHY_CONTACT = 'Phone and Email can’t both be removed — visitors must leave one of them to send the form.';
const WHY_LAST = 'A form needs at least one field.';
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

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
  const startFields = (form.fields || []).filter((f) => VOCAB.includes(f));
  const [fields, setFields] = useState<FormField[]>(startFields);
  const [primary, setPrimary] = useState<FormField | undefined>(form.primary);
  const [labels, setLabels] = useState<Labels>({ ...(form.labels || {}) });
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const over = KEYS.filter((k) => Array.from(vals[k].trim()).length > CAPS[k]);
  const labelLen = (f: FormField) => Array.from((labels[f] || '').trim()).length;
  const labelsOver = fields.filter((f) => labelLen(f) > LABEL_CAP);
  const blocked = over.length > 0 || labelsOver.length > 0;
  /** 这一格删不删得掉；删不掉时回原因那句。 */
  const whyKeep = (f: FormField): string | null => {
    const rest = fields.filter((x) => x !== f);
    if (!rest.length) return WHY_LAST;
    return lacksContactField(rest) ? WHY_CONTACT : null;
  };
  const remove = (f: FormField) => {
    if (whyKeep(f)) return;
    const rest = fields.filter((x) => x !== f);
    setFields(rest);
    if (primary === f || !primary || !rest.includes(primary)) setPrimary(rest[0]);
  };
  const add = (f: FormField) => {
    setFields((list) => (list.includes(f) ? list : [...list, f]));
    if (!primary) setPrimary(f);
  };
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= fields.length || to >= fields.length) return;
    setFields((list) => { const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next; });
  };
  const why = fields.map(whyKeep).find((w) => w === WHY_CONTACT) || (fields.length === 1 ? WHY_LAST : null);
  const done = () => {
    if (blocked) return;
    const edit: FormCopyEdit = { id: form.id };
    for (const k of KEYS) {
      const next = vals[k].trim();
      if (next !== (form[k] || '')) edit[k] = next;
    }
    // 字段 / primary：任一变了就两样一起交（存盘那一侧按「各语言一致」写进每个语言）。
    if (fields.length && (!sameList(fields, startFields) || primary !== form.primary)) {
      edit.fields = fields;
      edit.primary = primary && fields.includes(primary) ? primary : fields[0];
    }
    // 字段名：只交变了的那几格（只写这个语言）；空串 = 回到默认。
    const changed: Labels = {};
    for (const f of VOCAB) {
      const next = (labels[f] || '').trim();
      if (next !== ((form.labels && form.labels[f]) || '').trim()) changed[f] = next;
    }
    if (Object.keys(changed).length) edit.labels = changed;
    onDone(Object.keys(edit).length > 1 ? edit : null);
  };
  const row = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } as const;
  const small = { padding: '4px 8px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 } as const;
  return (
    <div
      data-editor-form-dialog={form.id}
      role="dialog"
      aria-modal="true"
      aria-label="Edit form"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(16,24,40,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 12px 32px rgba(16,24,40,.24)' }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Edit form</div>
        <div style={{ fontSize: 13, color: '#667085', marginBottom: 16 }}>Changes apply everywhere this form is used on the website.</div>
        {startFields.length > 0 && (
          <div data-editor-form-fields style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Fields</div>
            <div style={{ fontSize: 12, color: '#667085', marginBottom: 6 }}>Drag to reorder. The name is what visitors see in the empty box — leave it empty to use the default.</div>
            {fields.map((f, i) => {
              const keep = whyKeep(f);
              const n = labelLen(f);
              return (
                <div
                  key={f}
                  data-editor-form-row={f}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
                  style={{ ...row, opacity: dragFrom === i ? 0.5 : 1 }}
                >
                  {/* 只有把手可拖：整行可拖的话，名字那一格里没法用鼠标选字。 */}
                  <span data-editor-form-handle draggable aria-hidden="true" title="Drag to reorder"
                    onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f); }}
                    onDragEnd={() => setDragFrom(null)}
                    style={{ cursor: 'grab', color: '#98a2b3', padding: '0 2px', userSelect: 'none' }}>⋮⋮</span>
                  <span style={{ width: 64, flex: 'none', fontSize: 12, color: '#667085' }}>{KIND[f]}</span>
                  <input
                    data-editor-form-label={f}
                    type="text"
                    value={labels[f] || ''}
                    // 空 = 访客看到语言默认那句（`BlockLeadForm`，#1631 那一层）—— 这里不抄那句，免得两处各写一份。
                    placeholder="Default"
                    aria-label={`${KIND[f]} field name`}
                    onChange={(e) => setLabels((l) => ({ ...l, [f]: e.target.value }))}
                    style={{ flex: 1, minWidth: 0, padding: 6, border: `1px solid ${n > LABEL_CAP ? '#d92d20' : '#d0d5dd'}`, borderRadius: 6, fontSize: 14 }}
                  />
                  <button type="button" data-editor-form-remove={f} disabled={!!keep} title={keep || `Remove ${KIND[f]}`} aria-label={`Remove ${KIND[f]}`}
                    onClick={() => remove(f)} style={{ ...small, cursor: keep ? 'not-allowed' : 'pointer', color: keep ? '#d0d5dd' : '#344054' }}>✕</button>
                </div>
              );
            })}
            {labelsOver.length > 0 && (
              <div style={{ fontSize: 12, color: '#d92d20', marginBottom: 6 }}>{`A field name can be at most ${LABEL_CAP} characters.`}</div>
            )}
            {why && <div data-editor-form-remove-why style={{ fontSize: 12, color: '#93370d', marginBottom: 6 }}>{why}</div>}
            {VOCAB.some((f) => !fields.includes(f)) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {VOCAB.filter((f) => !fields.includes(f)).map((f) => (
                  <button key={f} type="button" data-editor-form-add={f} onClick={() => add(f)} style={small}>{`+ Add ${KIND[f]}`}</button>
                ))}
              </div>
            )}
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Quick form field</span>
              <select data-editor-form-primary value={primary && fields.includes(primary) ? primary : fields[0]}
                onChange={(e) => setPrimary(e.target.value as FormField)}
                style={{ width: '100%', padding: 6, border: '1px solid #d0d5dd', borderRadius: 6 }}>
                {fields.map((f) => <option key={f} value={f}>{(labels[f] || '').trim() || KIND[f]}</option>)}
              </select>
              <span style={{ display: 'block', fontSize: 12, color: '#667085', marginTop: 4 }}>The short version of this form shows only this one box.</span>
            </label>
          </div>
        )}
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
          <button type="button" data-editor-form-done onClick={done} disabled={blocked}
            style={{ padding: '6px 14px', border: 0, borderRadius: 6, background: blocked ? '#98a2b3' : '#1570ef', color: '#fff', cursor: blocked ? 'not-allowed' : 'pointer' }}>Done</button>
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
    if (edit.fields) next.fields = [...edit.fields];
    if (edit.primary) next.primary = edit.primary;
    if (edit.labels) {
      const labels: Labels = { ...(f.labels || {}) };
      for (const [k, v] of Object.entries(edit.labels) as [FormField, string][]) {
        if (v) labels[k] = v; else delete labels[k];
      }
      if (Object.keys(labels).length) next.labels = labels; else delete next.labels;
    }
    return next;
  });
}
