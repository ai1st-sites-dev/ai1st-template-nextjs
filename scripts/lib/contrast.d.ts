// #1463 —— `contrast.js` 的类型。
export const DARK_BELOW: number;
export const BRAND: 'brand';
export function isColorValue(v: unknown): boolean;
export function normalizeColor(v: unknown): string | null;
export function relativeLuminance(hex: unknown): number | null;
export function toneFor(bg: unknown): 'light' | 'dark' | 'brand';
