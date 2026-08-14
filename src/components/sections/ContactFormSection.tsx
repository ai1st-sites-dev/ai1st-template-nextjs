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
      <section {...blockAttrs('contact-form', block)} className="section-padding">
        <div className="container-width max-w-2xl text-center">
          <div className="rounded-xl bg-green-50 p-10">
            <svg className="mx-auto h-12 w-12 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="mt-4 text-lg font-medium text-green-900">{successMessage}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('contact-form', block)} className="section-padding">
      <div className="container-width max-w-2xl">
        <h2 className="text-3xl font-bold text-gray-900">{heading}</h2>
        <p className="mt-2 text-lg text-gray-600">{intro}</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="cf-name" className="block text-sm font-medium text-gray-700">Name</label>
            <input id="cf-name" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="cf-email" className="block text-sm font-medium text-gray-700">Email</label>
              <input id="cf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
            <div>
              <label htmlFor="cf-phone" className="block text-sm font-medium text-gray-700">Phone</label>
              <input id="cf-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            </div>
          </div>
          <div>
            <label htmlFor="cf-message" className="block text-sm font-medium text-gray-700">Message</label>
            <textarea id="cf-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={5000}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
          </div>

          {/* Honeypot: visually hidden + off-screen; real users never fill it. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="cf-hp">Leave this field empty</label>
            <input id="cf-hp" type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={state === 'submitting'} className="btn-accent text-lg disabled:opacity-60">
            {state === 'submitting' ? 'Sending…' : buttonText}
          </button>
          <p className="text-xs text-gray-400">
            {brand.email ? `Or email us at ${brand.email}` : ''}
          </p>
        </form>
      </div>
    </section>
  );
}
