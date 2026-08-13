'use client';

import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import { brand, siteId, leadApi, getServices } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';

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
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

export default function QuoteFormSection({ data, locale }: QuoteFormSectionProps) {
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
      <section {...blockAttrs('quote-form')} className="section-padding">
        <div className="container-width max-w-2xl text-center">
          <div className="rounded-xl bg-green-50 p-10">
            <svg className="mx-auto h-12 w-12 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="mt-4 text-lg font-medium text-green-900">{data.redirectMessage || "Thank you! We'll be in touch soon."}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section {...blockAttrs('quote-form')} className="section-padding">
      <div className="container-width">
        <form onSubmit={handleSubmit} className="grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="text-lg text-gray-600">{data.formIntro}</p>

            {/* Step 1: Select Services */}
            <div className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900">1. Which services are you interested in?</h2>
              <p className="mt-1 text-sm text-gray-500">{labels.selectAllThatApply}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleServiceToggle(service.id)}
                    className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                      selectedServices.includes(service.id)
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                      selectedServices.includes(service.id) ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-500'
                    }`}>
                      <ServiceIcon icon={service.icon} className="h-5 w-5" />
                    </div>
                    <span className="text-sm font-medium">{service.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Property Type */}
            <div className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900">2. What type of property?</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {data.propertyTypes?.map((type) => (
                  <button key={type} type="button" onClick={() => setPropertyType(type)}
                    className={`rounded-full border-2 px-5 py-2 text-sm font-medium transition-all ${
                      propertyType === type ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}>{type}</button>
                ))}
              </div>
            </div>

            {/* Step 3: Urgency */}
            <div className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900">3. How soon do you need this?</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {data.urgencyOptions?.map((option) => (
                  <button key={option} type="button" onClick={() => setUrgency(option)}
                    className={`rounded-full border-2 px-5 py-2 text-sm font-medium transition-all ${
                      urgency === option ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}>{option}</button>
                ))}
              </div>
            </div>

            {/* Step 4: Your details (submits to the platform, not Google Forms) */}
            <div className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900">4. Your details</h2>
              <div className="mt-4 grid gap-4">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Name"
                  className="rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} placeholder="Email"
                    className="rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} placeholder="Phone"
                    className="rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                </div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} placeholder="Anything else we should know?"
                  className="rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>

              {/* Honeypot */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
                <label htmlFor="qf-hp">Leave this field empty</label>
                <input id="qf-hp" type="text" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
              </div>

              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

              <div className="mt-6">
                <p className="mb-4 text-sm text-gray-500">{data.redirectMessage}</p>
                <button type="submit" disabled={state === 'submitting'} className="btn-accent text-lg disabled:opacity-60">
                  {state === 'submitting' ? 'Sending…' : (data.buttonText || 'Submit Request')} &rarr;
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <div className="sticky top-32 rounded-xl bg-gray-50 p-8">
              <h3 className="text-lg font-semibold text-gray-900">{labels.whatYouGet}</h3>
              <ul className="mt-4 space-y-3">
                {data.benefits?.map((benefit, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                    </svg>
                    <span className="text-sm text-gray-700">{benefit}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 rounded-lg bg-primary-50 p-4">
                <h4 className="font-medium text-primary-900">{labels.needImmediateHelp}</h4>
                <p className="mt-1 text-sm text-primary-700">{labels.callUsDirectly}</p>
                {brand.locations.map((location) => (
                  <p key={location.label} className="mt-1 text-sm font-semibold text-primary-900">
                    {location.label.replace(' Office', '')}: {location.phone}
                  </p>
                ))}
              </div>
            </div>
          </aside>
        </form>
      </div>
    </section>
  );
}
