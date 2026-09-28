'use client';

// hero-new 的表单部件（#1463 做什么 2）。提交那一条路逐字照 `HeroLeadForm.tsx` / `quote-form` 搬：
// POST `${leadApi}/api/leads`，蜜罐字段 `hp`，后端只要求「邮箱和电话至少有一个」；不跳页，原地显示
// `successMessage`；`redirect` 有值才跳。
//
// 🔴 `source` 用既有的 `contact-form`，不新造值 —— `manager/form_channel.go` 的 `formLeadSources` 是一份
//    封闭词表（同 `HeroLeadForm.tsx` 那段说明）。
// 🔴 字段只能从词表里挑（`blocks/hero-new/manifest.json` 的 `slots.form.choices.fields`），每个字段对应
//    客户记录的一列 —— 对照表只写在 `blocks/hero-new/lead-form/shape.md` 一处。词表外的值由 `validateSite` 拦，
//    这里再遇到就不画。
// 🔴 `inline` = 一行（一个字段 + 按钮），`stacked` = 姓名 / 电话并排 + 需求下拉 + 通栏提交（Webpixels hero-6）。
//    inline 只许一个字段，`validateSite` 按 manifest 旋钮上的 `maxItems` 拦；这里多给了也只画第一个。

import { useState } from 'react';
import { siteId, leadApi } from '@/lib/config';

export type HeroNewField = 'name' | 'phone' | 'email' | 'message' | 'service';
export interface HeroNewFormData {
  fields?: HeroNewField[];
  buttonText?: string;
  successMessage?: string;
  redirect?: string;
}

const VOCAB: HeroNewField[] = ['name', 'phone', 'email', 'message', 'service'];
const DEFAULT_FIELDS: Record<'inline' | 'stacked', HeroNewField[]> = {
  inline: ['phone'],
  stacked: ['name', 'phone', 'service'],
};
const PLACEHOLDER: Record<HeroNewField, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  message: 'What do you need?',
  service: 'What do you need?',
};

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

// 🔴 `services`（下拉的选项）由 Section.tsx 读好传进来，这里不自己读服务列表（#1463 r3）：
//    `page-deps.js §blockTypesReadingServices` 只看注册表指向的那份 `Section.tsx`，兄弟文件里的调用
//    会被归成「没注册、影响零页」⟹ 改服务列表时放了表单的页不报新日期（sitemap lastmod 静默少报）。
export default function HeroNewForm({ data, variant, services = [], center }: {
  data?: HeroNewFormData; variant: 'inline' | 'stacked'; services?: { id: string; name: string }[]; center?: boolean;
}) {
  const asked = (Array.isArray(data?.fields) ? data!.fields : []).filter((f): f is HeroNewField => VOCAB.includes(f));
  const fields = (asked.length ? Array.from(new Set(asked)) : DEFAULT_FIELDS[variant]).slice(0, variant === 'inline' ? 1 : VOCAB.length);
  const buttonText = data?.buttonText || 'Get a free quote';
  const successMessage = data?.successMessage || "Thanks! We've got your details and will be in touch.";

  const [values, setValues] = useState<Record<string, string>>({});
  const [hp, setHp] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');
  const set = (k: string) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const endpoint = (leadApi || '').replace(/\/$/, '') + '/api/leads';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const email = (values.email || '').trim();
    const phone = (values.phone || '').trim();
    if (!email && !phone) {
      setError(fields.includes('email') && !fields.includes('phone') ? 'Please enter your email.' : 'Please enter your phone number.');
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
        body: JSON.stringify({ siteId, name: (values.name || '').trim(), email, phone, message: parts.join('\n'), source: 'contact-form', hp }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (data?.redirect) { window.location.assign(data.redirect); return; }
      setState('success');
    } catch {
      setState('error');
      setError('Something went wrong. Please try again or call us.');
    }
  };

  if (state === 'success') {
    return <p className="fs-5 fw-semibold mt-6" data-part="form-success" role="status" data-slot="form.successMessage">{successMessage}</p>;
  }

  const input = (f: HeroNewField, extra = '') => {
    const id = `hro-${f}`;
    if (f === 'service') {
      return (
        <select id={id} className={`form-select form-select-lg${extra}`} aria-label={PLACEHOLDER.service} value={values.service || ''} onChange={set('service')}>
          <option value="">{PLACEHOLDER.service}</option>
          {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      );
    }
    if (f === 'message') {
      return <textarea id={id} className={`form-control form-control-lg${extra}`} rows={3} placeholder={PLACEHOLDER.message} aria-label={PLACEHOLDER.message} value={values.message || ''} onChange={set('message')} maxLength={2000} />;
    }
    const type = f === 'phone' ? 'tel' : f === 'email' ? 'email' : 'text';
    return <input id={id} className={`form-control form-control-lg${extra}`} type={type} placeholder={PLACEHOLDER[f]} aria-label={PLACEHOLDER[f]} value={values[f] || ''} onChange={set(f)} maxLength={f === 'email' ? 320 : 200} />;
  };

  // 蜜罐：屏幕外，真人填不到。内联样式是有意的 —— 它不是外观，主题不许把它打开（同 HeroLeadForm）。
  const honeypot = (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
      <label htmlFor="hro-hp">Leave this field empty</label>
      <input id="hro-hp" type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
    </div>
  );
  const errorLine = error ? <div className="text-sm text-danger mt-2" data-part="form-error" role="alert">{error}</div> : null;
  const button = (cls: string) => (
    <button className={cls} type="submit" disabled={state === 'submitting'} data-slot="form.buttonText">
      {state === 'submitting' ? 'Sending…' : buttonText}
    </button>
  );

  if (variant === 'inline') {
    return (
      <form onSubmit={handleSubmit} className={`hro-form mt-6${center ? ' mx-auto' : ''}`} data-form-variant="inline" data-role="essential">
        <div className="d-flex flex-column flex-sm-row gap-2">
          {input(fields[0])}
          {button('btn btn-primary btn-lg text-nowrap')}
        </div>
        {honeypot}
        {errorLine}
      </form>
    );
  }

  // 姓名 / 电话 / 邮箱各占半行（两个一排），需求下拉与留言占整行。
  const half = (f: HeroNewField) => f === 'name' || f === 'phone' || f === 'email';
  return (
    <form onSubmit={handleSubmit} className={`hro-form mt-6 w-100${center ? ' mx-auto' : ''}`} data-form-variant="stacked" data-role="essential">
      <div className="row g-2">
        {fields.map((f) => <div key={f} className={half(f) ? 'col-12 col-sm-6' : 'col-12'}>{input(f)}</div>)}
        <div className="col-12">{button('btn btn-primary btn-lg w-100')}</div>
      </div>
      {honeypot}
      {errorLine}
    </form>
  );
}
