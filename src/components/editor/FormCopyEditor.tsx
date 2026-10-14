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
// 🔴 `primary`（快速表单露的那一格）只能是联系字段：下拉只列 §primaryChoices，删掉的正好是 `primary` ⟹ 落到剩下的
//    第一个联系字段（r4；存盘那一侧 `forms-write.js` 用同一个函数落、同一个函数拒）。
// 🔴 清空一格 = 交一个空串 = 站里删掉这个键、回到默认那句（`BlockLeadForm` 自己的默认 / 语言默认）。
// 🔴 站里只有一张表单时不画下拉（选不了别的），只留按钮。
// #1768 —— 弹窗分页（照 Durable）：第一页三行（联系方式 · 成功提示 · 表单字段）各点进子页 + Submit button label + 表单名；
//    字段列表每行 Edit 再进一层改字段名 / 快速表单露不露这一格（`primary`，原来那个下拉）。多了一页「联系方式」：改的是站里的资料
//    （Page 面板 Business info 那三格，整站一份），跟表单那一笔同一个 Done / Cancel。入口多一个：块的浮动条上那颗 Edit form（EditorApp §BlockBar）。

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { COPY_CAPS, FORM_FIELDS, LABEL_CAP, formIdOptions, lacksContactField, primaryChoices } from '../../../scripts/lib/site-forms.js';

export type FormField = 'name' | 'phone' | 'email' | 'message' | 'service';
type Labels = Partial<Record<FormField, string>>;

/** 站级表单库里一张的摘要：下拉要 id / name，面板要三句文字、字段、字段名的现值。 */
export interface EditorFormChoice {
  id: string; name: string; buttonText?: string; successMessage?: string;
  fields?: FormField[]; primary?: FormField; labels?: Labels;
}

/** 面板交出来的一笔：只带改过的键；空串 = 删掉这个键。改了字段就连 `primary` 一起带（各语言一致，存盘写到每个语言）。
 *  #1644 —— 带了 `fields` 就带 `base`：面板打开时这张表单的 `fields` / `primary`（原样）。存盘那一侧拿它跟磁盘比，
 *  对不上 ⟹ 编辑器手上那份结构是旧的（重建前烤进去的），这一笔会把别处那次改动改回去 ⟹ 退出码 10、不写。 */
