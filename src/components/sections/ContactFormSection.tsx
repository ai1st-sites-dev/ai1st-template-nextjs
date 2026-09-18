'use client';

import { useState } from 'react';
import { brand, siteId, leadApi } from '@/lib/config';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

// TICKET-268b: a REAL contact form that POSTs to the platform lead endpoint (268a POST /api/leads),
// so leads land in the platform (visible to the site owner in the dashboard) instead of a Google Form
// the platform can't see. The site is served statically from R2, so this fetches the absolute manager
// URL (config.leadApi, injected at build time; 268a's corsAll allows the cross-origin POST). Includes a
// hidden honeypot field (`hp`) — bots fill it, real users don't; the backend silently drops those.

interface ContactFormSectionProps {
  data?: {
    heading?: string;
    intro?: string;
    buttonText?: string;
    successMessage?: string;
    imageUrl?: string;
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

// 🔴🔴 #1027 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch B (hero #1008, cta-banner #1018,
// page-header #1019 went first). This block had NO variant branch to delete: the move here is the
// other half of the same job — every Tailwind class that decided a LOOK is gone from the markup and
// the parts now carry BEM hooks the three proof sheets dress.
//
// 🔴 THIS BLOCK IS `essential` (blocks/contact-form.json `roleDefault`), and what that means in
// practice is written at blockAttrs.ts:35: it is the path a customer actually reaches the business
// through. Breaking it is not a cosmetic regression, it silently switches the business's lead
// collection off. So the thing that had to be measured before and after is not "does the button
// react" — it is a REAL POST to `${leadApi}/api/leads` and the row read back on the platform side.
// Every field name in the request body below (`siteId` / `name` / `email` / `phone` / `message` /
// `source` / `hp`) is UNCHANGED by this ticket; only the elements around them are.
//
// 🔴 THERE ARE TWO ROOTS AND THEY ARE NOT MERGED. The second `blockAttrs()` call below is the state
// after a successful submit — a RUNTIME STATE, not a variant. A variant is a choice about how one
// piece of content looks and belongs in a stylesheet; "the message has been sent" is different
// content. Both roots carry the block's hooks so a sheet dresses the block either way (a sheet that
// only styled the idle form would leave the thank-you note wearing base.css alone).
//
// 🔴 THE DECORATIVE TICK IS GONE. The old success state drew a green check `<svg>`; a sheet paints
// the same mark with `::before { content: "" }` + `background-image`, which is the boundary #1018 drew
// when it deleted the `dark` variant's overlay div. An empty element in every site's HTML for the
// benefit of one look is exactly the markup phase 2 exists to remove.
//
// 🔴 THE FIELDS THEMSELVES CARRY NO CLASS — the structure layer reaches them through the part hook
// (`.contact-form__form label`, `… input`, globals.css). That is page-header's precedent for the
// crumb `<ol>`/`<li>` (#1019): what a part IS is the structure layer's, where it sits is the sheet's.
// The honeypot keeps its inline off-screen style: it is not a look, it is the thing that makes it
// invisible to a human and visible to a bot, and a theme must not be able to switch it on.
//
// 🔴 THE SECOND ARGUMENT IS NOT OPTIONAL — `blockAttrs('contact-form', block)`, never
// `blockAttrs('contact-form')`. #1341 retired the third hook `data-block-layout`, but `data-role`,
// `data-shape` and `data-has-*` all still come from that second argument, and dropping it is
// silent in every instrument we own (`registry.ts` types the components as
// `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was bounced for exactly that.
// ══ #1370：两个按形态出的零件（`__media` / `__aside`）═══════════════════════════════════════════
//
// 🔴 **为什么是「按形态渲染」而不是「总在树上、用 CSS 藏起来」。** 这个块已有的六种形态在 manifest 里
// 都写着 `media: none`，而排版意图探针那条判据是「一个 `__media` 都不许有」
// （`scripts/lib/layout-intent.mjs` §media-none）。量主题那份夹具会把每个可选槽都填上，所以图零件
// 只要在树上就得处置。两条路都试过，只有一条走得通：
//   · `display: none` 藏掉 —— **撞检查 ②**（essential 块里有内容的零件被藏起来就报）。这个块是
//     `essential`（`block-roles.json:6`），藏起来的那个零件里是一张真 `<img>`。同一件事我在 #1362
//     的 `faq-accordion`（也是 essential）上量过，本票在这个块上又量了一遍，两次都红，读数贴在票上。
//   · **按形态出** —— 不需要它的六种形态里这个零件根本不在 DOM 上，`media-none` 与检查 ② 都不问它。
//
// 🔴 **零件是根的直接子元素，内部不带 `data-block-part`，也不放两个以上同类元素。** 探针的取样面是
// 根的直接子元素加 `data-block-part` 包装层里一层，而 `items` 轴判「同类同级项少于两个」——
// 一进取样面，这个块已有的六种形态会一起红。`__aside` 里那几行各有各的 class，不是同类项。
//
// 🔴 **图的字段名叫 `imageUrl`**，跟 hero / content-split / gallery 逐字相同：写入闸
// `scripts/lib/image-urls.js` 的 `IMAGE_FIELDS` 按【字段名】认「这个值是一张图的地址」，换个名字
// 那道闸就看不见它（#1361 四臂实测）。`scripts/edit-site.js` 的 `## Images` 段要跟着列一行。
//
// 🔴 **说明写在这里，不写进上面那个 `data: { … }`。** 量主题那份夹具页是从那对花括号之间的文本
// **现切**出来的（`scripts/block-migration/gen-allblocks.js` §fields 按顶层 `;` / `,` 切、取第一个
// `:` 之前的串当字段名），一条 JSDoc 落在字段前面，切出来的键就是「注释+字段名」那一长串 ——
// 全填版夹具里那个槽于是根本不存在，而它的下场不是红（#1362 实测：media 轴退化成「报告而不判」）。
export default function ContactFormSection({ data, block }: ContactFormSectionProps) {
  const heading = data?.heading ?? 'Get in touch';
  const intro = data?.intro ?? "Leave your details and we'll get back to you shortly.";
  const buttonText = data?.buttonText ?? 'Send message';
  const successMessage = data?.successMessage ?? "Thanks! We've received your message and will be in touch soon.";
  // #1370 —— 这个块排成什么样。`sync-config.js` 构建时按 spec D18 的三级算好写进页面 JSON
  // （缺槽落回也在那里做完），所以这里读到的就是 DOM 上那个 `data-shape`，两者不会分叉。
  const shape = block?.shape;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState(''); // honeypot — stays empty for real users
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  const endpoint = (leadApi || '').replace(/\/$/, '') + '/api/leads';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // Client-side minimum: at least one contact channel (backend enforces too).
    if (!email.trim() && !phone.trim()) {
      setError('Please provide an email or phone number.');
      return;
    }
    setState('submitting');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          name,
          email,
          phone,
          message,
          source: 'contact-form',
          hp, // honeypot passthrough
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState('success');
    } catch (err) {
      setState('error');
      setError('Something went wrong. Please try again or email us directly.');
    }
  };

