// #1657 —— `inline-edit.js` 的类型（EditorApp 的点击层是 TypeScript）。
import type { EditorInlineSlot } from './editor-schema';

export type InlinePath = (string | number)[];
export type InlineResolved =
  | { ok: true; path: InlinePath; name: string; value: string; typing: boolean; ai: boolean; image: boolean }
  | { ok: false; why: 'unknown' | 'sourced' | 'locked' | 'mismatch' | 'ambiguous'; slot?: string };

export function resolveInlineSlot(args: {
  component: { inline: EditorInlineSlot[] } | undefined;
  props: Record<string, unknown>;
  slot: string;
  /** 图片格（#1693）交 `<img>` 的 `src` */
  text: string;
  sourced?: string[];
  locked?: boolean;
}): InlineResolved;
export function setAt<T>(obj: T, path: InlinePath, value: unknown): T;
export function getAt(obj: unknown, path: InlinePath): unknown;
export function stripIndex(attr: string): string;
export function typedValue(text: string): string;
export function norm(v: unknown): string | null;
