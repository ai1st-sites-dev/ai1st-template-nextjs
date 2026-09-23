// #1404 —— `editor-schema.js` 产物的结构（编辑器页是 TypeScript，客户端那一半照它拼 Puck config）。
export interface EditorField {
  slot: string;
  kind: string;
  label: string;
  /** text = 一个输入框 · object = 子字段对象 · list = 对象数组 · strings = 字符串数组 */
  control: 'text' | 'object' | 'list' | 'strings';
  subs: { sub: string; label: string }[];
}
export interface EditorComponent {
  type: string;
  label: string;
  fields: EditorField[];
  carried: string[];
  shapes: { name: string; needs: string[] }[];
  defaultShape: string | null;
}
export interface EditorSchema {
  components: EditorComponent[];
}
export function editorSchema(opts?: { rootDir?: string; registryPath?: string; blocksDir?: string }): EditorSchema;
export function fieldsOf(manifest: unknown): EditorField[];
export function slotCoverageProblems(schema: EditorSchema, manifests: Map<string, unknown>): string[];
export const LINK_HREF: string;
