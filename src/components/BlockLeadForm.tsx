'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BlockLeadForm —— 块里的「表单」部件（hero / footer / contact / cta 共用一份，总纲 #1422 的 T2.3 / T2.2A）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 📌 出处：#1463（T2.3 hero）r2 的 hero 表单（dev2 写的），**逐字搬来**，只加了 `idPrefix` / `size` 两个参数；
//    住在 `src/components/`（几个块共用，归哪个块都不对）。#1471 起 hero 也改用这一份，它自己那份删了。
//
// 提交那一条路照 `HeroLeadForm.tsx` / `quote-form`：POST `${leadApi}/api/leads`，蜜罐字段 `hp`，后端只要求
// 「邮箱和电话至少有一个」；不跳页，原地显示 `successMessage`；`redirect` 有值才跳。
//
// 🔴 `source` 用既有的 `contact-form`，不新造值 —— `manager/form_channel.go` 的 `formLeadSources` 是一份
//    封闭词表（同 `HeroLeadForm.tsx` 那段说明）。
// 🔴 字段只能从词表里挑，每个字段对应客户记录（Customers）的一列：
//      name → 姓名 · phone → 电话 · email → 邮箱 · message → 留言 · service → 留言里的一行 `Service: …`
//    （客户记录没有「服务」这一列，照 `quote-form` 的做法折进 message）。词表外的值这里不画。
// 🔴 `inline` = 一行（一个字段 + 按钮），`stacked` = 姓名 / 电话并排 + 需求下拉 + 通栏提交（Webpixels hero-6）。
//    inline 只许一个字段；这里多给了也只画第一个。
// 🔴 #1471 —— **表单是站级资产**（`site/<locale>/forms.json`，`scripts/lib/site-forms.js`）。块只给 `formId`（槽 `form.id`）
//    和 `mode`（旋钮 `options.form`：teaser = 首要字段 `primary` + 按钮一行；full = 整张）。字段 / 按钮文字 / 成功提示 /
//    跳转都从站级那一张取 ⟹ 改一处，四个块处处变。`formId` 空 ⟹ 第一张；站没有表单库 ⟹ 内置 `DEFAULT_FIELDS`。
//    提交多带 `meta: { formId }`（`manager/leads.go` 的 `leadMetaAllowedKeys` 收它，落 `leads.meta`）。
//    #1510 —— 还带 `formName`（那张表单**此刻**的名字，表单以后改名旧线索不跟着变）和 `formMode`（teaser / full），
//    Conversations / Customers 据此显示「来自哪张表单」，Customers 据 teaser 标「回电请求」。站没有表单库 ⟹ 照旧一个 meta 都不带。
//    teaser ↔ 画法 `inline`、full ↔ `stacked`（`data-form-variant` 照旧写 inline / stacked，CSS 和测试都按它）。
// 🔴 #1471 —— 服务下拉的选项由调用方的 `Section.tsx` 读好传进来（`services`），这里**不自己读服务清单**（文件里连那个函数名都别出现 —— page-deps 按字面找它）：
//    `scripts/lib/page-deps.js §blockTypesReadingServices` 只看注册表指向的那份 Section.tsx，这里读的话
//    「改服务列表 → 哪些页面的 sitemap lastmod 要动」就只能靠一条豁免兜着（少报是静默的）。
// 🔴 按钮文字 / 成功提示不挂 `data-slot`：它们不在块的数据里（站级表单库），编辑器没有可改的键。
// 🔴 `idPrefix`：同一页上 hero 和 footer 各有一个表单时 id 不许撞（hero 用 `hro`，footer 用 `ftr`）。
//    `size`：hero 是 `lg`，页脚画小一号 `sm`（Webpixels 页脚那几份都是 `-sm`）。
// #1477 —— `tone`：调用方把这块底色的字色判据（`contrast.js` §toneForBg）传进来。不是 `light` 时表单根上挂
//    `data-tone`，输入框的字 / 占位字 / 边框换成白色那一档（规则在 `scripts/lib/site-css.js` §ON_DEEP_FORM，全站一份）。
//    只给「输入框透明、直接压在深底上」的调用方传（footer）；cta 深底时自己把输入框涂成白底（它的
//    `block.css`），占位字原来的灰在白底上看得清，所以它不传 —— 传了就是白底白字。
// 🔴 #1769 —— 完整版（full）还画老板自己加的字段（`fields` 里的 `{ id, type: 'text' }`，名字在 `labels[id]`），一行字、占整行，
//    按 `fields` 的顺序跟内置字段混排。答案进 `meta.answers`：`[{ id, label, value }]`，`label` 是**此刻**的名字（同 #1510
//    记表单名的道理：老板以后改名，旧线索留着当时问的是什么），没填的不带。`manager/leads.go` §sanitizeLeadAnswers 收它。
//    `required`（站级表单库里那张的结构）里的字段：输入框带 `required`、占位符后面加「 *」；提交时空着（只有空白也算空）
//    ⟹ 不发请求，那一格标红（`is-invalid`）、出一句「请填必填项」、光标落到第一格。短版（teaser）只露 `primary`，不变。
// 🔴 #1770 —— 另外五种类型（`site-forms.js` §CUSTOM_FIELD_TYPES）：多行字 = `textarea`（≤500 字，`text` 那一种的 200 不动）；
//    下拉 = `form-select`，第一项是名字（同 service 那个下拉）；单选 / 多选 = 一组 `form-check`，名字是组的标题；日期 = `<input type="date">`，
//    名字是它上面的一行字（日期框不显示占位符）。选项的文字在 `labels['<字段id>.<选项id>']`（§optionLabelKey）。
//    答案照 #1769 进 `meta.answers`，`value` 一律是字符串：下拉 / 单选 = 选中那项**此刻**的文字；多选 = 选中的几项按表单上的顺序
//    用「, 」连起来；日期 = 原样 `YYYY-MM-DD`（不按站的语言格式化：老板在 dashboard 看到的不该随网站语言变，也没有 03/04 的歧义）。
//    必填：多选不能一直带浏览器的 `required`（它要求每一个框都勾上）—— #1782 起只在一项都没勾时每个框带上（勾了就全去掉），
//    §handleSubmit 仍判「一项都没选」兜底；单选组每个 radio 带 `required`
//    （浏览器按组判）；被拦下时标红的是那一组的每个框。
// 🔴 #1665 —— 这里不再 import `@/lib/config`：站点内容是服务端每次请求读的，浏览器端拿不到。往哪儿提交（`leadApi`）、
//    哪个站（`siteId`）、表单库（`forms`）由渲染它的块从站点数据里取好递进来（`config.ts` §leadFormSite）。

