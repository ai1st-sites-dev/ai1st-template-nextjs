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
/** #1405 —— root 字段（外壳四样）的可选值。 */
export interface EditorLayout {
  id: string;
  regions: string[];
  repeatVariants: Record<string, string>;
  /** 布局自己钉了页脚形态（`repeatVariants` 里有 footer 类的区）⟹ 页脚下拉灰掉、存盘不写它 */
  pinsFooter: boolean;
}
export interface EditorRootSchema {
  /** 分派表里的字段（`editor-root-fields.js`），顺序照表 */
  fields: { field: string; scope: 'site' | 'locale' }[];
  layouts: EditorLayout[];
  header: string[];
  footer: string[];
}
export interface EditorSchema {
  components: EditorComponent[];
  root: EditorRootSchema;
}
export function editorSchema(opts?: { rootDir?: string; registryPath?: string; blocksDir?: string; layoutsDir?: string }): EditorSchema;
export function fieldsOf(manifest: unknown): EditorField[];
export function slotCoverageProblems(schema: EditorSchema, manifests: Map<string, unknown>): string[];
export const LINK_HREF: string;
