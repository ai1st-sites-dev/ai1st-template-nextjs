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

import { useState } from 'react';
import * as config from '@/lib/config';
import type { SiteFormConfig } from '@/lib/types/config';
import { FORM_FIELDS, pickForm } from '../../scripts/lib/site-forms.js';
import { getLabels } from '@/lib/component-labels';

export type LeadField = 'name' | 'phone' | 'email' | 'message' | 'service';
export type LeadFormMode = 'teaser' | 'full';

const VOCAB = FORM_FIELDS as LeadField[];
// 站没有表单库（老站，没有 forms.json）时的内置默认 —— 留着，老站靠它顶（#1471 dead code 审查）。
const DEFAULT_FIELDS: Record<LeadFormMode, LeadField[]> = {
  teaser: ['phone'],
  full: ['name', 'phone', 'service'],
};
// #1641 —— 表单库里这张表没有按钮字 / 成功提示时的兜底（#1634 老板清空 = 删键 = 走到这里），按站的语言取。
const DEFAULT_BUTTON_TEXT = (locale: string) => getLabels(locale).formSubmit;
const DEFAULT_SUCCESS = (locale: string) => getLabels(locale).formThanks;

/** 这个语言的站级表单库。`@/lib/config` 在单测里是替身，可能没有 `getForms` ⟹ 当成空库。 */
function siteFormsFor(locale: string): SiteFormConfig[] {
  const get = (config as { getForms?: (l: string) => SiteFormConfig[] }).getForms;
  try { return typeof get === 'function' ? get(locale) || [] : []; } catch { return []; }
}
/**
 * #1631 —— 输入框占位符按站的语言（`component-labels.ts` 的 `getLabels`，跟 not-found 页 / 博客页取界面字同一张表）。
 * 那张表 14 种、没有 zh-tw ⟹ 繁体站这里回英文，跟改之前一样（已知，票面「做什么」3）。逐键回退英文。
 */
