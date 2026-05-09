'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { defaultLocale, locales } from '@/lib/config';

export default function LanguageSwitcher({ currentLocale }: { currentLocale: string }) {
  const pathname = usePathname();
  // Single-locale sites (~30 in production) must render nothing — backward compat P0.
  if (locales.length <= 1) return null;

  // TICKET-129: pathname may be /about (defaultLocale alias, no prefix) or
  // /<locale>/about (other locale). Strip locale prefix only if currentLocale is
  // present in the path; otherwise the path is already the slug-only form.
  const localePrefix = `/${currentLocale}`;
  const pathSansLocale = pathname === localePrefix
    ? '/'
    : pathname.startsWith(`${localePrefix}/`)
      ? pathname.slice(localePrefix.length)
      : pathname || '/';

  return (
    <details className="relative">
      <summary className="cursor-pointer text-sm font-medium text-gray-600 uppercase list-none">
        {currentLocale}
      </summary>
      <ul className="absolute right-0 top-full mt-2 bg-white shadow rounded p-2 min-w-[80px] z-10">
        {locales.filter((l) => l !== currentLocale).map((l) => {
          // TICKET-129: switching to defaultLocale uses root URL (no prefix);
          // other locales keep /<locale>/* prefix.
          const isDefault = l === defaultLocale;
          const href = isDefault
            ? (pathSansLocale === '/' ? '/' : pathSansLocale)
            : (pathSansLocale === '/' ? `/${l}` : `/${l}${pathSansLocale}`);
          return (
            <li key={l}>
              <Link
                href={href}
                className="block px-2 py-1 text-sm uppercase hover:bg-gray-100"
              >
                {l}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
