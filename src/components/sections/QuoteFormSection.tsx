'use client';

import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import { brand, siteId, leadApi, getServices } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

// TICKET-268e: the quote form now submits to the PLATFORM lead endpoint (POST /api/leads) instead of
// opening the owner's Google Form — so quote requests land in the owner's Customers list (source="quote").
// The service/property/urgency selections are folded into the lead's message; contact fields (name +
// email/phone) are collected here. Google Form (brand.googleFormUrl) is retired — kept as a dead field.

interface QuoteFormSectionProps {
  data: {
    formIntro: string;
    propertyTypes: string[];
    urgencyOptions: string[];
    benefits: string[];
    redirectMessage: string;
    buttonText: string;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

// 🔴🔴 #1027 — ONE MARKUP, AND NOTHING ELSE. Phase 2's batch B. Like contact-form beside it, this
// block had no variant branch to delete; the move is the other half of the job — the Tailwind classes
// that decided a look are gone and the parts carry BEM hooks the three proof sheets dress.
//
// 🔴 THIS BLOCK IS `essential` (blocks/quote-form.json `roleDefault`), for the reason written at
// blockAttrs.ts:36 — it is one of the two paths a customer reaches the business through. The reading
// that has to hold either side of this change is a REAL POST to `${leadApi}/api/leads` with the row
// read back on the platform side, not "the button reacts". Nothing in the request body moved:
// `siteId` / `name` / `email` / `phone` / `message` (still built by `buildMessage()`) / `source:"quote"`
// / `hp` are byte-for-byte the fields 268e shipped.
//
// 🔴 THE SELECTED STATE IS `aria-pressed`, NOT A CLASS. The old markup toggled six Tailwind classes
// per choice button to show what was picked. Neutral markup cannot carry a conditional look, and the
// selection is genuinely a STATE of a toggle button — so it is expressed the way HTML expresses that,
// and the structure layer draws it (`.quote-form__step button[aria-pressed="true"]`, globals.css).
// This also fixes something the classes never did: a screen reader now says which services are chosen.
//
// 🔴 TWO ROOTS, NOT MERGED — the second `blockAttrs()` call is the state after a successful submit.
// A runtime state, not a variant (contact-form's note says the whole reasoning). The decorative green
// tick `<svg>` is gone from it for the same reason #1018 deleted the `dark` overlay div: a sheet
// paints a mark with `::before { content: "" }` + `background-image`, and an empty element in every
// site's HTML for the benefit of one look is what phase 2 exists to remove.
//
// 🔴 `.quote-form__main` AND `.quote-form__aside` ARE CHILDREN OF `.quote-form__form`, NOT OF THE
// BLOCK. Everything a form submits has to be inside the `<form>`, and the sidebar sits beside the
// steps, so the `<form>` is the element a sheet turns into a grid — which is why it is a hook of its
// own rather than a transparent wrapper. CSS grid only places CHILDREN, so those two are direct
// children of it and nothing sits between.
//
// 🔴 THE THIRD HOOK IS NOT OPTIONAL — `blockAttrs('quote-form', block)`, never `blockAttrs('quote-form')`
// (#998's `data-block-layout`; #1008 r1 was bounced for exactly that, and it is invisible to `tsc`).
export default function QuoteFormSection({ data, locale, block }: QuoteFormSectionProps) {
  const services = getServices(locale);
  const labels = getLabels(locale);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [propertyType, setPropertyType] = useState('');
  const [urgency, setUrgency] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [hp, setHp] = useState(''); // honeypot
  const [state, setState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  const endpoint = (leadApi || '').replace(/\/$/, '') + '/api/leads';

  const handleServiceToggle = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  const buildMessage = () => {
    const parts: string[] = [];
    const names = selectedServices
      .map((id) => services.find((s) => s.id === id)?.name)
      .filter(Boolean);
    if (names.length) parts.push(`Services: ${names.join(', ')}`);
    if (propertyType) parts.push(`Property: ${propertyType}`);
    if (urgency) parts.push(`Urgency: ${urgency}`);
    if (notes.trim()) parts.push(notes.trim());
    return parts.join('\n');
  };

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
        body: JSON.stringify({ siteId, name, email, phone, message: buildMessage(), source: 'quote', hp }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState('success');
    } catch {
      setState('error');
      setError('Something went wrong. Please try again or email us directly.');
    }
  };

  if (state === 'success') {
    return (
      <section {...blockAttrs('quote-form', block)} className="quote-form">
        <p className="quote-form__success">{data.redirectMessage || "Thank you! We'll be in touch soon."}</p>
      </section>
    );
  }

  return (
    <section {...blockAttrs('quote-form', block)} className="quote-form">
      <form onSubmit={handleSubmit} className="quote-form__form">
        <div className="quote-form__main">
          <p className="quote-form__intro">{data.formIntro}</p>

          {/* Step 1: Select Services */}
          <div className="quote-form__step">
            <h2>1. Which services are you interested in?</h2>
            <p>{labels.selectAllThatApply}</p>
            {services.map((service) => (
              <button
                key={service.id}
                type="button"
                aria-pressed={selectedServices.includes(service.id)}
                onClick={() => handleServiceToggle(service.id)}
              >
                {/* `className=""` on purpose: ServiceIcon's own default is `h-8 w-8`, a Tailwind size,
                    and a size is the thing this markup is handing over. globals.css sizes it through
                    `.quote-form__step button svg`. */}
                <ServiceIcon icon={service.icon} className="" />
                <span>{service.name}</span>
              </button>
            ))}
          </div>

          {/* Step 2: Property Type */}
          <div className="quote-form__step">
            <h2>2. What type of property?</h2>
            {data.propertyTypes?.map((type) => (
              <button key={type} type="button" aria-pressed={propertyType === type} onClick={() => setPropertyType(type)}>
                {type}
              </button>
            ))}
          </div>

          {/* Step 3: Urgency */}
          <div className="quote-form__step">
            <h2>3. How soon do you need this?</h2>
            {data.urgencyOptions?.map((option) => (
              <button key={option} type="button" aria-pressed={urgency === option} onClick={() => setUrgency(option)}>
                {option}
              </button>
            ))}
          </div>

          {/* Step 4: Your details (submits to the platform, not Google Forms) */}
          <div className="quote-form__step">
            <h2>4. Your details</h2>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Name" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} placeholder="Email" />
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} placeholder="Phone" />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} placeholder="Anything else we should know?" />
          </div>

          {/* Honeypot: off-screen inline style on purpose — it is what makes the field invisible to a
              human and visible to a bot, so a theme must not be able to switch it on. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="qf-hp">Leave this field empty</label>
            <input id="qf-hp" type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>

          {error && <p className="quote-form__error">{error}</p>}

          <div className="quote-form__action">
            <p>{data.redirectMessage}</p>
            {/* The button keeps the SITE's button class — same boundary hero / cta-banner draw. */}
            <button type="submit" disabled={state === 'submitting'} className="btn-accent">
              {state === 'submitting' ? 'Sending…' : (data.buttonText || 'Submit Request')} &rarr;
            </button>
          </div>
        </div>

        <aside className="quote-form__aside">
          <h3>{labels.whatYouGet}</h3>
          <ul>
            {data.benefits?.map((benefit, index) => (
              <li key={index}>{benefit}</li>
            ))}
          </ul>
          <h4>{labels.needImmediateHelp}</h4>
          <p>{labels.callUsDirectly}</p>
          {brand.locations.map((location) => (
            <p key={location.label}>
              {location.label.replace(' Office', '')}: {location.phone}
            </p>
          ))}
        </aside>
      </form>
    </section>
  );
}
