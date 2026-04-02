'use client';

import Link from 'next/link';
import { useState } from 'react';
import ServiceIcon from '@/components/ServiceIcon';
import { brand, navigation } from '@/lib/config';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { header } = navigation;

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <nav className="container-width flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label={`${brand.name} - Home`}>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500">
            <ServiceIcon icon={brand.logoIcon} className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold text-primary-900">{brand.name}</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-8 md:flex">
          {header.links.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-gray-600 transition-colors hover:text-primary-500">
              {link.label}
            </Link>
          ))}
          <Link href={header.cta.href} className="btn-accent text-sm">{header.cta.label}</Link>
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
            <Link key={link.href} href={link.href} className="block py-2 text-sm font-medium text-gray-600" onClick={() => setMobileMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
          <Link href={header.cta.href} className="mt-2 block w-full text-center btn-accent text-sm" onClick={() => setMobileMenuOpen(false)}>
            {header.cta.label}
          </Link>
        </div>
      )}
    </header>
  );
}
