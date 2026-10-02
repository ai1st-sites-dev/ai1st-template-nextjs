// #1472 —— `color-scheme.js` 的类型。
export type ColorScheme = 'light' | 'dark' | 'auto';
export const COLOR_SCHEMES: ColorScheme[];
export const DEFAULT_COLOR_SCHEME: 'light';
export function isColorScheme(v: unknown): v is ColorScheme;
export function colorSchemeFromMeta(v: unknown): ColorScheme;
export function normalizeColorScheme(v: unknown): ColorScheme;
export const AUTO_SCHEME_SCRIPT: string;
