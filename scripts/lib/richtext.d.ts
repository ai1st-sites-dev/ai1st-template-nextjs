// #1498 —— `richtext.js` 的类型（槽 kind `richtext` 的解析器）。
export type RichInline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: RichInline[] }
  | { t: 'a'; href: string; c: RichInline[] };
export type RichBlock =
  | { t: 'p'; c: RichInline[] }
  | { t: 'ul' | 'ol'; items: RichInline[][] };
export function parseRichtext(src: unknown): RichBlock[];
export function richtextToHtml(src: unknown): string;
export function richtextProblems(src: unknown): Array<{ kind: 'html' | 'href'; sample: string }>;
export const SAFE_HREF: RegExp;
