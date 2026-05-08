'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { locales } from '@/lib/config';

export default function LanguageSwitcher({ currentLocale }: { currentLocale: string }) {
  const pathname = usePathname();
  // Single-locale sites (~30 in production) must render nothing — backward compat P0.
  if (locales.length <= 1) return null;

  const pathSansLocale = pathname.replace(new RegExp(`^/${currentLocale}`), '') || '/';

  return (
    <details className="relative">
      <summary className="cursor-pointer text-sm font-medium text-gray-600 uppercase list-none">
        {currentLocale}
      </summary>
      <ul className="absolute right-0 top-full mt-2 bg-white shadow rounded p-2 min-w-[80px] z-10">
        {locales.filter((l) => l !== currentLocale).map((l) => (
          <li key={l}>
            <Link
              href={`/${l}${pathSansLocale === '/' ? '' : pathSansLocale}`}
              className="block px-2 py-1 text-sm uppercase hover:bg-gray-100"
            >
              {l}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
