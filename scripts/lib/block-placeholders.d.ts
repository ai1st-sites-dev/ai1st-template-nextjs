// #1660 —— `block-placeholders.js` 的类型（EditorApp 是 TypeScript）。
import type { EditorComponent } from './editor-schema';
import type { InlinePath } from './inline-edit';

export const WORDS: Record<string, Record<string, string>>;
export function placeholderWords(locale: string): Record<string, string>;
export function categoryOf(path: string, inItem: boolean): string;
export function placeholderFor(locale: string, path: string, n?: number, category?: string, v?: unknown): string;
/** #1766 —— 站里存的真实评分当且仅当来自 Google 时回 `{ rating, count }`（编辑器拿它算 `SeedContext.rating`）。 */
export function realGoogleRating(site: unknown, locale: string): { rating: number; count: number } | null;
/** #1767 —— 拖下那一刻要用到的站点资料（EditorApp §seedContextFor 算）。 */
export interface SeedContext {
  phone?: boolean;
  email?: boolean;
  contactHref?: string;
  blogHref?: string;
  rating?: { rating: number; count: number } | null;
  facts?: Record<string, string>;
}
export function seedProps(component: EditorComponent, locale: string, ctx?: SeedContext): Record<string, unknown>;
export function fillFields(component: EditorComponent, props: Record<string, unknown>): { name: string; text: string }[];
export const FILL_BATCH_MAX: number;
export function fillBatches(fields: { name: string; text: string }[], max?: number): { name: string; text: string }[][];
export function isPlaceholder(text: unknown): boolean;
export const NUMBER_EXAMPLES: Record<string, readonly (string | number)[]>;
export const SEED_ICONS: readonly string[];
export function pathOfName(name: string): InlinePath;
