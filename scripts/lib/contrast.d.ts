// #1463 —— `contrast.js` 的类型。
export const DARK_BELOW: number;
export const BRAND: 'brand';
export function isColorValue(v: unknown): boolean;
export function normalizeColor(v: unknown): string | null;
export function relativeLuminance(hex: unknown): number | null;
export function toneFor(bg: unknown): 'light' | 'dark' | 'brand';
/** #1469 —— 渐变底。 */
export interface GradientBg { stops: string[]; angle: number }
export type BgValue = string | GradientBg;
export const GRADIENT_DARK_BELOW: number;
export const GRADIENT_ANGLE: number;
export const GRADIENT_SWATCHES: GradientBg[];
export function normalizeGradient(v: unknown): GradientBg | null;
export function normalizeBg(v: unknown): BgValue | null;
export function toneForBg(bg: unknown): 'light' | 'dark' | 'brand';
export function bgCss(bg: unknown): string | null;
export function bgFromParam(s: unknown): BgValue | null;
