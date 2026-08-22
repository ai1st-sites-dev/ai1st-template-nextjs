'use client';

import { useState } from 'react';
import { siteId, leadApi } from '@/lib/config';

// #1065 — hero 的第八个部件：`.hero__form`。
//
// 🔴 为什么 hero 需要它：`with-form` 从 2026-08-12 那份 spec 起就写在 hero 的内容形态值表里
// （`blocks/hero.json` 的 `block_layout`），而在这个文件之前**没有任何东西渲染它** —— 主题可以声明
// 「我给带表单的 hero 写了造型」，站也可以在页面 JSON 里写 `block_layout: "with-form"`，产物里
// 一个表单都不会出现。声明一个渲染不出来的形态，比不声明更糟：它是静默的。
//
// 🔴 为什么是**真的**表单，不是一个摆样子的框：这是客人在首屏留下联系方式的那条路，跟
// `ContactFormSection`（#268b）走的是同一个后端入口 `${leadApi}/api/leads`，同一个蜜罐字段 `hp`，
// 所以留下来的线索照样落进老板的 Customers 列表。字段砍到三个（姓名 / 邮箱 / 电话）—— 首屏的表单
// 越长填的人越少，而后端只要求「邮箱和电话至少有一个」。
//
// 🔴 `source` 用既有的 `contact-form`，不新造值：`manager/form_channel.go:116` 的 `formLeadSources`
// 是一份**封闭词表**，不在表里的值会被 `canonicalLeadSourceValue` 换掉并打一条日志；新增一个值要连
// `dashboard/src/lib/channels.tsx` 一起动（`TestTicket770_EveryBackendValueIsInTheFrontendList`
// 盯着这一对）。那是本票范围之外的活。
//
// 🔴 角色标 `essential`，跟 `contact-form` 那个块同一个理由（`blockAttrs.ts:35`）：它是客人真正
// 联系到这门生意的那条路，藏掉它不是外观回退，是把这个站的获客悄悄关掉。
// 🔴 这是个 client 组件，`HeroSection` 本身仍然是 server 组件 —— 表单要状态，hero 的其余部分不要。
// 🔴 字段本身不带 class：契约 §1 拒绝标签选择器，所以 `input` / `label` 主题**够不着**，它们的样式
// 住在结构层（`globals.css` 的 `.hero__form label, .hero__form input`），跟 contact-form 同一个分工。
export interface HeroLeadFormProps {
  data?: {
    buttonText?: string;
    successMessage?: string;
  };
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function HeroLeadForm({ data }: HeroLeadFormProps) {
  const buttonText = data?.buttonText ?? 'Get a quote';
  const successMessage = data?.successMessage ?? "Thanks! We've got your details and will be in touch.";

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [hp, setHp] = useState(''); // honeypot — stays empty for real users
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  const endpoint = (leadApi || '').replace(/\/$/, '') + '/api/leads';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() && !phone.trim()) {
      setError('Please provide an email or phone number.');
      return;
    }
    setState('submitting');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, name, email, phone, message: '', source: 'contact-form', hp }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState('success');
    } catch (err) {
      setState('error');
      setError('Something went wrong. Please try again or call us.');
    }
  };

  // 🔴 成功之后那句话**照样带这个钩子和这个角色**：它是同一个部件的另一个运行时状态，不是另一个
  // 部件。只给表单那一支带钩子的话，一份只给表单写了造型的表会让「已收到」那句话裸奔（这是
  // `ContactFormSection` 两个根元素那条注释的同一个理由）。
  if (state === 'success') {
    return <p className="hero__form" data-role="essential">{successMessage}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="hero__form" data-role="essential">
      <label htmlFor="hero-name">Name</label>
      <input id="hero-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />

      <label htmlFor="hero-email">Email</label>
      <input id="hero-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} />

      <label htmlFor="hero-phone">Phone</label>
      <input id="hero-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} />

      {/* Honeypot: off-screen; real users never fill it. Inline style on purpose — it is not a look,
          it is what makes the field invisible to a human and visible to a bot, and a theme must not
          be able to switch it on. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor="hero-hp">Leave this field empty</label>
        <input id="hero-hp" type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
      </div>

      {/* 🔴 这个 `<p>` 没有钩子,而两个姊妹组件都有 —— 这是一条**真的、用户看得见的**不一致,
          写在这里是为了它不再被当成"打磨"顺手带过(#1140,来源 #1065;那一条原话是"契约没要求它,
          所以不违约,属一致性缺口")。
          现读的三个数(2026-08-22,`templates/nextjs/`):
            · `ContactFormSection.tsx:142` 是 `.contact-form__error`,`QuoteFormSection` 那份是
              `.quote-form__error`,两个名字都在契约 §1 的部件清单里,也都在 `theme-css-lint.js`
              的 `HOOKS` 里;hero 这一族**没有**对应的那一个。
            · 而表**真的在给它们排版**:`grep -c` 全部 83 张表,`.contact-form__error` 与
              `.quote-form__error` 各 83/83 命中,规则是 `padding` + `border-*` + `border-radius`
              那一套错误框。⟹ 提交失败时,联系表单和报价表单弹出一个框,而 hero 这里是**裸文字**。
          🔴 所以这不是"加了等于没加"。要拿到那个效果得动四处:这一行的 class + 契约 §1 + `HOOKS`
          + `sheet-recipes.js` 里那条规则,最后**重新生成 83 张表**。而重生成 83 张表要过表那一族
          全部守卫(含 `theme-text-bands.json` 里存着的几何 md5)。
          ⟹ 处置:**本批不做** —— 按本票正文「用户可见的缺陷…照旧各自开票」,它该是一张自己的票,
          不是打磨批次能捎带的活。这段注释是给那张票的现场。 */}
      {error && <p>{error}</p>}

      <button type="submit" disabled={state === 'submitting'} className="btn-accent">
        {state === 'submitting' ? 'Sending…' : buttonText}
      </button>
    </form>
  );
}
