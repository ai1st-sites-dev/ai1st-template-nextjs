// #1504 —— `review-platforms.js` 的类型（Section.tsx 从 TypeScript 引它）。
export interface Platform { name: string; logo: string; names: string[] }
export type PlatformLogo =
  | { kind: 'image'; logoUrl: string }
  | { kind: 'platform'; logoUrl: string }
  | { kind: 'name' };
export const PLATFORMS: Record<string, Platform>;
export function platformKey(source: unknown): string | null;
export function platformOf(source: unknown): { key: string; name: string; logo: string } | null;
export function platformLogo(source: unknown, logoUrl: unknown): PlatformLogo;
