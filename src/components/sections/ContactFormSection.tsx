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
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
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
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('contact-form', block)`, never
// `blockAttrs('contact-form')`. #998 puts the page JSON's `block_layout` and `role` on the root
// element through that second argument, and dropping it is silent in every instrument we own
// (`registry.ts` types the components as `ComponentType<any>`, so `tsc` cannot see it). #1008 r1 was
// bounced for exactly that.
export default function ContactFormSection({ data, block }: ContactFormSectionProps) {
  const heading = data?.heading ?? 'Get in touch';
  const intro = data?.intro ?? "Leave your details and we'll get back to you shortly.";
  const buttonText = data?.buttonText ?? 'Send message';
  const successMessage = data?.successMessage ?? "Thanks! We've received your message and will be in touch soon.";

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
