// brand-logo.js 的类型（#1784）。规矩在 .js 文件头。
export type LogoType = 'text' | 'image';
/** #1784 r7 —— 图高 px（范围在顶栏 manifest 的 `slots.options.numbers`）。 */
export type LogoSize = number;
export interface BrandLogo { type: LogoType; size: LogoSize; chosen: LogoType }
export function resolveBrandLogo(options: { logoType?: unknown; logoSize?: unknown } | undefined | null, brand: { hasLogo?: boolean; hasWordmark?: boolean }): BrandLogo;
export const LOGO_SIZE: { name: string; min: number; max: number; step: number; default: number; label?: string };
