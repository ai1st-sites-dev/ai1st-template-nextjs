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

  // #1158（来源 #1150）—— 成功之后那句话拿**自己的**钩子 `.hero__form-success`，跟两个姊妹部件
  // （`.contact-form__success` / `.quote-form__success`）同构，角色也同一个 `success`。
  //
  // 🔴 上一版这里写的是 `className="hero__form"`（借表单那块面板的造型），当时的理由是「只给表单那
  // 一支带钩子的话，一份只给表单写了造型的表会让『已收到』那句话裸奔」。那个理由**在没有专属钩子
  // 的前提下是对的**，而本次把前提改掉了：`.hero__form-success` 进了 §1 的钩子名单、进了
  // `sheet-recipes.js` 的 `SHAPES.hero.role`，池里每一张表都为它写了规则（`hero__form-success`
  // 从 0/83 变成 83/83）。所以现在它有自己的造型，不再需要借。
  // 🔴 为什么不两个钩子都带：面板那条规则画的是**一张表单**（`display: grid` + 边框 + 内距），
  // 而这里只有一句话。姊妹块的做法就是不带 —— `ContactFormSection.tsx:112` 的成功那一支是
  // `<p className="contact-form__success">`，`contact-form__form` 那个面板钩子不在上面。
  // 角色仍是 `essential`：它是客人「我留下联系方式了吗」的唯一回执，藏掉它跟藏掉表单一样严重。
  if (state === 'success') {
    return <p className="hero__form-success" data-role="essential">{successMessage}</p>;
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

      {/* #1150 — 这个 `<p>` 的钩子是 `.hero__form-error`,跟两个姊妹部件
          (`.contact-form__error` / `.quote-form__error`)拿的是同一个角色 `error`,所以三处的
          错误框是同一段代码画出来的,不是照抄三遍。
          🔴 加 class 这一行**单独放出去等于没改**:表里没有对应规则时,页面上仍然是裸文字。
          它是四处一起的一次改动 —— 这一行 · 契约 §1 的 Hero parts · `theme-css-lint.js` 的
          `HOOKS` · `sheet-recipes.js` 的 `SHAPES.hero.role`,最后重新生成那 83 张表。
          📌 不给它写 `partExtra`:它是 `<form class="hero__form">` 的子节点,而 `.hero__form` 走
          `ROLES.panel`,那个角色写的是 `display: grid` 而**不写 `grid-template-columns`** ⟹ 单栏,
          子节点本来就占满整行,`grid-column: 1 / -1` 在这里是恒等式。跟 `sheet-recipes.js` 里
          `contact-form` 那条同名 `partExtra` 是同一个形状 —— 那里已经写明它今天也是恒等式,留着是保险。 */}
      {error && <p className="hero__form-error">{error}</p>}

      <button type="submit" disabled={state === 'submitting'} className="btn-accent">
        {state === 'submitting' ? 'Sending…' : buttonText}
      </button>
    </form>
  );
}