function placeholdersFor(locale: string): Record<LeadField, string> {
  const l = getLabels(locale);
  return { name: l.formName, phone: l.formPhone, email: l.formEmail, message: l.formNeed, service: l.formNeed };
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function BlockLeadForm({ mode, formId, forms, services = [], locale, center, align, idPrefix = 'hro', size = 'lg', tone = 'light' }: {
  mode: LeadFormMode;
  /** 块的 `form.id`；空 ⟹ 表单库第一张。 */
  formId?: string;
  /** 不传 ⟹ 读这个站自己的（`getForms(locale)`）；单格页 / 测试传演示那份。 */
  forms?: SiteFormConfig[];
  /** 「需求」下拉的选项，调用方的 Section.tsx 读（理由见文件头）。 */
  services?: { id: string; name: string }[];
  locale: string; center?: boolean;
  /** 表单整块的水平位置（hero 跟 `textAlign` 走）：center ⟹ `mx-auto`，right ⟹ `ms-auto`。`center` 是它的老写法。 */
  align?: 'left' | 'center' | 'right';
  idPrefix?: string; size?: 'lg' | 'sm';
  tone?: 'light' | 'dark' | 'brand';
}) {
  const form = pickForm(forms ?? siteFormsFor(locale), formId) as SiteFormConfig | null;
  const PLACEHOLDER = placeholdersFor(locale);
  const L = getLabels(locale);
  const variant: 'inline' | 'stacked' = mode === 'teaser' ? 'inline' : 'stacked';
  const asked = form
    ? (mode === 'teaser' ? [form.primary] : form.fields).filter((f): f is LeadField => VOCAB.includes(f))
    : [];
  const fields = (asked.length ? Array.from(new Set(asked)) : DEFAULT_FIELDS[mode]).slice(0, variant === 'inline' ? 1 : VOCAB.length);
  // #1637 —— 字段名：老板写的 `labels` > 语言默认（`PLACEHOLDER`，#1631 那一层）。只在这里叠一层，不动下面那一层。
  const label = (f: LeadField) => {
    const own = form?.labels?.[f];
    return (typeof own === 'string' && own.trim()) || PLACEHOLDER[f];
  };
  const buttonText = form?.buttonText || DEFAULT_BUTTON_TEXT(locale);
  const successMessage = form?.successMessage || DEFAULT_SUCCESS(locale);
  const redirect = form?.redirect;
  const place = align === 'right' ? ' ms-auto' : (center || align === 'center') ? ' mx-auto' : '';

  const [values, setValues] = useState<Record<string, string>>({});
  const [hp, setHp] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');
  const set = (k: string) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const endpoint = (config.leadApi || '').replace(/\/$/, '') + '/api/leads';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const email = (values.email || '').trim();
    const phone = (values.phone || '').trim();
    if (!email && !phone) {
      setError(fields.includes('email') && !fields.includes('phone') ? L.formNeedEmail : L.formNeedPhone);
      return;
    }
    const parts: string[] = [];
    if (values.service) parts.push(`Service: ${values.service}`);
    if ((values.message || '').trim()) parts.push(values.message.trim());
    setState('submitting');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: config.siteId, name: (values.name || '').trim(), email, phone, message: parts.join('\n'), source: 'contact-form', hp,
          ...(form ? { meta: { formId: form.id, formName: form.name, formMode: mode } } : {}),
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
  const input = (f: LeadField, extra = '') => {
    const id = `${idPrefix}-${f}`;
    if (f === 'service') {
      return (
        <select id={id} className={`${sz.select}${extra}`} aria-label={label('service')} value={values.service || ''} onChange={set('service')}>
          <option value="">{label('service')}</option>
          {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      );
    }
    if (f === 'message') {
      return <textarea id={id} className={`${sz.control}${extra}`} rows={3} placeholder={label('message')} aria-label={label('message')} value={values.message || ''} onChange={set('message')} maxLength={2000} />;
    }
    const type = f === 'phone' ? 'tel' : f === 'email' ? 'email' : 'text';
    return <input id={id} className={`${sz.control}${extra}`} type={type} placeholder={label(f)} aria-label={label(f)} value={values[f] || ''} onChange={set(f)} maxLength={f === 'email' ? 320 : 200} />;
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
  const errorLine = error ? <div className="text-sm text-danger mt-2" data-part="form-error" role="alert">{error}</div> : null;
  // 浅底不挂这个属性：浅底上的 HTML 跟改前逐字相同。
  const toneAttr = tone === 'light' ? {} : { 'data-tone': tone };
  // 用的是哪一张（没有表单库时不挂）—— 看页面就知道块选中了谁。
  const formAttr = form ? { 'data-form-id': form.id } : {};
  const button = (cls: string) => (
    <button className={cls} type="submit" disabled={state === 'submitting'}>
      {state === 'submitting' ? L.formSending : buttonText}
    </button>
  );

  if (variant === 'inline') {
    return (
      <form onSubmit={handleSubmit} className={`hro-form mt-6${place}`} data-form-variant="inline" data-role="essential" {...toneAttr} {...formAttr}>
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
  const half = (f: LeadField) => f === 'name' || f === 'phone' || f === 'email';
  const wide = (i: number) => {
    if (!half(fields[i])) return true;
    if (i + 1 < fields.length && half(fields[i + 1])) return false;
    let start = i;
    while (start > 0 && half(fields[start - 1])) start -= 1;
    return (i - start) % 2 === 0;
  };
  return (
    <form onSubmit={handleSubmit} className={`hro-form mt-6 w-100${place}`} data-form-variant="stacked" data-role="essential" {...toneAttr} {...formAttr}>
      <div className="row g-2">
        {fields.map((f, i) => <div key={f} className={wide(i) ? 'col-12' : 'col-12 col-sm-6'}>{input(f)}</div>)}
        <div className="col-12">{button(`${sz.btn} w-100`)}</div>
      </div>
      {honeypot}
      {errorLine}
    </form>
  );
}
