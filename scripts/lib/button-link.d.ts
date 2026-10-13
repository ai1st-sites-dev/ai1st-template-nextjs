// #1755 —— `button-link.js` 的类型（编辑器的按钮控件是 TypeScript）。
export type LinkType = 'page' | 'external' | 'email' | 'phone' | 'section';
export const LINK_TYPES: LinkType[];
export function linkTypeOf(href: unknown): { type: LinkType; business?: boolean; value: string };
export function hrefFor(type: LinkType, o?: { business?: boolean; value?: string; location?: number }): string | { source: string; location?: number };
export function externalUrl(text: string): string;
export function withButton<T extends Record<string, unknown>>(item: unknown, patch: Partial<T> & Record<string, unknown>): Record<string, unknown>;