export interface FormCopyEdit {
  id: string; name?: string; buttonText?: string; successMessage?: string;
  fields?: FormField[]; primary?: FormField; labels?: Labels;
  base?: { fields?: FormField[]; primary?: FormField };
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
// #1768 —— `canvasForms`：画布按它画表单（= `forms` 再套上 Done 了、还在交的那一笔）。
export const FormsContext = createContext<{ forms: EditorFormChoice[]; canvasForms: EditorFormChoice[]; editForm: (id: string) => void; locked: boolean }>({
  forms: [], canvasForms: [], editForm: () => {}, locked: false,
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

/** #1768 —— 站里的联系方式（Page 面板「Business info」那三格，Puck root 的 `phone` / `email` / `address`，整站一份）。 */
export type BusinessContact = { phone: string; email: string; address: string };
type ContactKey = keyof BusinessContact;
const CONTACT_KEYS: ContactKey[] = ['phone', 'email', 'address'];
const CONTACT_LABEL: Record<ContactKey, string> = { phone: 'Phone', email: 'Email', address: 'Address' };

/** #1768 —— 弹窗分页：第一页 + 三个子页（联系方式 / 成功提示 / 字段列表），字段列表再往下一层是某一个字段。 */
type Page = 'main' | 'contact' | 'success' | 'fields' | `field:${FormField}`;
const PAGE_TITLE: Record<'contact' | 'success' | 'fields', string> = {
  contact: 'Business contact information', success: 'Success message', fields: 'Form fields',
};

/** 照 #1755 按钮弹窗（EditorApp §POPOVER / §POPOVER_BTN）：同宽、同圆角、同字号。 */
const BOX = { width: 'min(520px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#fff', border: '1px solid #d0d5dd', borderRadius: 12, boxShadow: '0 12px 32px rgba(16, 24, 40, 0.18)', fontFamily: 'system-ui, sans-serif', fontSize: 13, color: '#344054', lineHeight: 1.3 } as const;
const BTN = { padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' } as const;
const FIELD_LABEL = { display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 500, color: '#344054', marginBottom: 4 } as const;
const HELP = { display: 'block', fontSize: 12, color: '#667085', marginTop: 4 } as const;
const svg = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
// lucide contact / circle-check / list
const ICON = {
  contact: svg('M16 2v2M8 2v2M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 20a5 5 0 0 1 10 0'),
  success: svg('M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3'),
  fields: svg('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
};

/**
 * 「Edit form」弹窗（#1768 起分页，照 Durable 的 Contact form）。入口两个：块的浮动条上那颗 Edit form、Content 页里「Edit this form」。
 *   第一页：标题 = 表单名；三行（联系方式 / 成功提示 / 表单字段）各点进子页；Submit button label 一格；最下面表单名一格。
 *   子页左上角 ← 回上一层。Cancel / Done 每一页都有：Done 把所有页改过的一起交，Cancel 什么都不交（包括子页里改过的）。
 * Done ⟹ `onDone(表单那一笔 | null, 联系方式改过的那几格 | null)`；两样都没改 ⟹ 两个 null。
 * 🔴 两样存储不同：表单文案 / 字段名按语言（`forms.json`），联系方式整站一份（`brand.json`）—— 联系方式子页顶上那句说的就是这个。
 *    在这里只管「改了什么」，怎么交由 EditorApp 管（表单那一笔照旧经存盘的 `forms` 键，联系方式写进 Puck root，同 Page 面板）。
 * `business` 不传 ⟹ 没有联系方式那一行。`fieldNames` = 访客看到的语言默认字段名（老板没改名时那一行显示它）；不传 ⟹ 字段种类名。
 */
export function FormCopyDialog({ form, business, fieldNames, onCancel, onDone }: {
  form: EditorFormChoice;
  business?: BusinessContact;
  fieldNames?: Partial<Record<FormField, string>>;
  onCancel: () => void;
  onDone: (edit: FormCopyEdit | null, contact?: Partial<BusinessContact> | null) => void;
}) {
  const [vals, setVals] = useState<Record<CopyKey, string>>({
    name: form.name || '', buttonText: form.buttonText || '', successMessage: form.successMessage || '',
  });
  const [contact, setContact] = useState<BusinessContact>({ phone: business?.phone || '', email: business?.email || '', address: business?.address || '' });
  const startFields = (form.fields || []).filter((f) => VOCAB.includes(f));
  const [fields, setFields] = useState<FormField[]>(startFields);
  const [primary, setPrimary] = useState<FormField | undefined>(form.primary);
  const [labels, setLabels] = useState<Labels>({ ...(form.labels || {}) });
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [page, setPage] = useState<Page>('main');
  const [adding, setAdding] = useState(false);
  // Esc 收在 document 上，不挂在对话框元素上：点它的标题字 / 遮罩、或点掉一颗随即消失的「+ Add」按钮后，焦点在 <body>，
  // 元素上的 onKeyDown 收不到 ⟹ 对话框关不掉（#1735 r3）。
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // 焦点出不去（#1735 r4）：对话框开着时，编辑器页别处、画布 iframe（Design 面板就在里面）都不许拿到焦点 ——
  // 拿到了，那里的按键会按「对话框不在」的规矩走（顶栏撤销按钮上按 Enter、面板里按 Esc 都会 Cancel 面板）。
  // 遮罩挡住了鼠标，这里挡键盘（Tab 出去）和程序挪焦点。焦点落到 <body>（点掉一颗随即消失的按钮）也拉回来。
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // 焦点去了外面那一层（dashboard）不拉：那时这边 activeElement 也会落回 <body>，只能靠 hasFocus() 分 ——
    // 子 iframe（画布）拿着焦点算 true，父页面拿着算 false。
    const back = () => { if (!document.hasFocus()) return; const a = document.activeElement; if (!a || !root.contains(a)) root.focus(); };
    const onFocusIn = (e: FocusEvent) => { if (!root.contains(e.target as Node)) back(); };
    // 焦点进了 iframe：编辑器页这边只看到自己失焦（activeElement 变成那个 <iframe>），等它落定再拉。
    const later = () => { setTimeout(back, 0); };
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('blur', later);
    root.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('blur', later);
      root.removeEventListener('focusout', later);
    };
  }, []);
  // 换一页 ⟹ 光标进这一页的第一格（没有输入格的页 ⟹ 对话框根元素，焦点照旧留在对话框里）。
  useEffect(() => {
    const root = rootRef.current;
    const first = root?.querySelector<HTMLElement>('input[type="text"], textarea');
    (first || root)?.focus();
    setAdding(false);
  }, [page]);
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
  /** `primary` 现在能取哪些 / 实际是哪个（磁盘上的不合格时按落位规则读）。 */
  const choices = primaryChoices(fields) as FormField[];
  const shownPrimary = primary && choices.includes(primary) ? primary : choices[0];
  const remove = (f: FormField) => {
    if (whyKeep(f)) return;
    const rest = fields.filter((x) => x !== f);
    setFields(rest);
    const left = primaryChoices(rest) as FormField[];
    if (!primary || !left.includes(primary)) setPrimary(left[0]);
  };
  const add = (f: FormField) => {
    setFields((list) => (list.includes(f) ? list : [...list, f]));
    setAdding(false);
  };
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= fields.length || to >= fields.length) return;
    setFields((list) => { const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next; });
  };
  const why = fields.map(whyKeep).find((w) => w === WHY_CONTACT) || (fields.length === 1 ? WHY_LAST : null);
  /** 这一行显示的字段名：老板改过的名字；没改过 ⟹ 访客看到的语言默认那句。 */
  const nameOf = (f: FormField) => (labels[f] || '').trim() || fieldNames?.[f] || KIND[f];
  /** 超限的都在哪一页（Done 灰着时第一页底下说清楚是哪一格）。 */
  const blockedWhy = [
    ...over.map((k) => `${k === 'buttonText' ? 'Submit button label' : LABEL[k]} is too long.`),
    ...(labelsOver.length ? [`A field name can be at most ${LABEL_CAP} characters.`] : []),
  ];
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
      edit.primary = shownPrimary;
      edit.base = { fields: form.fields, primary: form.primary };
    }
    // 字段名：只交变了的那几格（只写这个语言）；空串 = 回到默认。
    const changed: Labels = {};
    for (const f of VOCAB) {
      const next = (labels[f] || '').trim();
      // #1644 —— 超限、而这个字段已经删掉了：这串字是这次刚打的、从没存过，面板上也没有它那一行（Done 的闸只看还在的
      //    字段，老板看不见也改不了）⟹ 不交。交上去会被整笔拒收，连删字段那一步也存不上。
      if (!fields.includes(f) && Array.from(next).length > LABEL_CAP) continue;
      if (next !== ((form.labels && form.labels[f]) || '').trim()) changed[f] = next;
    }
    if (Object.keys(changed).length) edit.labels = changed;
    // 联系方式：只交改过的那几格（空串 = 清掉，同 Page 面板）。
    const touched: Partial<BusinessContact> = {};
    if (business) for (const k of CONTACT_KEYS) if (contact[k].trim() !== business[k].trim()) touched[k] = contact[k].trim();
    onDone(Object.keys(edit).length > 1 ? edit : null, Object.keys(touched).length ? touched : null);
  };
  const inputStyle = (bad: boolean) => ({ width: '100%', boxSizing: 'border-box', padding: 8, border: `1px solid ${bad ? '#d92d20' : '#d0d5dd'}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 13 } as const);
  const small = { padding: '4px 8px', border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' } as const;
  /** 第一页 / 成功提示页那几格文字（带字数）。 */
  const copyInput = (k: CopyKey, label: string) => {
    const n = Array.from(vals[k].trim()).length;
    const common = {
      'data-editor-form-input': k,
      value: vals[k],
      onChange: (e: { target: { value: string } }) => setVals((v) => ({ ...v, [k]: e.target.value })),
      style: inputStyle(n > CAPS[k]),
    };
    return (
      <label key={k} style={{ display: 'block', marginBottom: 14 }}>
        <span style={FIELD_LABEL}>
          <span>{label}</span>
          <span style={{ fontWeight: 400, color: n > CAPS[k] ? '#d92d20' : '#98a2b3' }}>{`${n} / ${CAPS[k]}`}</span>
        </span>
        {k === 'successMessage'
          ? <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }} />
          : <input {...common} type="text" />}
        <span style={HELP}>{HINT[k]}</span>
      </label>
    );
  };
  const back = (to: Page) => (
    <button type="button" data-editor-form-back="" aria-label="Back" onClick={() => setPage(to)}
      style={{ border: 0, background: 'none', padding: '0 6px 0 0', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#344054', fontFamily: 'inherit' }}>←</button>
  );
  let title: ReactNode;
  let body: ReactNode;
  if (page === 'main') {
    title = vals.name.trim() || form.name || 'Form';
    const rows: ('contact' | 'success' | 'fields')[] = [...(business ? ['contact' as const] : []), 'success', 'fields'];
    body = (
      <>
        <div style={{ fontSize: 13, color: '#667085', marginBottom: 12 }}>Changes apply everywhere this form is used on the website.</div>
        <div style={{ border: '1px solid #eaecf0', borderRadius: 8, marginBottom: 16 }}>
          {rows.map((r, i) => (
            <div key={r} data-editor-form-section={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid #eaecf0' : 0 }}>
              <span style={{ color: '#667085', display: 'inline-flex' }}>{ICON[r]}</span>
              <span style={{ flex: 1, fontWeight: 500, color: '#101828' }}>{PAGE_TITLE[r]}</span>
              <button type="button" data-editor-form-page={r} onClick={() => setPage(r)} style={small}>Edit</button>
            </div>
          ))}
        </div>
        {copyInput('buttonText', 'Submit button label')}
        {copyInput('name', LABEL.name)}
      </>
    );
  } else if (page === 'contact') {
    title = <>{back('main')}{PAGE_TITLE.contact}</>;
    body = (
      <>
        <div data-editor-form-contact-note="" style={{ fontSize: 13, color: '#667085', marginBottom: 12 }}>Shown on your whole website</div>
        {CONTACT_KEYS.map((k) => (
          <label key={k} style={{ display: 'block', marginBottom: 14 }}>
            <span style={FIELD_LABEL}><span>{CONTACT_LABEL[k]}</span></span>
            <input type="text" data-editor-form-contact={k} value={contact[k]} onChange={(e) => setContact((c) => ({ ...c, [k]: e.target.value }))} style={inputStyle(false)} />
          </label>
        ))}
      </>
    );
  } else if (page === 'success') {
    title = <>{back('main')}{PAGE_TITLE.success}</>;
    body = copyInput('successMessage', LABEL.successMessage);
  } else if (page === 'fields') {
    title = <>{back('main')}{PAGE_TITLE.fields}</>;
    const unused = VOCAB.filter((f) => !fields.includes(f));
    body = (
      <div data-editor-form-fields="">
        <div style={{ fontSize: 12, color: '#667085', marginBottom: 8 }}>Drag to reorder. The name is what visitors see in the empty box.</div>
        {fields.map((f, i) => {
          const keep = whyKeep(f);
          return (
            <div
              key={f}
              data-editor-form-row={f}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 6, border: '1px solid #eaecf0', borderRadius: 8, opacity: dragFrom === i ? 0.5 : 1 }}
            >
              {/* 只有把手可拖（同 #1637）。 */}
              <span data-editor-form-handle draggable aria-hidden="true" title="Drag to reorder"
                onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f); }}
                onDragEnd={() => setDragFrom(null)}
                style={{ cursor: 'grab', color: '#98a2b3', padding: '0 2px', userSelect: 'none' }}>⋮⋮</span>
              <span data-editor-form-row-name={f} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: labelLen(f) > LABEL_CAP ? '#d92d20' : '#101828' }}>{nameOf(f)}</span>
              {shownPrimary === f && <span data-editor-form-primary-tag={f} title="Shown in the short form" style={{ fontSize: 11, color: '#175cd3', background: '#eff8ff', borderRadius: 999, padding: '1px 8px' }}>Short form</span>}
              <button type="button" data-editor-form-field-edit={f} onClick={() => setPage(`field:${f}`)} style={small}>Edit</button>
              <button type="button" data-editor-form-remove={f} disabled={!!keep} title={keep || `Remove ${KIND[f]}`} aria-label={`Remove ${KIND[f]}`}
                onClick={() => remove(f)} style={{ ...small, cursor: keep ? 'not-allowed' : 'pointer', color: keep ? '#d0d5dd' : '#344054' }}>🗑</button>
            </div>
          );
        })}
        {why && <div data-editor-form-remove-why style={{ fontSize: 12, color: '#93370d', marginBottom: 8 }}>{why}</div>}
        {unused.length > 0 && (
          <div>
            <button type="button" data-editor-form-add-open="" aria-expanded={adding} onClick={() => setAdding((a) => !a)} style={small}>+ Add field</button>
            {adding && (
              <div data-editor-form-add-menu="" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {unused.map((f) => (
                  <button key={f} type="button" data-editor-form-add={f} onClick={() => add(f)} style={small}>{fieldNames?.[f] || KIND[f]}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  } else {
    const f = page.slice('field:'.length) as FormField;
    const n = labelLen(f);
    const isContact = (primaryChoices([f]) as FormField[]).length > 0;
    const on = shownPrimary === f;
    // 只剩它一个联系字段 ⟹ 关不掉（快速表单必须露一个联系字段）。
    const only = on && choices.length <= 1;
    title = <>{back('fields')}{KIND[f]}</>;
    body = (
      <>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={FIELD_LABEL}>
            <span>Field name</span>
            <span style={{ fontWeight: 400, color: n > LABEL_CAP ? '#d92d20' : '#98a2b3' }}>{`${n} / ${LABEL_CAP}`}</span>
          </span>
          <input
            data-editor-form-label={f}
            type="text"
            value={labels[f] || ''}
            // 空 = 访客看到语言默认那句（`BlockLeadForm`，#1631 那一层）—— 占位字就是那句。
            placeholder={fieldNames?.[f] || 'Default'}
            aria-label={`${KIND[f]} field name`}
            onChange={(e) => setLabels((l) => ({ ...l, [f]: e.target.value }))}
            style={inputStyle(n > LABEL_CAP)}
          />
          <span style={HELP}>What visitors see in the empty box. Leave it empty to use the default.</span>
          {n > LABEL_CAP && <span style={{ ...HELP, color: '#d92d20' }}>{`A field name can be at most ${LABEL_CAP} characters.`}</span>}
        </label>
        {isContact && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <input type="checkbox" data-editor-form-primary={f} checked={on} disabled={only}
              onChange={(e) => {
                if (e.target.checked) setPrimary(f);
                else { const other = choices.find((x) => x !== f); if (other) setPrimary(other); }
              }} />
            <span>
              <span style={{ display: 'block', fontWeight: 500, color: '#101828' }}>Show this one in the short form</span>
              <span style={HELP}>The short version of this form shows only one box — Phone or Email, so visitors can always send it.</span>
            </span>
          </label>
        )}
      </>
    );
  }
  return (
    <div
      data-editor-form-dialog={form.id}
      data-editor-form-page-on={page}
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Edit form"
      style={{ outline: 'none', position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(16,24,40,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={BOX}>
        <div data-editor-form-title="" style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 0', fontSize: 16, fontWeight: 600, color: '#101828' }}>{title}</div>
        <div style={{ padding: '12px 16px', overflowY: 'auto' }}>{body}</div>
        {blocked && <div data-editor-form-blocked="" style={{ padding: '0 16px 8px', fontSize: 12, color: '#d92d20' }}>{blockedWhy.join(' ')}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 12px', borderTop: '1px solid #eaecf0' }}>
          <button type="button" data-editor-form-cancel onClick={onCancel}
            style={{ ...BTN, border: '1px solid #d0d5dd', background: '#fff', color: '#344054' }}>Cancel</button>
          <button type="button" data-editor-form-done onClick={done} disabled={blocked}
            style={{ ...BTN, border: 0, background: blocked ? '#98a2b3' : '#1d4ed8', color: '#fff', cursor: blocked ? 'not-allowed' : 'pointer' }}>Done</button>
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
