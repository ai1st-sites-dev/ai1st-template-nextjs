// #1711 —— `slot-prompt.js` 的类型（EditorApp 是 TypeScript）。
export interface SlotPromptManifest { type?: string; displayName?: string; category?: string | null }
export function buildSlotPrompt(a: {
  manifest: SlotPromptManifest | null | undefined;
  slot: { secType?: string; slotName: string; kind: 'object' | 'list' | string; itemIdx?: number };
  industry?: string;
  primaryColor: string;
  themeWord: string;
}): string;
export function editorImagePrompt(a: {
  manifest: SlotPromptManifest | null | undefined;
  slotName: string;
  kind: 'object' | 'list';
  itemIdx?: number;
  industry?: string;
  primaryColor: string;
  headline?: string;
}): string;
export const EDITOR_THEME_WORD: string;
export function editorImageTarget(a: { props?: Record<string, unknown> | null; slot?: string | null; current?: string | null }):
  { slotName: string; kind: 'object' | 'list'; itemIdx?: number } | null;
