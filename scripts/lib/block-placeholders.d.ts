// #1660 —— `block-placeholders.js` 的类型（EditorApp 是 TypeScript）。
import type { EditorComponent } from './editor-schema';
import type { InlinePath } from './inline-edit';

export const WORDS: Record<string, Record<string, string>>;
export function placeholderWords(locale: string): Record<string, string>;
export function categoryOf(path: string, inItem: boolean): string;
export function placeholderFor(locale: string, path: string, n?: number, category?: string): string;
/** #1766 —— `site`：拖下 reviews 块时 Google 那一条用不用站里的真实评分（只认来自 Google 的）。 */
export function realGoogleRating(site: unknown, locale: string): { rating: number; count: number } | null;
export function seedProps(component: EditorComponent, locale: string, site?: unknown): Record<string, unknown>;
export function fillFields(component: EditorComponent, props: Record<string, unknown>): { name: string; text: string }[];
export function pathOfName(name: string): InlinePath;
