'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BlockLeadForm —— 块里的「表单」部件（hero-new / footer-new 共用一份，总纲 #1422 的 T2.3 / T2.2A）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 📌 出处：#1463（T2.3 hero）r2 的 `blocks/hero-new/HeroNewForm.tsx`（dev2 写的），**逐字搬来**，只加了
//    `idPrefix` / `size` 两个参数。两张票正文都写着「谁先到谁做」：#1464（footer）先落 main，所以住处是这里
//    （`src/components/`，不在某个块的目录里 —— 两个块共用，归哪个块都不对）；#1463 落地时改成引这一份。
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
// 🔴 `idPrefix`：同一页上 hero 和 footer 各有一个表单时 id 不许撞（hero 用 `hro`，footer 用 `ftr`）。
//    `size`：hero 是 `lg`，页脚画小一号 `sm`（Webpixels 页脚那几份都是 `-sm`）。
// #1477 —— `tone`：调用方把这块底色的字色判据（`contrast.js` §toneForBg）传进来。不是 `light` 时表单根上挂
//    `data-tone`，输入框的字 / 占位字 / 边框换成白色那一档（规则在 `scripts/lib/site-css.js` §ON_DEEP_FORM，全站一份）。
//    只给「输入框透明、直接压在深底上」的调用方传（footer-new）；cta-new 深底时自己把输入框涂成白底（它的
//    `block.css`），占位字原来的灰在白底上看得清，所以它不传 —— 传了就是白底白字。

import { useState } from 'react';
import { siteId, leadApi, getServices } from '@/lib/config';

export type LeadField = 'name' | 'phone' | 'email' | 'message' | 'service';
export interface BlockLeadFormData {
  fields?: LeadField[];
  buttonText?: string;
  successMessage?: string;
  redirect?: string;
}

const VOCAB: LeadField[] = ['name', 'phone', 'email', 'message', 'service'];
const DEFAULT_FIELDS: Record<'inline' | 'stacked', LeadField[]> = {
  inline: ['phone'],
  stacked: ['name', 'phone', 'service'],
};
const PLACEHOLDER: Record<LeadField, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  message: 'What do you need?',
  service: 'What do you need?',
};

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function BlockLeadForm({ data, variant, locale, center, idPrefix = 'hro', size = 'lg', tone = 'light' }: {
  data?: BlockLeadFormData; variant: 'inline' | 'stacked'; locale: string; center?: boolean; idPrefix?: string; size?: 'lg' | 'sm';
  tone?: 'light' | 'dark' | 'brand';
}) {
  const asked = (Array.isArray(data?.fields) ? data!.fields : []).filter((f): f is LeadField => VOCAB.includes(f));
  const fields = (asked.length ? Array.from(new Set(asked)) : DEFAULT_FIELDS[variant]).slice(0, variant === 'inline' ? 1 : VOCAB.length);
  const buttonText = data?.buttonText || 'Get a free quote';
  const successMessage = data?.successMessage || "Thanks! We've got your details and will be in touch.";
  let services: { id: string; name: string }[] = [];
  try { services = (getServices(locale) || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })); } catch { services = []; }

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

  // 类名写全拼、不拼接：purge 按字面扫 .tsx（`scripts/lib/site-css.js`），`form-control-${size}` 它认不出来。
  const sz = size === 'sm'
    ? { control: 'form-control form-control-sm', select: 'form-select form-select-sm', btn: 'btn btn-primary btn-sm' }
    : { control: 'form-control form-control-lg', select: 'form-select form-select-lg', btn: 'btn btn-primary btn-lg' };
  const input = (f: LeadField, extra = '') => {
    const id = `${idPrefix}-${f}`;
    if (f === 'service') {
      return (
        <select id={id} className={`${sz.select}${extra}`} aria-label={PLACEHOLDER.service} value={values.service || ''} onChange={set('service')}>
          <option value="">{PLACEHOLDER.service}</option>
          {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
      );
    }
    if (f === 'message') {
      return <textarea id={id} className={`${sz.control}${extra}`} rows={3} placeholder={PLACEHOLDER.message} aria-label={PLACEHOLDER.message} value={values.message || ''} onChange={set('message')} maxLength={2000} />;
    }
    const type = f === 'phone' ? 'tel' : f === 'email' ? 'email' : 'text';
    return <input id={id} className={`${sz.control}${extra}`} type={type} placeholder={PLACEHOLDER[f]} aria-label={PLACEHOLDER[f]} value={values[f] || ''} onChange={set(f)} maxLength={f === 'email' ? 320 : 200} />;
  };

  // 蜜罐：屏幕外，真人填不到。内联样式是有意的 —— 它不是外观，主题不许把它打开（同 HeroLeadForm）。
  const honeypot = (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
      <label htmlFor={`${idPrefix}-hp`}>Leave this field empty</label>
      <input id={`${idPrefix}-hp`} type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
    </div>
  );
  const errorLine = error ? <div className="text-sm text-danger mt-2" data-part="form-error" role="alert">{error}</div> : null;
  // 浅底不挂这个属性：浅底上的 HTML 跟改前逐字相同。
  const toneAttr = tone === 'light' ? {} : { 'data-tone': tone };
  const button = (cls: string) => (
    <button className={cls} type="submit" disabled={state === 'submitting'} data-slot="form.buttonText">
      {state === 'submitting' ? 'Sending…' : buttonText}
    </button>
  );

  if (variant === 'inline') {
    return (
      <form onSubmit={handleSubmit} className={`hro-form mt-6${center ? ' mx-auto' : ''}`} data-form-variant="inline" data-role="essential" {...toneAttr}>
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
  const half = (f: LeadField) => f === 'name' || f === 'phone' || f === 'email';
  return (
    <form onSubmit={handleSubmit} className={`hro-form mt-6 w-100${center ? ' mx-auto' : ''}`} data-form-variant="stacked" data-role="essential" {...toneAttr}>
      <div className="row g-2">
        {fields.map((f) => <div key={f} className={half(f) ? 'col-12 col-sm-6' : 'col-12'}>{input(f)}</div>)}
        <div className="col-12">{button(`${sz.btn} w-100`)}</div>
      </div>
      {honeypot}
      {errorLine}
    </form>
  );
}
