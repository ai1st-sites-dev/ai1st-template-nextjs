// #1404 —— `editor-schema.js` 产物的结构（编辑器页是 TypeScript，客户端那一半照它拼 Puck config）。
export interface EditorField {
  slot: string;
  kind: string;
  label: string;
  /** text = 一个输入框 · object = 子字段对象 · list = 对象数组 · strings = 字符串数组
   *  · color = 色板 + 取色器（#1463）· options = 预设 + 旋钮 + 布尔修饰（#1463） */
  control: 'text' | 'richtext' | 'object' | 'list' | 'strings' | 'color' | 'options' | 'int';
  /** #1497 —— `control: 'int'` 的取值（字符串形式的整数，从 manifest `intRange` 现算）。 */
  values?: string[];
  /** `choices` 有值的子字段是下拉（#1463，`eyebrow.style`） */
  /** `sources` 有值的子字段是链接格：手填地址，或选一个联系方式引用（#1506，`kind: link` 的 `href`；#1521 起按钮列表每一项的 `href` 也是） */
  subs: { sub: string; label: string; choices?: string[]; sources?: string[] }[];
  /** list：每项摘要取哪几个键（缺省 = subs）（#1463 `band` 用 alt） */
  summary?: string[];
  /** color：预设色板（`#rrggbb` / `brand`） */
  swatches?: string[];
  /** color：三档预设渐变（#1477，`contrast.js` §GRADIENT_SWATCHES 的副本） */
  gradients?: { stops: string[]; angle: number }[];
  /** options：旋钮（顺序 = 控件顺序）、布尔修饰、预设 */
  knobs?: { name: string; values: string[] }[];
  booleans?: string[];
  presets?: { name: string; shape: string; knobs: Record<string, string>; colors?: Record<string, unknown>; parts?: string[] }[];
  /** #1483 —— 归预设管的颜色槽（有预设在 `colors` 里写了的那几个）；没有带颜色预设的块是 []。 */
  colorSlots?: string[];
  /** #1487 —— 归预设管的部件的占位内容（槽的 `demo`）；没有带部件预设的块是 {}。 */
  partDemos?: Record<string, unknown>;
}
export interface EditorComponent {
  type: string;
  label: string;
  fields: EditorField[];
  carried: string[];
  shapes: { name: string; needs: string[] }[];
  defaultShape: string | null;
  /** #1443：主题选择单给这种块的形态（没按 data 判过）；没给 = null */
  themeShape: string | null;
  /** #1443：manifest 默认形态（落回时的落点） */
  fallbackShape: string | null;
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
/** #1518 —— 列表槽项形状 `[{…}]` 的顶层必填键名（嵌套 / 带 `?` 的不算；不是一个 `[{…}]` ⟹ []）。 */
export function itemTopKeys(shape: unknown): string[];
export const LINK_HREF: string;
