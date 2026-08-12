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

// #960: onDark = 这个开关这一次被放在深色底上(顶栏的透明浮层那一支)。收起状态那行字是唯一压在
// 深底上的部分,展开的下拉是自己的白底卡片,不跟着变。
// 🔴 为什么要显式接一个参数、而不是让它从祖先继承颜色:继承是**看不见的耦合** —— 顶栏浮层那一支
// 是逐个元素换白字的(导航链接 / 公司名 / 汉堡各自带 class),这个组件不接线就永远是 text-gray-600。
// QA3 在 r2 上量到的就是这件事:多语言站装上 8 套透明浮层 theme,这行字 1.08:1,一个字都读不出来,
// 而单语言站它根本不渲染(locales.length <= 1 就 return null)⟹ 30 张单语言截图里它从来不在场。
export default function LanguageSwitcher({ currentLocale, onDark = false }: { currentLocale: string; onDark?: boolean }) {
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
    <details className="relative inline-block">
      <summary
        className={`cursor-pointer text-sm font-medium list-none ${
          onDark ? 'text-white/90 transition-colors hover:text-white' : 'text-gray-600'
        }`}
        data-region-ondark={onDark ? 'on' : 'off'}
      >
        {renderLocale(currentLocale)}
      </summary>
      {/* 下拉是自己的白底卡片,所以它的字**永远**是深色。这里写死 text-gray-800(= globals.css 给 body 的
          那一档,今天继承来的也是它 ⟹ 一个像素都不变),不再靠继承:上面那行字现在会变白,而继承是隐式的
          —— 哪天有人把白字放到某个祖先上,这张白底卡片上的字就跟着白了,而那正是本票在治的病。 */}
      <ul className="absolute right-0 top-full mt-2 bg-white text-gray-800 shadow rounded p-2 min-w-[140px] z-10">
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
                className="block px-2 py-1 text-sm hover:bg-gray-100 whitespace-nowrap"
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
