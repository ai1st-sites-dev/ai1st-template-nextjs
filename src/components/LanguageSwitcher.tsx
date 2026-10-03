'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { defaultLocale, locales } from '@/lib/config';

// TICKET-134 v2: native language name + globe icon. Following Vercel / Stripe /
// Notion convention — flag emojis are an i18n anti-pattern (W3C: en ≠ Canada,
// es ≠ Spain, etc). Globe icon is region-neutral and renders consistently
// across platforms (including Windows, where flag emojis degrade to ISO text).
// TICKET-169: 'zh' (Simplified) and 'zh-tw' (Traditional) render with explicit
// native names — old "中文" was ambiguous between the two character sets.
const LANG_META: Record<string, string> = {
  en: 'English',   zh: '简体中文', 'zh-tw': '繁體中文', fr: 'Français',  es: 'Español',
  ja: '日本語',    ko: '한국어',    de: 'Deutsch',   it: 'Italiano',
  pt: 'Português', ru: 'Русский',  vi: 'Tiếng Việt',
  ar: 'العربية',   hi: 'हिन्दी',     th: 'ไทย',
};

function renderLocale(locale: string): string {
  const name = LANG_META[locale];
  if (!name) return locale.toUpperCase();   // fallback for unknown locale
  return `🌐 ${name}`;
}

// #960 原来在这里接一个 `onDark`（顶栏透明浮层那一支压在深底上时换白字）。#1425（T3）起新库的 header 没有透明浮层，
// 开关也不在顶栏里了，改由 `SiteShell` 在顶栏上方挂一条（多语言站才挂）⟹ 那个参数没有调用方，删了。
// 🔴 字色改用 Bootstrap 跟着深浅走的那两档（`text-body-secondary` / `bg-body` · `text-body`），不再写死 Tailwind 的灰：
//    #1523 起老板能把站切成深色，写死的 `text-gray-600` 压在深底上读不出来 —— 跟 #960 r2 那次 1.08:1 是同一个病。
//    下拉仍是自己的卡片，字跟卡片底同一套（都随深浅换），不靠从祖先继承。
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
    <details className="position-relative d-inline-block">
      <summary className="cursor-pointer text-sm fw-medium list-unstyled text-body-secondary">
        {renderLocale(currentLocale)}
      </summary>
      <ul className="position-absolute end-0 top-100 mt-2 bg-body text-body shadow rounded p-2 list-unstyled mb-0" style={{ minWidth: 140, zIndex: 10 }}>
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
                className="d-block px-2 py-1 text-sm link-body-emphasis text-decoration-none text-nowrap"
              >
                {renderLocale(l)}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
