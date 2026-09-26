// #1448 —— `editor-pages.js` 的类型（实现与说明都在那份 .js 里）。
export declare const RESERVED_SLUGS: string[];
export declare function isReservedSlug(slug: string): boolean;
export type EditorPageGroup = { locale: string; pages: { slug: string; label: string }[] };
export declare function editorPages(
  locales: string[],
  pagesByLocale: Record<string, { slug: string; title?: string; navLabel?: string }[]>,
): EditorPageGroup[];
