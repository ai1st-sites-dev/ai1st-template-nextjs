// #1404 —— `editor-convert.js` 的类型（实现与说明都在那份 .js 里）。
import type { EditorComponent, EditorSchema } from './editor-schema';

export interface Located { at: number; writable: boolean; reason: string }
export interface PuckItemSrc {
  at: number;
  entry: Record<string, unknown> | null;
  locked: boolean;
  /** #1406：站级共用块的 id；不是共用块时为 null */
  shared: string | null;
  /** #1406：共用块打开时块库里那一份 data */
  sharedData: Record<string, unknown> | null;
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
  /** #1406：这种语言的站级块库（文件里那一份）—— 共用块的字段从它取 */
  siteBlocks?: Record<string, unknown>;
}): PuckLikeData;
export function puckToPage(args: {
  raw: Record<string, unknown>;
  data: { content?: { type: string; props: Record<string, unknown> }[] };
  initial: PuckLikeData;
  schema: EditorSchema;
  slug: string;
  /** #1406：画布上被拖过的块（Puck id） */
  moved?: string[] | Set<string>;
}): Record<string, unknown>;
export function fieldProps(component: EditorComponent, data: unknown): Record<string, unknown>;
export function dataFromProps(component: EditorComponent, base: unknown, props: Record<string, unknown>): Record<string, unknown>;
export function assignWeights(slots: { anchor: number | null }[]): number[];
export function deepEqual(a: unknown, b: unknown): boolean;
export const ITEM_ORIG: string;
export const UNKNOWN_TYPE: string;
/** #1443 —— 形态下拉「跟着主题走」那一项的值：存盘时删掉 `shape` 键 */
export const THEME_DEFAULT: string;
/** #1443 —— 画布上这一块戴哪个形态（同构建 §shapeForBlock）；`data` 是这个块当前的内容 */
export function canvasShape(component: EditorComponent, pinned: unknown, data: unknown): string | undefined;
/** #1445 —— 这一块的形态下拉选项；`current` 不在清单里时多一项只显示它名字的 `(retired)` */
export function shapeOptions(component: EditorComponent, current: unknown): Array<{ value: string; label: string }>;
/** #1405 —— 外壳四样在站级文件里的现值 */
export interface RootValues {
  layout: string;
  headerShape: string;
  footerShape: string;
  topbarMessage: string;
  topbarLink: { label: string; href: string } | null;
}
export function rootToPuck(values: RootValues): Record<string, unknown>;
export function puckRootChanges(args: {
  initial: { root?: { props?: Record<string, unknown> } };
  now: { root?: { props?: Record<string, unknown> } };
  schema: EditorSchema;
}): Record<string, unknown>;
/** #1406 —— 站级共用块（说明在 editor-convert.js 那一段） */
export type SharedChanges = Record<string, { data?: Record<string, unknown>; was?: Record<string, unknown>; unlist?: true }>;
export function sharedReach(args: {
  siteBlocks: Record<string, unknown>;
  refs?: Record<string, string[]>;
  slugs?: string[];
  id: string;
}): { all: boolean; pages: number };
export function sharedRemovable(siteBlocks: Record<string, unknown>, id: string): boolean;
export function puckSharedChanges(args: {
  data: { content?: { type: string; props: Record<string, unknown> }[] };
  initial: PuckLikeData;
  siteBlocks: Record<string, unknown>;
  schema: EditorSchema;
  slug: string;
  own?: Record<string, Record<string, unknown>>;
}): SharedChanges;
export function sharedOwnAfter(args: {
  initial: PuckLikeData;
  own?: Record<string, Record<string, unknown>>;
  changes: SharedChanges;
}): Record<string, Record<string, unknown>>;
export function applySharedChanges(siteBlocks: Record<string, unknown>, changes: SharedChanges, slug: string): Record<string, unknown>;
/** #1410 —— AI 改完、新底稿到了：撤销历史怎么动（实现与说明在 .js）。 */
export function aiBaselineStep<H extends { state: { data: PuckLikeData } }>(args: {
  current: PuckLikeData;
  histories: H[];
  next: PuckLikeData;
  hash: string;
  nextHash: string;
}): { pageChanged: boolean; record: boolean; histories: H[]; current: PuckLikeData; sharedIds: string[]; mixed: boolean };
