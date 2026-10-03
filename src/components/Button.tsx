// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Button —— 块里的 CTA 按钮，全站一个组件（#1533 T6c-1，总纲 #1422；契约见图册 `components` 组的 button 格）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **「style → 类名」只有这一份（§buttonClass）。** 在这之前 10 个块各写一份 `btnClass`。
//    每个按钮自己带 style（solid / outline / link）· size（sm / md / lg）· icon · arrow；
//    **默认值归块**（缺 style 时用哪种、缺 size 时多大）—— 块把自己的默认传进来，这里不替它定。
// 🔴 深底 / 主色底上按钮怎么反白，不在这里：`scripts/lib/site-css.js` §DEEP_COMMON 按块点名（哪些块今天有、
//    各是哪一种），因为它要管到块里**不走这个组件**的按钮（`BlockLeadForm` 的提交键、pricing 的月 / 年切换），
//    今天各块的规则就是这么管的。
// 🔴 类名要**逐字**写在这里：`site.css` 按源码 purge（`site-css.js` §PURGE_CONTENT），拼出来的看不见。
//
// 图标 / 箭头 / 文字由块自己放进 children：各块今天用的图标件不同（`Icon` 与按站图标表的 `InlineIcon`），
// 统一它会改 DOM，不在本票（「对老板和建站 AI 没有区别」—— 生成的 HTML 结构不变）。

import Link from 'next/link';
import type { ReactNode } from 'react';

export type ButtonStyle = 'solid' | 'outline' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const STYLES: readonly string[] = ['solid', 'outline', 'link'];

export interface ButtonClassOptions {
  size?: ButtonSize;
  /** link 样式去掉左右内边距（`px-0`），跟正文左边对齐。hero / cta 的 link 不去。 */
  flush?: boolean;
  /** 只要 `btn` + 样式 + 尺寸，不带 inline-flex 那一组排版类（footer）。 */
  bare?: boolean;
  /** 深色面上用 Bootstrap 的浅色那一档：outline → `btn-outline-light`，link 加 `link-light`（footer）。 */
  onDark?: boolean;
  /** 实心按钮用 `btn-light`（footer 的深色盒子 / 主色底）。 */
  solidLight?: boolean;
}

/** 实际画哪种：`style` 没写用块的默认 `fallback`；写了但不认识，也落回 `fallback`。 */
export const resolveButtonStyle = (style: unknown, fallback: ButtonStyle): ButtonStyle =>
  (typeof style === 'string' && STYLES.includes(style) ? style : fallback) as ButtonStyle;

/** 实际多大：同上，没写 / 不认识 ⟹ 块的默认。 */
export const resolveButtonSize = (size: unknown, fallback: ButtonSize): ButtonSize =>
  (size === 'sm' || size === 'md' || size === 'lg' ? size : fallback);

export function buttonClass(style: ButtonStyle, o: ButtonClassOptions = {}): string {
  const size = o.size === 'sm' ? ' btn-sm' : o.size === 'lg' ? ' btn-lg' : '';
  if (o.bare) {
    if (style === 'link') return `btn btn-link${size}${o.onDark ? ' link-light' : ''}`;
    if (style === 'outline') return `btn${size} ${o.onDark ? 'btn-outline-light' : 'btn-outline-primary'}`;
    return `btn${size} ${o.solidLight ? 'btn-light' : 'btn-primary'}`;
  }
  if (style === 'link') {
    return o.flush
      ? `btn btn-link px-0 d-inline-flex align-items-center text-nowrap${size}`
      : `btn btn-link d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  }
  if (style === 'outline') return `btn btn-outline-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  return `btn btn-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
}

interface ButtonProps {
  href: string;
  /** 数据里写的 style（原样，可能没写）。 */
  style?: string;
  /** 这个块缺 style 时用哪种。 */
  fallback: ButtonStyle;
  /** 数据里写的 size（原样，可能没写）。 */
  size?: string;
  /** 这个块缺 size 时多大（hero / cta lg · faq / blog / team sm · 其余 md）。 */
  defaultSize: ButtonSize;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/** `<Link>` 一枚。`data-cta` 照旧写数据里的 style（没写就是块的默认）。 */
export default function Button({ href, style, fallback, size, defaultSize, flush, className, children }: ButtonProps) {
  const cls = buttonClass(resolveButtonStyle(style, fallback), { size: resolveButtonSize(size, defaultSize), flush });
  return (
    <Link href={href} className={className ? `${cls} ${className}` : cls} data-cta={style || fallback}>
      {children}
    </Link>
  );
}
