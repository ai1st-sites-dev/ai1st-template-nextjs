// #1660 —— `block-placeholders.js` 的类型（EditorApp 是 TypeScript）。
import type { EditorComponent } from './editor-schema';
import type { InlinePath } from './inline-edit';

export const WORDS: Record<string, Record<string, string>>;
export function placeholderWords(locale: string): Record<string, string>;
export function categoryOf(path: string, inItem: boolean): string;
export function placeholderFor(locale: string, path: string, n?: number): string;
export function seedProps(component: EditorComponent, locale: string): Record<string, unknown>;
export function fillFields(component: EditorComponent, props: Record<string, unknown>): { name: string; text: string }[];
export function pathOfName(name: string): InlinePath;
