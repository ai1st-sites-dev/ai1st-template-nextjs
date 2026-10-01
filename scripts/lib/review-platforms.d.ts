// #1504 —— `review-platforms.js` 的类型（Section.tsx 从 TypeScript 引它）。
export interface PlatformIcon { icon: string; color: string }
export type PlatformLogo =
  | { kind: 'image'; logoUrl: string }
  | { kind: 'icon'; icon: string; color: string }
  | { kind: 'name' };
export const PLATFORM_ICONS: Record<string, PlatformIcon>;
export function platformIcon(source: unknown): PlatformIcon | null;
export function platformLogo(source: unknown, logoUrl: unknown): PlatformLogo;