import { useContext, useState } from 'react';
import { EditorCanvasContext } from '@template/lib/editor-canvas';
import { island } from '@template/islands/island';
import type { CustomFormField, SiteFormConfig } from '@template/lib/types/config';
import { CUSTOM_FIELD_TYPES, FORM_FIELDS, isCustomField, isRequired, optionLabelKey, optionsOf, pickForm } from '../../scripts/lib/site-forms.js';
import { getLabels } from '@template/lib/component-labels';

export type LeadField = 'name' | 'phone' | 'email' | 'message' | 'service';
export type LeadFormMode = 'teaser' | 'full';

const VOCAB = FORM_FIELDS as LeadField[];
/** 表单里的一格：内置字段（字符串）或老板加的字段（#1769）。 */
type FormItem = LeadField | CustomFormField;
const idOf = (f: FormItem): string => (typeof f === 'string' ? f : f.id);
/** #1769 —— 自定义字段的答案在 `values` 里的键，跟内置字段的键分开（id 已经不许跟内置重名，这里再隔一层）。 */
const answerKey = (id: string) => `custom:${id}`;
// #1792 —— Date 字段旁边那个时间框的值（另一个键：没勾时间的 Date 一个字节不变）。
const timeKey = (id: string) => `custom-time:${id}`;
// 站没有表单库（老站，没有 forms.json）时的内置默认 —— 留着，老站靠它顶（#1471 dead code 审查）。
const DEFAULT_FIELDS: Record<LeadFormMode, LeadField[]> = {
  teaser: ['phone'],
  full: ['name', 'phone', 'service'],
};
// #1641 —— 表单库里这张表没有按钮字 / 成功提示时的兜底（#1634 老板清空 = 删键 = 走到这里），按站的语言取。
const DEFAULT_BUTTON_TEXT = (locale: string) => getLabels(locale).formSubmit;
const DEFAULT_SUCCESS = (locale: string) => getLabels(locale).formThanks;

