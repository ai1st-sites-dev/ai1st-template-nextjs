'use client';

import Link from 'next/link';
import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { brand, getNavigation } from '@/lib/config';

function localizeHref(href: string, locale: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (href === '/') return `/${locale}`;
  return `/${locale}${href}`;
}

export default function Header({ locale }: { locale: string }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { header } = getNavigation(locale);

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <nav className="container-width flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href={`/${locale}`} className="flex items-center gap-2" aria-label={`${brand.name} - Home`}>
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="h-10 w-auto max-w-[160px] object-contain" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500">
              <ServiceIcon icon={brand.logoIcon} className="h-6 w-6 text-white" />
            </div>
          )}
          {!brand.logoUrl && <span className="text-xl font-bold text-primary-900">{brand.name}</span>}
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-8 md:flex">
          {header.links.map((link) => (
            <Link key={link.href} href={localizeHref(link.href, locale)} className="text-sm font-medium text-gray-600 transition-colors hover:text-primary-500">
              {link.label}
            </Link>
          ))}
          <Link href={localizeHref(header.cta.href, locale)} className="btn-accent text-sm">{header.cta.label}</Link>
          <LanguageSwitcher currentLocale={locale} />
        </div>

        {/* Mobile Menu Button */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-gray-600 md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
          )}
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="border-t bg-white px-4 pb-4 pt-2 md:hidden">
          {header.links.map((link) => (
            <Link key={link.href} href={localizeHref(link.href, locale)} className="block py-2 text-sm font-medium text-gray-600" onClick={() => setMobileMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link href={localizeHref(header.cta.href, locale)} className="mt-2 block w-full text-center btn-accent text-sm" onClick={() => setMobileMenuOpen(false)}>
            {header.cta.label}
          </Link>
          <div className="mt-2 border-t pt-2">
            <LanguageSwitcher currentLocale={locale} />
          </div>
        </div>
      )}
    </header>
  );
}
