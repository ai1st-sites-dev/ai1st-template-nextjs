// brand-logo.js 的类型（#1784）。规矩在 .js 文件头。
export type LogoType = 'text' | 'image';
export type LogoSize = 's' | 'm' | 'l' | 'xl';
export interface BrandLogo { type: LogoType; size: LogoSize; chosen: LogoType }
export function resolveBrandLogo(options: { logoType?: unknown; logoSize?: unknown } | undefined | null, brand: { hasLogo?: boolean; hasWordmark?: boolean }): BrandLogo;
