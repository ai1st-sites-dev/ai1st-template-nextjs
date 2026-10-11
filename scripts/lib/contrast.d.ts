// #1463 —— `contrast.js` 的类型。
export const DARK_BELOW: number;
export const BRAND: 'brand';
/** #1698 —— 跟主题走的底：名字 → 渲染成什么 CSS + 上面用哪套字色。 */
export type ThemeBgName = 'brand-soft' | 'accent-soft' | 'soft-gradient' | 'deep-gradient';
export const THEME_BGS: Record<ThemeBgName, { css: string; tone: 'light' | 'dark' }>;
export function isThemeBg(v: unknown): v is ThemeBgName;
export function isColorValue(v: unknown): boolean;
export function normalizeColor(v: unknown): string | null;
export function relativeLuminance(hex: unknown): number | null;
export function toneFor(bg: unknown): 'light' | 'dark' | 'brand';
/** #1469 —— 渐变底。 */
export interface GradientBg { stops: string[]; angle: number }
export type BgValue = string | GradientBg;
export const GRADIENT_DARK_BELOW: number;
export const GRADIENT_ANGLE: number;
/** #1698 —— 编辑器的预设渐变：跟主题走的名字（`soft-gradient` / `deep-gradient`）+ 写死的中性渐变。 */
export const GRADIENT_SWATCHES: BgValue[];
export function normalizeGradient(v: unknown): GradientBg | null;
export function normalizeBg(v: unknown): BgValue | null;
export function toneForBg(bg: unknown): 'light' | 'dark' | 'brand';
export function bgCss(bg: unknown): string | null;
export function bgFromParam(s: unknown): BgValue | null;
/** #1472 —— 块根上的 `data-bs-theme`：填了 `bg` / 图铺底 ⟹ 'light'，没填 ⟹ undefined（跟站走）。 */
export function bsThemeForBg(bg: unknown, cover?: boolean): 'light' | undefined;