  if (state === 'success') {
    return (
      <section {...blockAttrs('contact-form', block)} className="contact-form">
        <p className="contact-form__success">{successMessage}</p>
      </section>
    );
  }

  return (
    <section {...blockAttrs('contact-form', block)} className="contact-form">
      <h2 className="contact-form__heading">{heading}</h2>
      <p className="contact-form__intro">{intro}</p>

      {/* 🔴 #1370 —— 两个零件的**盒子一直在树上，里面的东西按形态出**。三件事同时要成立，只有这个
          写法都满足（每一条都是量出来的，读数在票上）：
          ① 盒子一直在 ⟹ 契约钩子不会「在任何一页上都没出现」（检查 ⑤ 的 sample coverage 那一条，
             第一版按形态整个不渲染，它当场红：`2 contract hook(s) are on no page`）。
          ② 里面的东西按形态出 ⟹ 不需要它的六种形态上这个盒子是**空的**，而空盒子被藏起来时
             检查 ②（essential 块里有内容的零件不许被藏）会跳过它 —— 它只判「里面有东西」的。
             反过来（图一直渲染、靠 CSS 藏）在 #1362 的 faq-accordion 上量过：当场红。
          ③ 六种形态上把空盒子藏掉 ⟹ 排版意图那条 `media-none`（一个 `__media` 都不许有）照旧成立，
             而且老板的页面上不会多出一条空带子（`public/shapes.css` 那一段）。
          🔴 **这两个盒子放在 `__intro` 之后、`__form` 之前，这个位置是承重的，别挪到 `</section>` 前面去。**
             窄屏（<1024px）一列堆叠时 DOM 顺序就是视觉顺序：放在最后的话，`form-over-media` 的那张图会落在
             细则小字**下面**（实测 375px：note y=1683 而 media y=1732），`info-side` 的联系方式卡同理
             （note y=2745 / aside y=2794）。对一个叫「表单叠在图上」的形态，图排最后不是「换行或减列」，
             是 DOM 顺序漏出来了。
             🔴 用 DOM 位置解决而**不是**在形态层写 `order`：写 order 就得连 `__note` 一起写（它必须排在
             `__form` 之后，#1135 立的那条性质），而那会把 `sheet-recipes.test.js` ⑪ 的阳性对照 B 打掉 ——
             它标定的前提是「八副画法里只有 `panel-left` 自己写了 note 的 order」，实测点名数会从 7 掉到 5。
             这六种既有形态上两个盒子都是 `display: none`，所以挪 DOM 位置对它们**一个像素都不动**。 */}
      <div className="contact-form__media">
        {shape === 'form-over-media' && data?.imageUrl ? <img src={data.imageUrl} alt="" /> : null}
      </div>
      <div className="contact-form__aside">
        {shape === 'info-side' ? (
          <>
            {brand.locations?.[0] && (
              <>
                <p className="contact-form__aside-label">{brand.locations[0].label}</p>
                <p className="contact-form__aside-address">{brand.locations[0].address}</p>
                <a
                  href={`tel:${brand.locations[0].phone.replace(/\s/g, '')}`}
                  className="contact-form__aside-phone"
                >
                  {brand.locations[0].phone}
                </a>
              </>
            )}
            {brand.email && (
              <a href={`mailto:${brand.email}`} className="contact-form__aside-email">{brand.email}</a>
            )}
          </>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="contact-form__form">
        <label htmlFor="cf-name">Name</label>
        <input id="cf-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />

        <label htmlFor="cf-email">Email</label>
        <input id="cf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} />

        <label htmlFor="cf-phone">Phone</label>
        <input id="cf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} />

        <label htmlFor="cf-message">Message</label>
        <textarea id="cf-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={5000} />

        {/* Honeypot: visually hidden + off-screen; real users never fill it. Inline style on purpose —
            see the note above the component. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="cf-hp">Leave this field empty</label>
          <input id="cf-hp" type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
        </div>

        {error && <p className="contact-form__error">{error}</p>}

        {/* 🔴 The button keeps the SITE's button class rather than getting a hook of its own — the same
            boundary hero and cta-banner draw. A theme owns layout; what a call to action looks like is
            the brand's, and it already follows the palette through CSS variables. */}
        <button type="submit" disabled={state === 'submitting'} className="btn-accent">
          {state === 'submitting' ? 'Sending…' : buttonText}
        </button>
      </form>

      {brand.email && (
        <p className="contact-form__note">Or email us at {brand.email}</p>
      )}
    </section>
  );
}
