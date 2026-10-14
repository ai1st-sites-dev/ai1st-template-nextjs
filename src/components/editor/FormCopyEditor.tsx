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
// #1769 —— 老板自己的问题：Form fields 页「+ Add field」里多一个 **Add custom**，打开 **Add field** 页（Label · Type · Required），
//    Save 回到 Form fields；自定义字段那一行的 Edit 打开同一页。内置字段的那一页多一个 Required 开关。自定义字段是
//    `fields` 里的 `{ id, type: 'text' }`，名字在 `labels[id]`（只写这个语言），必填是 `required`（字段 id 的数组）——
//    形状和规则在 `site-forms.js`，存盘在 `forms-write.js`。id 在 Add 时生成一次，之后改名字不变。
// #1770 —— Type 六选一（照 Durable）。带选项的三种（Dropdown / Checkboxes / Radio buttons）在 Add field 页多一个选项列表：加、删、
//    拖把手排序、改文字；2~10 项（§MIN_OPTIONS / §MAX_OPTIONS），每项 ≤ §LABEL_CAP。选项在 `fields` 里是选项 id（`o-` + 6 位，
//    Add 时生成一次），文字在 `labels['<字段id>.<选项id>']`（只写这个语言）。改类型：五种之间随便换 —— 换成带选项的、手上还没有选项
//    ⟹ 先放两项 `Option 1` / `Option 2`；换成不带选项的 ⟹ Save 时选项连同文字一起去掉（存盘那一侧再把每个语言的文字删掉）；
//    已经收到的答案不受影响（答案存的是当时的文字）。
// #1768 r5 —— Chris 2026-10-14 在 appdev 上打回的两处：
//    ①「+ Add field」直接进 Add field 页（原来先展开一排小按钮：还没加的自带字段各一颗 + Add custom，而 message / service
//      默认访客名同一句，冒出第二个「What do you need?」）。自带字段并进 Type 下拉，写成人话（§BUILTIN_TYPES），只列表单里
//      还没有的；选它 ⟹ Label 预填它的默认访客名、只有 Required（没有 Options）。service 的默认访客名换成自己那一句（formService）。
//    ② Add field / Edit field 页底部只有 Cancel（回列表，这次不要）+ 一个主按钮（新加叫 Add field、改的叫 Save；落到表单上并回列表），
//      页中间那颗 Save 去掉、这一页不出 Done —— 原来子页上那颗 Done 交的是「已经落到表单上的」，这一页刚填的还没落上去，点了就丢。

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { COPY_CAPS, CUSTOM_FIELD_TYPES, CUSTOM_ID_RE, FORM_FIELDS, LABEL_CAP, MAX_CUSTOM_FIELDS, MAX_OPTIONS, MIN_OPTIONS, customLabelKeys, formIdOptions, hasOptions, isCustomField, lacksContactField, optionLabelKey, optionsOf, primaryChoices } from '../../../scripts/lib/site-forms.js';
import type { CustomFormField } from '@/lib/types/config';

