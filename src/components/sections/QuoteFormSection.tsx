'use client';

import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import { brand, getServices } from '@/lib/config';

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

export default function QuoteFormSection({ data, locale }: QuoteFormSectionProps) {
  const services = getServices(locale);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [propertyType, setPropertyType] = useState('');
  const [urgency, setUrgency] = useState('');

  const handleServiceToggle = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const handleGetQuote = () => {
    const formUrl = new URL(brand.googleFormUrl);
    const entries = brand.googleFormEntries;

    formUrl.searchParams.set(entries.source, new URL(brand.googleFormUrl).hostname.replace('docs.google.com', new URL(`https://${brand.email.split('@')[1]}`).hostname));

    if (selectedServices.length > 0) {
      selectedServices.forEach((id) => {
        const serviceName = services.find((s) => s.id === id)?.name;
        if (serviceName) {
          formUrl.searchParams.append(entries.services, serviceName);
        }
      });
    }
    if (propertyType) {
      formUrl.searchParams.set(entries.propertyType, propertyType);
    }
    if (urgency) {
      formUrl.searchParams.set(entries.urgency, urgency);
    }

    window.open(formUrl.toString(), '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="section-padding">
      <div className="container-width">
        <div className="grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="text-lg text-gray-600">{data.formIntro}</p>

            {/* Step 1: Select Services */}
            <div className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900">
                1. Which services are you interested in?
              </h2>
              <p className="mt-1 text-sm text-gray-500">Select all that apply</p>
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
                      selectedServices.includes(service.id)
                        ? 'bg-primary-500 text-white'
                        : 'bg-gray-100 text-gray-500'
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
              <h2 className="text-xl font-semibold text-gray-900">
                2. What type of property?
              </h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {data.propertyTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPropertyType(type)}
                    className={`rounded-full border-2 px-5 py-2 text-sm font-medium transition-all ${
                      propertyType === type
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Urgency */}
            <div className="mt-10">
              <h2 className="text-xl font-semibold text-gray-900">
                3. How soon do you need this?
              </h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {data.urgencyOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setUrgency(option)}
                    className={`rounded-full border-2 px-5 py-2 text-sm font-medium transition-all ${
                      urgency === option
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="mt-12">
              <p className="mb-4 text-sm text-gray-500">
                {data.redirectMessage}
              </p>
              <button
                type="button"
                onClick={handleGetQuote}
                className="btn-accent text-lg"
              >
                {data.buttonText} &rarr;
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <div className="sticky top-32 rounded-xl bg-gray-50 p-8">
              <h3 className="text-lg font-semibold text-gray-900">
                What You Get
              </h3>
              <ul className="mt-4 space-y-3">
                {data.benefits.map((benefit, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                    </svg>
                    <span className="text-sm text-gray-700">{benefit}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 rounded-lg bg-primary-50 p-4">
                <h4 className="font-medium text-primary-900">Need immediate help?</h4>
                <p className="mt-1 text-sm text-primary-700">Call us directly:</p>
                {brand.locations.map((location) => (
                  <p key={location.label} className="mt-1 text-sm font-semibold text-primary-900">
                    {location.label.replace(' Office', '')}: {location.phone}
                  </p>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