/**
 * #1631 —— 输入框占位符按站的语言（`component-labels.ts` 的 `getLabels`，跟 not-found 页 / 博客页取界面字同一张表）。
 * 那张表 14 种、没有 zh-tw ⟹ 繁体站这里回英文，跟改之前一样（已知，票面「做什么」3）。逐键回退英文。
 * #1768 r5 —— `service` 取它自己那一句 `formService`（原来跟 `message` 共用一句，编辑器里两格同名）。
 */
/** #1801 —— 编辑器画布里表单下面那一句（设计文档 §5.4 / 票正文做什么 9 的英文定稿）。 */
export const CANVAS_NOTE = 'Forms work on your preview link and your published website.';

export function placeholdersFor(locale: string): Record<LeadField, string> {
  const l = getLabels(locale);
  return { name: l.formName, phone: l.formPhone, email: l.formEmail, message: l.formMessage, service: l.formService };
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

function BlockLeadForm({ mode, formId, forms = [], siteId = '', leadApi = '', services = [], locale, center, align, idPrefix = 'hro', size = 'lg', tone = 'light' }: {
  mode: LeadFormMode;
  /** 块的 `form.id`；空 ⟹ 表单库第一张。 */
  formId?: string;
  /** 这个站这个语言的表单库（`leadFormSite`）；不传 / 空 ⟹ 内置默认字段。单格页 / 测试传演示那份。 */
  forms?: SiteFormConfig[];
  /** 线索归到哪个站、POST 到哪个 manager（`site_meta.json`，部署时 env 压过 leadApi）。 */
  siteId?: string;
  leadApi?: string;
  /** 「需求」下拉的选项，调用方的 Section.tsx 读（理由见文件头）。 */
  services?: { id: string; name: string }[];
  locale: string; center?: boolean;
  /** 表单整块的水平位置（hero 跟 `textAlign` 走）：center ⟹ `mx-auto`，right ⟹ `ms-auto`。`center` 是它的老写法。 */
  align?: 'left' | 'center' | 'right';
  idPrefix?: string; size?: 'lg' | 'sm';
  tone?: 'light' | 'dark' | 'brand';
}) {
  const form = pickForm(forms, formId) as SiteFormConfig | null;
  const PLACEHOLDER = placeholdersFor(locale);
  const L = getLabels(locale);
  const variant: 'inline' | 'stacked' = mode === 'teaser' ? 'inline' : 'stacked';
  const asked: FormItem[] = form
    ? (mode === 'teaser' ? [form.primary] : form.fields).filter((f): f is FormItem => (isCustomField(f)
      ? typeof (f as CustomFormField).id === 'string' && CUSTOM_FIELD_TYPES.includes((f as CustomFormField).type)
      : VOCAB.includes(f as LeadField)))
    : [];
  const unique = asked.filter((f, i) => asked.findIndex((g) => idOf(g) === idOf(f)) === i);
  const fields: FormItem[] = (unique.length ? unique : DEFAULT_FIELDS[mode]).slice(0, variant === 'inline' ? 1 : unique.length || VOCAB.length);
  // #1637 —— 字段名：老板写的 `labels` > 语言默认（`PLACEHOLDER`，#1631 那一层）。只在这里叠一层，不动下面那一层。
  const label = (f: FormItem) => {
    const own = form?.labels?.[idOf(f)];
    return (typeof own === 'string' && own.trim()) || (typeof f === 'string' ? PLACEHOLDER[f] : f.id);
  };
  // #1769 —— 必填：站级那张表单的 `required`（没有表单库 ⟹ 一格都不是）。占位符后面加「 *」。
  const required = (f: FormItem) => !!form && isRequired(form, f);
  const hint = (f: FormItem) => (required(f) ? `${label(f)} *` : label(f));
  const buttonText = form?.buttonText || DEFAULT_BUTTON_TEXT(locale);
  const successMessage = form?.successMessage || DEFAULT_SUCCESS(locale);
  const redirect = form?.redirect;
  const place = align === 'right' ? ' ms-auto' : (center || align === 'center') ? ' mx-auto' : '';

  const [values, setValues] = useState<Record<string, string>>({});
  // #1770 —— 多选字段勾了哪几项（字段 id → 选项 id）。
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [hp, setHp] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const inCanvas = useContext(EditorCanvasContext);
  const set = (k: string, id = k) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    if (invalid.includes(id)) setInvalid((xs) => xs.filter((x) => x !== id));
  };
  // #1770 —— 一个选项此刻的文字（这个语言的 labels；校验保证有，缺了退回选项 id）。
  const optText = (f: CustomFormField, o: string) => {
    const own = form?.labels?.[optionLabelKey(f.id, o)];
    return (typeof own === 'string' && own.trim()) || o;
  };
  const opts = (f: CustomFormField): string[] => optionsOf(f);
  const toggle = (f: CustomFormField, o: string) => (e: { target: { checked: boolean } }) => {
    const on = e.target.checked;
    setPicked((p) => { const cur = (p[f.id] || []).filter((x) => x !== o); return { ...p, [f.id]: on ? [...cur, o] : cur }; });
    if (invalid.includes(f.id)) setInvalid((xs) => xs.filter((x) => x !== f.id));
  };
  // 这一格的答案（字符串）：下拉 / 单选存的是选项 id ⟹ 换成它的文字；多选按表单上的顺序连起来（#1770）。
  const valueOf = (f: FormItem) => {
    if (typeof f === 'string') return values[f] || '';
    if (f.type === 'checkbox') return opts(f).filter((o) => (picked[f.id] || []).includes(o)).map((o) => optText(f, o)).join(', ');
    const v = values[answerKey(f.id)] || '';
    if (f.type === 'select' || f.type === 'radio') return opts(f).includes(v) ? optText(f, v) : '';
    // #1792 —— 问了时间：有日期才算填了这一格（只选了时间 ⟹ ''，必填时照样拦、选填时不进答案）；
    //    有时间就拼成 `YYYY-MM-DD HH:MM`（24 小时制，不按语言格式化，同 #1770 的日期）。
    if (f.type === 'date' && f.time === true && v.trim()) {
      const t = (values[timeKey(f.id)] || '').trim().slice(0, 5);
      return t ? `${v.trim()} ${t}` : v;
    }
    return v;
  };
  const endpoint = leadApi.replace(/\/$/, '') + '/api/leads';

  // #1769 —— 真浏览器里，必填格空着时浏览器自己的 `required` 先拦（不触发 submit），handleSubmit 根本不跑 ⟹ 那一格的标红和
  //    「请填必填项」那句要在这里补上：浏览器拦下时对每个不合格的格子发一次 `invalid`。只管「空着」（valueMissing），
  //    邮箱格式不对之类照旧由浏览器自己说。
  const handleInvalid = (e: React.FormEvent) => {
    const el = e.target as HTMLInputElement;
    if (!el.validity || !el.validity.valueMissing || !el.id.startsWith(`${idPrefix}-`)) return;
    // #1770 —— 单选组里每个框的 id 带着选项，字段 id 读 `data-field`。
    const id = (el.dataset && el.dataset.field) || el.id.slice(idPrefix.length + 1);
    setInvalid((xs) => (xs.includes(id) ? xs : [...xs, id]));
    setError(L.formRequired);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inCanvas) return; // #1801 —— 画布里回车也不发
    setError('');
    // #1769 —— 必填没填（只有空白也算没填）⟹ 不发，标出来。浏览器自己的 `required` 拦不住只有空白的那种，这里补上。
    const missing = fields.filter((f) => required(f) && !valueOf(f).trim()).map(idOf);
    setInvalid(missing);
    if (missing.length) {
      setError(L.formRequired);
      if (typeof document !== 'undefined') {
        // #1770 —— 单选 / 多选那一格是个 fieldset（拿不到焦点）⟹ 落到它的第一个框。
        const el = document.getElementById(`${idPrefix}-${missing[0]}`);
        (el && el.tagName === 'FIELDSET' ? el.querySelector<HTMLElement>('input') : el)?.focus();
      }
      return;
    }
    const email = (values.email || '').trim();
    const phone = (values.phone || '').trim();
    if (!email && !phone) {
      setError(fields.includes('email') && !fields.includes('phone') ? L.formNeedEmail : L.formNeedPhone);
      return;
    }
    const parts: string[] = [];
    if (values.service) parts.push(`Service: ${values.service}`);
    if ((values.message || '').trim()) parts.push(values.message.trim());
    // #1769 —— 老板加的字段的答案：带着此刻的名字，没填的不带。
    const answers = fields.filter(isCustomField).map((f) => f as CustomFormField)
      .map((f) => ({ id: f.id, label: label(f), value: valueOf(f).trim() }))
      .filter((a) => a.value);
    setState('submitting');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId, name: (values.name || '').trim(), email, phone, message: parts.join('\n'), source: 'contact-form', hp,
          ...(form ? { meta: { formId: form.id, formName: form.name, formMode: mode, ...(answers.length ? { answers } : {}) } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (redirect) { window.location.assign(redirect); return; }
      setState('success');
    } catch {
      setState('error');
      setError(L.formFailed);
    }
  };

  if (state === 'success') {
    return <p className="fs-5 fw-semibold mt-6" data-part="form-success" role="status">{successMessage}</p>;
  }

  // 类名写全拼、不拼接：purge 按字面扫 .tsx（`scripts/lib/site-css.js`），`form-control-${size}` 它认不出来。
  const sz = size === 'sm'
    ? { control: 'form-control form-control-sm', select: 'form-select form-select-sm', btn: 'btn btn-primary btn-sm' }
    : { control: 'form-control form-control-lg', select: 'form-select form-select-lg', btn: 'btn btn-primary btn-lg' };
  const input = (f: FormItem) => {
    const id = `${idPrefix}-${idOf(f)}`;
    // #1769 —— 必填的格子带 `required` / `aria-required`；提交时被拦下的那一格加 `is-invalid`（Bootstrap 的标红）。
    const req = required(f) ? { required: true, 'aria-required': true } : {};
    const bad = invalid.includes(idOf(f)) ? ' is-invalid' : '';
    const badAttr = bad ? { 'aria-invalid': true } : {};
    if (typeof f !== 'string') {
      const k = answerKey(f.id);
      // #1770 —— 另外五种（文件头）。`text` 那一行一个字节没动。
      if (f.type === 'textarea') {
        return <textarea id={id} className={`${sz.control}${bad}`} rows={3} placeholder={hint(f)} aria-label={label(f)} value={values[k] || ''} onChange={set(k, f.id)} maxLength={500} data-field={f.id} {...req} {...badAttr} />;
      }
      if (f.type === 'select') {
        return (
          <select id={id} className={`${sz.select}${bad}`} aria-label={label(f)} value={values[k] || ''} onChange={set(k, f.id)} data-field={f.id} {...req} {...badAttr}>
            <option value="">{hint(f)}</option>
            {opts(f).map((o) => <option key={o} value={o}>{optText(f, o)}</option>)}
          </select>
        );
      }
      if (f.type === 'date') {
        const dateInput = <input id={id} className={`${sz.control}${bad}`} type="date" aria-label={label(f)} value={values[k] || ''} onChange={set(k, f.id)} data-field={f.id} {...req} {...badAttr} />;
        return (
          <>
            <label htmlFor={id} className={size === 'sm' ? 'form-label small mb-1' : 'form-label mb-1'}>{hint(f)}</label>
            {f.time === true ? (
              // #1792 —— 再问一个时间：≥576 宽并排各占一半，更窄上下叠。时间永远可以空（不带 required，Required 只管日期）。
              //   🔴 不写 `step`：Chromium 实测 `step="900"` 碰到手打的 14:37 会 stepMismatch、拦下整张表单，弹的是浏览器语言的
              //      一句话（不走我们那 14 种语言）—— 访客被一句我们控制不了的话挡在提交之外。PM 在票上批准了这处偏离。
              <div className="row g-2" data-field-datetime={f.id}>
                <div className="col-12 col-sm-6">{dateInput}</div>
                <div className="col-12 col-sm-6">
                  <input id={`${id}-time`} className={sz.control} type="time" aria-label={`${label(f)} – ${L.formTime}`}
                    value={values[timeKey(f.id)] || ''} onChange={set(timeKey(f.id))} data-field-time={f.id} />
                </div>
              </div>
            ) : dateInput}
          </>
        );
      }
      if (f.type === 'radio' || f.type === 'checkbox') {
        const radio = f.type === 'radio';
        // #1782 —— 必填的多选一项都没勾时每个框都带 `required`：浏览器逐个判，这时正好让它跟别的格子一起拦下、一起标红；
        //    勾了任一项就全去掉（不然就成了「每个都要勾」），取消勾回到一项都没有时再加回来。
        const none = !radio && required(f) && !(picked[f.id] || []).length;
        return (
          <fieldset id={id} data-field={f.id} data-field-type={f.type} {...(required(f) ? { 'aria-required': true } : {})} {...badAttr}>
            <legend className={size === 'sm' ? 'form-label small mb-1' : 'form-label mb-1'}>{hint(f)}</legend>
            {opts(f).map((o) => {
              const oid = `${id}--${o}`;
              return (
                <div key={o} className="form-check">
                  {radio
                    ? <input id={oid} className={`form-check-input${bad}`} type="radio" name={id} value={o} checked={values[k] === o} onChange={set(k, f.id)} data-field={f.id} {...(required(f) ? { required: true } : {})} />
                    : <input id={oid} className={`form-check-input${bad}`} type="checkbox" value={o} checked={(picked[f.id] || []).includes(o)} onChange={toggle(f, o)} data-field={f.id} {...(none ? { required: true } : {})} />}
                  <label className="form-check-label" htmlFor={oid}>{optText(f, o)}</label>
                </div>
              );
            })}
          </fieldset>
        );
      }
      return <input id={id} className={`${sz.control}${bad}`} type="text" placeholder={hint(f)} aria-label={label(f)} value={values[answerKey(f.id)] || ''} onChange={set(answerKey(f.id), f.id)} maxLength={200} data-field={f.id} {...req} {...badAttr} />;
    }
    if (f === 'service') {
      return (
        <select id={id} className={`${sz.select}${bad}`} aria-label={label('service')} value={values.service || ''} onChange={set('service')} {...req} {...badAttr}>
          <option value="">{hint('service')}</option>
          {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      );
    }
    if (f === 'message') {
      return <textarea id={id} className={`${sz.control}${bad}`} rows={3} placeholder={hint('message')} aria-label={label('message')} value={values.message || ''} onChange={set('message')} maxLength={2000} {...req} {...badAttr} />;
    }
    const type = f === 'phone' ? 'tel' : f === 'email' ? 'email' : 'text';
    return <input id={id} className={`${sz.control}${bad}`} type={type} placeholder={hint(f)} aria-label={label(f)} value={values[f] || ''} onChange={set(f)} maxLength={f === 'email' ? 320 : 200} {...req} {...badAttr} />;
  };

  // 蜜罐：屏幕外，真人填不到。内联样式是有意的 —— 它不是外观，主题不许把它打开（同 HeroLeadForm）。
  // #1473 —— 往【起端】推（inset-inline-start），不写 left：RTL 站的起端在右，`left: -9999px` 在那里是可以滚过去的一侧，
  //    整页多出 9999px 横向滚动（实测 scrollWidth 11279 / 视口 1280）。起端外侧在 LTR / RTL 下都滚不到。
  const honeypot = (
    <div aria-hidden="true" style={{ position: 'absolute', insetInlineStart: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
      <label htmlFor={`${idPrefix}-hp`}>Leave this field empty</label>
      <input id={`${idPrefix}-hp`} type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
    </div>
  );
  // #1801 —— 编辑器画布里不提交（设计文档 §5.4）：按钮灰，按钮那一块下面一句话说表单在哪儿能用（跟出错那一行同一个位置）。
  //    站上 / 预览 / 发布 ⟹ inCanvas 恒 false，HTML 跟以前逐字节相同。
  const errorLine = inCanvas
    ? <div className="text-sm text-body-secondary mt-2" data-part="form-canvas-note">{CANVAS_NOTE}</div>
    : error ? <div className="text-sm text-danger mt-2" data-part="form-error" role="alert">{error}</div> : null;
  // 浅底不挂这个属性：浅底上的 HTML 跟改前逐字相同。
  const toneAttr = tone === 'light' ? {} : { 'data-tone': tone };
  // 用的是哪一张（没有表单库时不挂）—— 看页面就知道块选中了谁。
  const formAttr = form ? { 'data-form-id': form.id } : {};
  const button = (cls: string) => (
    <button className={cls} type="submit" disabled={state === 'submitting' || inCanvas}>
      {state === 'submitting' ? L.formSending : buttonText}
    </button>
  );

  if (variant === 'inline') {
    return (
      <form onSubmit={handleSubmit} onInvalidCapture={handleInvalid} className={`hro-form mt-6${place}`} data-form-variant="inline" data-role="essential" {...toneAttr} {...formAttr}>
        <div className="d-flex flex-column flex-sm-row gap-2">
          {input(fields[0])}
          {button(`${sz.btn} text-nowrap`)}
        </div>
        {honeypot}
        {errorLine}
      </form>
    );
  }

  // 姓名 / 电话 / 邮箱各占半行（两个一排），需求下拉与留言占整行。
  // #1654 —— 按 `fields` 当前顺序（编辑器能重排，#1637），连续的半行字段算一段；段里个数是奇数时最后一个占整行，不落单。
  // #1769 —— 老板加的字段占整行（名字可能长，半行放不下）。
  const half = (f: FormItem) => f === 'name' || f === 'phone' || f === 'email';
  const wide = (i: number) => {
    if (!half(fields[i])) return true;
    if (i + 1 < fields.length && half(fields[i + 1])) return false;
    let start = i;
    while (start > 0 && half(fields[start - 1])) start -= 1;
    return (i - start) % 2 === 0;
  };
  return (
    <form onSubmit={handleSubmit} onInvalidCapture={handleInvalid} className={`hro-form mt-6 w-100${place}`} data-form-variant="stacked" data-role="essential" {...toneAttr} {...formAttr}>
      <div className="row g-2">
        {fields.map((f, i) => <div key={idOf(f)} className={wide(i) ? 'col-12' : 'col-12 col-sm-6'}>{input(f)}</div>)}
        <div className="col-12">{button(`${sz.btn} w-100`)}</div>
      </div>
      {honeypot}
      {errorLine}
    </form>
  );
}

// #1798 —— 发布出去的静态网页上它是一个岛（`src/islands/island.tsx`）；props 本来就全是可 JSON 的值，不用剥。
export default island('lead-form', BlockLeadForm);
