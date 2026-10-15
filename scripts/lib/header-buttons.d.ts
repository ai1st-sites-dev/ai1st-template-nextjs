// #1787 —— `header-buttons.js` 的类型（实现与说明都在那份 .js 里）。
export type HeaderButtonHref = string | { source: 'phone' | 'email'; location?: number };
export type HeaderButtonValue = { label: string; href: HeaderButtonHref };
export declare const MAX_HEADER_BUTTONS: number;
export declare const STYLE_AT: readonly ('solid' | 'outline' | 'link')[];
export declare function hrefEmpty(href: unknown): boolean;
export declare function headerButtonsData(list: unknown, loc?: (href: string) => string): { label: string; href: HeaderButtonHref; style: 'solid' | 'outline' | 'link'; at: number }[];
export declare function headerButtonsProblem(list: unknown): string;
