// #1759 —— `editor-nav.js` 的类型（实现与说明都在那份 .js 里）。编辑器页（page.tsx，服务端）只用 §navMenuOf。
export type NavMenu = { home: { navLabel: string; title: string } | null; pages: { slug: string; title: string; navLabel: string; navOrder?: number }[] };
export declare const NAV_LABEL_MAX: number;
export declare function navMenuOf(localePages: unknown[]): NavMenu;
