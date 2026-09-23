// #1404 —— `editor-convert.js` 的类型（实现与说明都在那份 .js 里）。
import type { EditorComponent, EditorSchema } from './editor-schema';

export interface Located { at: number; writable: boolean; reason: string }
export interface PuckItemSrc {
  at: number;
  entry: Record<string, unknown> | null;
  locked: boolean;
  reason: string;
  view: Record<string, unknown>;
  weight: number | null;
  shape0: string;
  pid: string;
}
export interface PuckLikeData {
  root: { props: Record<string, unknown> };
  content: { type: string; props: Record<string, unknown>; readOnly?: Record<string, boolean> }[];
}
export function pageToPuck(args: {
  raw: Record<string, unknown>;
  blocks: unknown[];
  located: Located[];
  schema: EditorSchema;
  weights?: number[];
}): PuckLikeData;
export function puckToPage(args: {
  raw: Record<string, unknown>;
  data: { content?: { type: string; props: Record<string, unknown> }[] };
  initial: PuckLikeData;
  schema: EditorSchema;
  slug: string;
}): Record<string, unknown>;
export function fieldProps(component: EditorComponent, data: unknown): Record<string, unknown>;
export function dataFromProps(component: EditorComponent, base: unknown, props: Record<string, unknown>): Record<string, unknown>;
export function assignWeights(slots: { anchor: number | null }[]): number[];
export function deepEqual(a: unknown, b: unknown): boolean;
export const ITEM_ORIG: string;