export type FormField = 'name' | 'phone' | 'email' | 'message' | 'service';
/** #1769 —— 表单上的一格：内置字段（字符串）或老板加的字段（`{ id, type }`）。 */
export type EditorField = FormField | CustomFormField;
/** 字段名，键 = 字段 id（内置字段就是它的名字）。 */
type Labels = Partial<Record<string, string>>;
const idOf = (f: EditorField): string => (typeof f === 'string' ? f : f.id);
const isCustom = (f: EditorField): f is CustomFormField => isCustomField(f);
const sameFields = (a: readonly EditorField[], b: readonly EditorField[]) => a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
/** #1769 —— Type 下拉的选项；#1770 补齐六种（顺序、叫法照 Durable 的 Add field）。 */
const CUSTOM_TYPES: { value: CustomFormField['type']; label: string; help: string }[] = [
  { value: 'text', label: 'One line', help: 'A short text answer.' },
  { value: 'textarea', label: 'Multiple lines', help: 'A longer text answer.' },
  { value: 'select', label: 'Dropdown', help: 'One choice from a dropdown list.' },
  { value: 'checkbox', label: 'Checkboxes', help: 'One or more choices from a list.' },
  { value: 'radio', label: 'Radio buttons', help: 'One choice from a list of buttons.' },
  { value: 'date', label: 'Date', help: 'A date picked from a calendar.' },
];
/** #1769 —— 新自定义字段的 id：`f-` + 6 位，跟这张表单里已有的不撞（形状合 site-forms.js §CUSTOM_ID_RE）。#1770 —— 选项同理，前缀 `o-`。 */
function newCustomId(taken: readonly string[], prefix = 'f'): string {
  for (;;) {
    const id = `${prefix}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (!taken.includes(id) && CUSTOM_ID_RE.test(id)) return id;
  }
}
/**
 * #1768 r5 —— Add field 页 Type 下拉里的自带字段（只列表单里还没有的）：叫法照 Chris 2026-10-14 的打回留言。
 * 下拉里的值写成 `field:<名>`，跟六种自定义类型分开。
 */
const BUILTIN_TYPES: Record<FormField, { label: string; help: string }> = {
  name: { label: 'Name', help: 'The visitor’s name.' },
  phone: { label: 'Phone', help: 'The visitor’s phone number.' },
  email: { label: 'Email', help: 'The visitor’s email address.' },
  message: { label: 'Message (long text)', help: 'A longer message from the visitor.' },
  service: { label: 'Service list (pick one of your services)', help: 'Visitors pick one of the services on your website.' },
};
/** #1770 —— Add field 页手上的一项选项。 */
type DraftOption = { id: string; label: string };
const seedOptions = (): DraftOption[] => {
  const a = newCustomId([], 'o');
  return [{ id: a, label: 'Option 1' }, { id: newCustomId([a], 'o'), label: 'Option 2' }];
};

/** 站级表单库里一张的摘要：下拉要 id / name，面板要三句文字、字段、字段名的现值。 */
export interface EditorFormChoice {
  id: string; name: string; buttonText?: string; successMessage?: string;
  fields?: EditorField[]; primary?: FormField; labels?: Labels;
  /** #1769 —— 必填的字段 id。 */
  required?: string[];
}

/** 面板交出来的一笔：只带改过的键；空串 = 删掉这个键。改了字段就连 `primary` 一起带（各语言一致，存盘写到每个语言）。
 *  #1644 —— 带了 `fields` 就带 `base`：面板打开时这张表单的 `fields` / `primary`（原样）。存盘那一侧拿它跟磁盘比，
 *  对不上 ⟹ 编辑器手上那份结构是旧的（重建前烤进去的），这一笔会把别处那次改动改回去 ⟹ 退出码 10、不写。 */
export interface FormCopyEdit {
  id: string; name?: string; buttonText?: string; successMessage?: string;
  fields?: EditorField[]; primary?: FormField; labels?: Labels;
  /** #1769 —— 结构的第三样；改了字段 / primary / 必填任一样，三样一起交。 */
  required?: string[];
  base?: { fields?: EditorField[]; primary?: FormField; required?: string[] };
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
// #1769 —— `custom:` 是 Add field 页：后面跟自定义字段的 id（改它）或空（新加一个）。
type Page = 'main' | 'contact' | 'success' | 'fields' | `field:${FormField}` | `custom:${string}`;
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
 *   子页左上角 ← 回上一层。Cancel / Done 在第一页、Form fields 列表、联系方式 / 成功提示、自带字段那一页：Done 把所有页改过的一起交，
 *   Cancel 什么都不交（包括子页里改过的）。#1768 r5 —— Add field / Edit field 页（`custom:`）例外：那一页手上是一份还没落到表单上的草稿，
 *   底部只有 Cancel（回 Form fields、这次不要）+ 一个主按钮（Add field / Save：落到表单上并回 Form fields），没有 Done。
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
  const startFields = (form.fields || []).filter((f) => (isCustom(f)
    ? typeof f.id === 'string' && CUSTOM_FIELD_TYPES.includes(f.type)
    : VOCAB.includes(f)));
  const [fields, setFields] = useState<EditorField[]>(startFields);
  const [primary, setPrimary] = useState<FormField | undefined>(form.primary);
  const [labels, setLabels] = useState<Labels>({ ...(form.labels || {}) });
  const startRequired = (form.required || []).filter((x) => startFields.some((f) => idOf(f) === x));
  const [required, setRequired] = useState<string[]>(startRequired);
  const setReq = (id: string, on: boolean) => setRequired((r) => (on ? (r.includes(id) ? r : [...r, id]) : r.filter((x) => x !== id)));
  /** #1769 —— Add field 页手上那一份（Save 才写进上面三样；← 回去 = 不要了）。 */
  // #1770 —— `options`：带选项的类型才用；换成不带选项的类型时留在手上（换回来还在），Save 时才按类型取舍。
  // #1768 r5 —— `builtin`：Type 选的是一个自带字段（只在新加时可选）；这时 `type` / `options` 不用。
  const [draft, setDraft] = useState<{ label: string; type: CustomFormField['type']; required: boolean; options: DraftOption[]; builtin: FormField | null }>({ label: '', type: 'text', required: false, options: [], builtin: null });
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOpt, setDragOpt] = useState<number | null>(null);
  const [page, setPage] = useState<Page>('main');
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
  }, [page]);
  const over = KEYS.filter((k) => Array.from(vals[k].trim()).length > CAPS[k]);
  const labelLen = (f: EditorField) => Array.from((labels[idOf(f)] || '').trim()).length;
  const labelsOver = fields.filter((f) => labelLen(f) > LABEL_CAP);
  const blocked = over.length > 0 || labelsOver.length > 0;
  /** 这一格删不删得掉；删不掉时回原因那句。 */
  const whyKeep = (f: EditorField): string | null => {
    const rest = fields.filter((x) => idOf(x) !== idOf(f));
    if (!rest.length) return WHY_LAST;
    return lacksContactField(rest) ? WHY_CONTACT : null;
  };
  /** `primary` 现在能取哪些 / 实际是哪个（磁盘上的不合格时按落位规则读）。 */
  const choices = primaryChoices(fields.filter((x): x is FormField => !isCustom(x))) as FormField[];
  const shownPrimary = primary && choices.includes(primary) ? primary : choices[0];
  const remove = (f: EditorField) => {
    if (whyKeep(f)) return;
    const rest = fields.filter((x) => idOf(x) !== idOf(f));
    setFields(rest);
    setReq(idOf(f), false);
    const left = primaryChoices(rest.filter((x): x is FormField => !isCustom(x))) as FormField[];
    if (!primary || !left.includes(primary)) setPrimary(left[0]);
  };
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= fields.length || to >= fields.length) return;
    setFields((list) => { const next = [...list]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next; });
  };
  const why = fields.map(whyKeep).find((w) => w === WHY_CONTACT) || (fields.length === 1 ? WHY_LAST : null);
  /** 这一行显示的字段名：老板改过的名字；没改过 ⟹ 访客看到的语言默认那句。 */
  const nameOf = (f: EditorField) => (labels[idOf(f)] || '').trim() || (isCustom(f) ? f.id : fieldNames?.[f] || KIND[f]);
  const kindOf = (f: EditorField) => (isCustom(f) ? (CUSTOM_TYPES.find((t) => t.value === f.type) || CUSTOM_TYPES[0]).label : KIND[f]);
  const customCount = fields.filter(isCustom).length;
  const canAddCustom = customCount < MAX_CUSTOM_FIELDS;
  /** #1768 r5 —— 表单里还没有的自带字段（Add field 页 Type 下拉里列它们）。 */
  const unused = VOCAB.filter((f) => !fields.includes(f));
  /** #1768 r5 —— 自带字段的默认访客名（访客看到的语言默认那句）：选它时 Label 预填这一句。 */
  const defaultName = (f: FormField) => fieldNames?.[f] || KIND[f];
  /** #1769 —— 打开 Add field 页：`id` 空 = 新加一个；否则改那一个（带上它现在的名字 / 必填）。 */
  const openCustom = (id: string) => {
    const f = fields.find((x) => isCustom(x) && x.id === id) as CustomFormField | undefined;
    // #1768 r5 —— 新加、自定义字段已经到上限 ⟹ 只剩自带字段可选，停在第一个。
    const first = !f && !canAddCustom ? unused[0] : undefined;
    setDraft(f
      ? { label: labels[f.id] || '', type: f.type, required: required.includes(f.id), options: (optionsOf(f) as string[]).map((o) => ({ id: o, label: labels[optionLabelKey(f.id, o)] || '' })), builtin: null }
      : first
        ? { label: defaultName(first), type: 'text', required: false, options: [], builtin: first }
        : { label: '', type: 'text', required: false, options: [], builtin: null });
    setPage(`custom:${id}`);
  };
  /**
   * #1768 r5 —— Type 下拉换一项。自带字段 ⟹ Label 预填它的默认访客名（手上那格是空的、或还是上一个自带字段的默认那句时才换，
   * 老板自己打的字不盖）；换回自定义类型时那格要是还是默认那句就清掉。
   */
  const pickType = (v: string) => setDraft((d) => {
    const wasDefault = !d.label.trim() || (d.builtin !== null && d.label === defaultName(d.builtin));
    if (v.startsWith('field:')) {
      const b = v.slice('field:'.length) as FormField;
      return { ...d, builtin: b, label: wasDefault ? defaultName(b) : d.label };
    }
    const type = v as CustomFormField['type'];
    return { ...d, builtin: null, type, label: d.builtin !== null && wasDefault ? '' : d.label, options: hasOptions(type) && !d.options.length ? seedOptions() : d.options };
  });
  const optLen = (o: DraftOption) => Array.from(o.label.trim()).length;
  /** #1770 —— 选项列表能不能存：2~10 项、每项 1~LABEL_CAP 字（不带选项的类型不看）。 */
  const optionsOk = (d: typeof draft) => !hasOptions(d.type)
    || (d.options.length >= MIN_OPTIONS && d.options.length <= MAX_OPTIONS && d.options.every((o) => optLen(o) > 0 && optLen(o) <= LABEL_CAP));
  const moveOpt = (from: number, to: number) => setDraft((d) => {
    if (from === to || from < 0 || to < 0 || from >= d.options.length || to >= d.options.length) return d;
    const next = [...d.options]; const [x] = next.splice(from, 1); next.splice(to, 0, x);
    return { ...d, options: next };
  });
  const saveCustom = (id: string) => {
    const label = draft.label.trim();
    // #1768 r5 —— 自带字段：加到表单末尾；名字跟默认那句一样（或空）⟹ 不存名字（访客看到语言默认那句，换语言也对）。
    if (draft.builtin) {
      const b = draft.builtin;
      if (fields.includes(b) || Array.from(label).length > LABEL_CAP) return;
      setFields((list) => [...list, b]);
      setLabels((l) => { const next = { ...l }; if (label && label !== defaultName(b)) next[b] = label; else delete next[b]; return next; });
      setReq(b, draft.required);
      setPage('fields');
      return;
    }
    if (!label || Array.from(label).length > LABEL_CAP || !optionsOk(draft)) return;
    const fid = id || newCustomId(fields.map(idOf));
    // #1770 —— 带选项的类型连同选项 id 一起进结构；不带的不留 `options`。
    const withOpts = hasOptions(draft.type);
    const field: CustomFormField = withOpts ? { id: fid, type: draft.type, options: draft.options.map((o) => o.id) } : { id: fid, type: draft.type };
    if (id) setFields((list) => list.map((x) => (isCustom(x) && x.id === id ? field : x)));
    else setFields((list) => [...list, field]);
    setLabels((l) => {
      // 这个字段原来那几项选项的文字先清掉，再按手上这一份写（删掉的选项、换成不带选项的类型 ⟹ 文字跟着没）。
      const next: Labels = {};
      for (const [k, v] of Object.entries(l)) if (!k.startsWith(`${fid}.`)) next[k] = v;
      next[fid] = label;
      if (withOpts) for (const o of draft.options) next[optionLabelKey(fid, o.id)] = o.label.trim();
      return next;
    });
    setReq(fid, draft.required);
    setPage('fields');
  };
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
    // 字段 / primary / 必填（#1769）：任一变了就三样一起交（存盘那一侧按「各语言一致」写进每个语言）。
    const reqNow = required.filter((x) => fields.some((f) => idOf(f) === x));
    if (fields.length && (!sameFields(fields, startFields) || primary !== form.primary || !sameSet(reqNow, form.required || []))) {
      edit.fields = fields;
      edit.primary = shownPrimary;
      edit.required = reqNow;
      // 底稿 = 打开时这张表单的结构，原样（没有的键就不带 —— 存盘那一侧按「两边都没有算相同」比）。
      edit.base = { fields: form.fields, primary: form.primary, ...(form.required ? { required: form.required } : {}) };
    }
    // 字段名：只交变了的那几格（只写这个语言）；空串 = 回到默认。
    // #1769 —— 自定义字段的名字也在这里（键 = 它的 id）；已经删掉的自定义字段不交（存盘那一侧会连它在每个语言里的名字一起删，
    //    这里再交一句反而因为「表单上没有这个字段」被整笔拒收）。
    const changed: Labels = {};
    // #1770 —— 选项的文字（`<字段id>.<选项id>`）也在这里，键表同存盘那一侧（site-forms.js §customLabelKeys）。
    const customIds = customLabelKeys(fields) as string[];
    for (const k of [...VOCAB, ...customIds] as string[]) {
      const next = (labels[k] || '').trim();
      // #1644 —— 超限、而这个字段已经删掉了：这串字是这次刚打的、从没存过，面板上也没有它那一行（Done 的闸只看还在的
      //    字段，老板看不见也改不了）⟹ 不交。交上去会被整笔拒收，连删字段那一步也存不上。
      if (!fields.some((f) => idOf(f) === k) && !customIds.includes(k) && Array.from(next).length > LABEL_CAP) continue;
      if (next !== ((form.labels && form.labels[k]) || '').trim()) changed[k] = next;
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
  let footer: ReactNode = null;
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
    body = (
      <div data-editor-form-fields="">
        <div style={{ fontSize: 12, color: '#667085', marginBottom: 8 }}>Drag to reorder. The name is what visitors see in the empty box.</div>
        {fields.map((f, i) => {
          const keep = whyKeep(f);
          const fid = idOf(f);
          return (
            <div
              key={fid}
              data-editor-form-row={fid}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 6, border: '1px solid #eaecf0', borderRadius: 8, opacity: dragFrom === i ? 0.5 : 1 }}
            >
              {/* 只有把手可拖（同 #1637）。 */}
              <span data-editor-form-handle draggable aria-hidden="true" title="Drag to reorder"
                onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', fid); }}
                onDragEnd={() => setDragFrom(null)}
                style={{ cursor: 'grab', color: '#98a2b3', padding: '0 2px', userSelect: 'none' }}>⋮⋮</span>
              <span data-editor-form-row-name={fid} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: labelLen(f) > LABEL_CAP ? '#d92d20' : '#101828' }}>{nameOf(f)}</span>
              {required.includes(fid) && <span data-editor-form-required-tag={fid} title="Visitors must fill this in" style={{ fontSize: 11, color: '#b42318', background: '#fef3f2', borderRadius: 999, padding: '1px 8px' }}>Required</span>}
              {shownPrimary === f && <span data-editor-form-primary-tag={fid} title="Shown in the short form" style={{ fontSize: 11, color: '#175cd3', background: '#eff8ff', borderRadius: 999, padding: '1px 8px' }}>Short form</span>}
              <button type="button" data-editor-form-field-edit={fid} onClick={() => (isCustom(f) ? openCustom(f.id) : setPage(`field:${f}`))} style={small}>Edit</button>
              <button type="button" data-editor-form-remove={fid} disabled={!!keep} title={keep || `Remove ${nameOf(f)}`} aria-label={`Remove ${isCustom(f) ? nameOf(f) : KIND[f]}`}
                onClick={() => remove(f)} style={{ ...small, cursor: keep ? 'not-allowed' : 'pointer', color: keep ? '#d0d5dd' : '#344054' }}>🗑</button>
            </div>
          );
        })}
        {why && <div data-editor-form-remove-why style={{ fontSize: 12, color: '#93370d', marginBottom: 8 }}>{why}</div>}
        {/* #1768 r5 —— 直接进 Add field 页（自带字段在那一页的 Type 里选）。 */}
        {(unused.length > 0 || canAddCustom) && (
          <button type="button" data-editor-form-add-open="" onClick={() => openCustom('')} style={small}>+ Add field</button>
        )}
        {!canAddCustom && <div data-editor-form-custom-max="" style={{ fontSize: 12, color: '#667085', marginTop: 8 }}>{`A form can have at most ${MAX_CUSTOM_FIELDS} fields of your own.`}</div>}
      </div>
    );
  } else if (page.startsWith('custom:')) {
    // #1769 —— Add field 页：新加（id 空）或改一个自定义字段。Save 才落到表单上，← 回去 = 不要这次改的。
    const id = page.slice('custom:'.length);
    const n = Array.from(draft.label.trim()).length;
    const type = CUSTOM_TYPES.find((t) => t.value === draft.type) || CUSTOM_TYPES[0];
    const b = draft.builtin;
    // 自带字段：名字可以空（= 用默认那句）；自定义字段：要有名字、选项合格。
    const canSave = b ? n <= LABEL_CAP : n > 0 && n <= LABEL_CAP && optionsOk(draft);
    const withOpts = !b && hasOptions(draft.type);
    // Type 下拉：改一个自定义字段 ⟹ 只有六种（自定义字段不能变成自带字段）；新加 ⟹ 六种（没到上限时）+ 表单里还没有的自带字段。
    const customChoices = id || canAddCustom ? CUSTOM_TYPES : [];
    const builtinChoices = id ? [] : unused;
    title = <>{back('fields')}{id ? 'Edit field' : 'Add field'}</>;
    body = (
      <div data-editor-form-custom={id || 'new'}>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={FIELD_LABEL}>
            <span>Label</span>
            <span style={{ fontWeight: 400, color: n > LABEL_CAP ? '#d92d20' : '#98a2b3' }}>{`${n} / ${LABEL_CAP}`}</span>
          </span>
          <input data-editor-form-custom-label="" type="text" value={draft.label} placeholder="e.g. What car do you drive?"
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} style={inputStyle(n > LABEL_CAP)} />
          <span style={HELP}>The question visitors see in the empty box.</span>
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={FIELD_LABEL}><span>Type</span></span>
          <select data-editor-form-custom-type="" value={b ? `field:${b}` : draft.type}
            onChange={(e) => pickType(e.target.value)}
            style={{ width: '100%', padding: 8, border: '1px solid #d0d5dd', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, background: '#fff' }}>
            {customChoices.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            {builtinChoices.map((f) => <option key={f} value={`field:${f}`}>{BUILTIN_TYPES[f].label}</option>)}
          </select>
          <span style={HELP}>{b ? BUILTIN_TYPES[b].help : type.help}</span>
        </label>
        {/* #1770 —— 选项列表（只有 Dropdown / Checkboxes / Radio buttons）：把手拖动排序（同字段列表）、改文字、删、加。 */}
        {withOpts && (
          <div data-editor-form-options="" style={{ marginBottom: 14 }}>
            <span style={FIELD_LABEL}><span>Options</span></span>
            {draft.options.map((o, i) => {
              const len = optLen(o);
              return (
                <div key={o.id} data-editor-form-option={o.id}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => { e.preventDefault(); if (dragOpt !== null) moveOpt(dragOpt, i); setDragOpt(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, opacity: dragOpt === i ? 0.5 : 1 }}>
                  <span data-editor-form-option-handle={o.id} draggable aria-hidden="true" title="Drag to reorder"
                    onDragStart={(e) => { setDragOpt(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); }}
                    onDragEnd={() => setDragOpt(null)}
                    style={{ cursor: 'grab', color: '#98a2b3', padding: '0 2px', userSelect: 'none' }}>⋮⋮</span>
                  <input type="text" data-editor-form-option-input={o.id} value={o.label} aria-label={`Option ${i + 1}`}
                    onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, options: d.options.map((x) => (x.id === o.id ? { ...x, label: v } : x)) })); }}
                    style={{ ...inputStyle(len === 0 || len > LABEL_CAP), flex: 1 }} />
                  <button type="button" data-editor-form-option-remove={o.id} disabled={draft.options.length <= MIN_OPTIONS}
                    title={draft.options.length <= MIN_OPTIONS ? `A list needs at least ${MIN_OPTIONS} options.` : 'Remove this option'} aria-label={`Remove option ${i + 1}`}
                    onClick={() => setDraft((d) => ({ ...d, options: d.options.filter((x) => x.id !== o.id) }))}
                    style={{ ...small, cursor: draft.options.length <= MIN_OPTIONS ? 'not-allowed' : 'pointer', color: draft.options.length <= MIN_OPTIONS ? '#d0d5dd' : '#344054' }}>🗑</button>
                </div>
              );
            })}
            {draft.options.some((o) => optLen(o) === 0 || optLen(o) > LABEL_CAP) && (
              <span data-editor-form-option-why="" style={{ ...HELP, color: '#d92d20' }}>{`Each option needs 1 to ${LABEL_CAP} characters.`}</span>
            )}
            {draft.options.length < MAX_OPTIONS
              ? <button type="button" data-editor-form-option-add=""
                onClick={() => setDraft((d) => ({ ...d, options: [...d.options, { id: newCustomId(d.options.map((x) => x.id), 'o'), label: `Option ${d.options.length + 1}` }] }))}
                style={{ ...small, marginTop: 2 }}>+ Add option</button>
              : <span data-editor-form-option-max="" style={HELP}>{`A list can have at most ${MAX_OPTIONS} options.`}</span>}
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
          <input type="checkbox" role="switch" data-editor-form-custom-required="" checked={draft.required}
            onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))} />
          <span>
            <span style={{ display: 'block', fontWeight: 500, color: '#101828' }}>Required</span>
            <span style={HELP}>Visitors can’t send the form without answering it.</span>
          </span>
        </label>
      </div>
    );
    // #1768 r5 —— 这一页的底栏：Cancel（回列表、这次不要）+ 主按钮（落到表单上、回列表）。没有 Done。
    footer = (
      <>
        <button type="button" data-editor-form-custom-cancel="" onClick={() => setPage('fields')}
          style={{ ...BTN, border: '1px solid #d0d5dd', background: '#fff', color: '#344054' }}>Cancel</button>
        <button type="button" data-editor-form-custom-save="" disabled={!canSave} onClick={() => saveCustom(id)}
          style={{ ...BTN, border: 0, background: canSave ? '#1d4ed8' : '#98a2b3', color: '#fff', cursor: canSave ? 'pointer' : 'not-allowed' }}>{id ? 'Save' : 'Add field'}</button>
      </>
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
        {/* #1769 —— 内置字段也能设必填。 */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
          <input type="checkbox" role="switch" data-editor-form-required={f} checked={required.includes(f)} onChange={(e) => setReq(f, e.target.checked)} />
          <span>
            <span style={{ display: 'block', fontWeight: 500, color: '#101828' }}>Required</span>
            <span style={HELP}>Visitors can’t send the form without filling it in.</span>
          </span>
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
          {footer || (
            <>
              <button type="button" data-editor-form-cancel onClick={onCancel}
                style={{ ...BTN, border: '1px solid #d0d5dd', background: '#fff', color: '#344054' }}>Cancel</button>
              <button type="button" data-editor-form-done onClick={done} disabled={blocked}
                style={{ ...BTN, border: 0, background: blocked ? '#98a2b3' : '#1d4ed8', color: '#fff', cursor: blocked ? 'not-allowed' : 'pointer' }}>Done</button>
            </>
          )}
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
    // #1769 —— 必填整列替换（空 = 删掉这个键）；删掉的自定义字段，它的名字也去掉（同存盘那一侧）。
    if (edit.required) { if (edit.required.length) next.required = [...edit.required]; else delete next.required; }
    if (edit.labels || edit.fields) {
      const labels: Labels = { ...(f.labels || {}) };
      for (const [k, v] of Object.entries(edit.labels || {})) {
        if (v) labels[k] = v; else delete labels[k];
      }
      // #1770 —— 键表同存盘那一侧（§customLabelKeys：自定义字段的名字 + 它们每个选项的文字）。
      if (edit.fields) { const keep = customLabelKeys(edit.fields) as string[]; for (const k of Object.keys(labels)) if (!VOCAB.includes(k as FormField) && !keep.includes(k)) delete labels[k]; }
      if (Object.keys(labels).length) next.labels = labels; else delete next.labels;
    }
    return next;
  });
}
