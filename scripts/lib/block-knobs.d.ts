// #1463 —— `block-knobs.js` 的类型（编辑器 / hero-new 的 Section 是 TypeScript）。
export interface Knob { name: string; values: string[]; maxItems?: Record<string, Record<string, number>> }
export interface Preset { name: string; shape: string; knobs: Record<string, string>; options?: Record<string, boolean>; colors?: Record<string, unknown>; parts?: string[] }
type ManifestLike = { slots?: Record<string, unknown>; presets?: unknown; parts?: unknown } | null | undefined;
export function knobsOf(manifest: ManifestLike): Knob[];
export function presetsOf(manifest: ManifestLike): Preset[];
export function booleanOptionsOf(manifest: ManifestLike): string[];
export function presetBooleansOf(manifest: ManifestLike): string[];
export function effectiveKnobs(manifest: ManifestLike, shape: string | undefined, options: unknown): Record<string, string>;
export function effectivePresetBooleans(manifest: ManifestLike, shape: string | undefined, options: unknown): Record<string, boolean>;
export function presetFor(manifest: ManifestLike, values: Record<string, unknown>): Preset | null;
export function presetNameFor(manifest: ManifestLike, values: Record<string, unknown>): string;
export function knobDeclarationProblems(manifest: ManifestLike): string[];
export function colorSlotsOf(manifest: ManifestLike): string[];
export function presetColorSlotsOf(manifest: ManifestLike): string[];
/** #1483 —— 点了这个预设之后归预设管的颜色槽各该是什么；null = 恢复成空（删键）。块里没有带颜色的预设 ⟹ {}。 */
export function presetColors(manifest: ManifestLike, name: string): Record<string, import('./contrast.js').BgValue | null>;
/** #1483 —— Puck 侧栏里点预设之后这一块的 props（options 换成预设的旋钮 + 归预设管的颜色槽设上 / 删掉）。 */
export function presetClickProps<T extends Record<string, unknown>>(field: { presets?: Preset[]; colorSlots?: string[]; partDemos?: Record<string, unknown> }, props: T, name: string): T;
/** #1487 —— 部件有没有内容（字符串非空 / 数组非空 / 对象里有一个非空的顶层字符串）。 */
export function partFilled(v: unknown): boolean;
/** #1487 —— 有预设在 `parts` 里写了的部件（顺序 = 顶层 `parts`）。 */
export function presetPartsOf(manifest: ManifestLike): string[];
/** #1487 —— 归预设管的部件的占位内容（槽的 `demo`）。 */
export function presetPartDemosOf(manifest: ManifestLike): Record<string, unknown>;
/** #1487 —— 点这个预设时、部件为空要填的内容（只含它写了的部件）。 */
export function presetPartFills(manifest: ManifestLike, name: string): Record<string, unknown>;
