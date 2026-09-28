// #1463 —— `block-knobs.js` 的类型（编辑器 / hero-new 的 Section 是 TypeScript）。
export interface Knob { name: string; values: string[]; maxItems?: Record<string, Record<string, number>> }
export interface Preset { name: string; shape: string; knobs: Record<string, string>; options?: Record<string, boolean> }
type ManifestLike = { slots?: Record<string, unknown>; presets?: unknown } | null | undefined;
export function knobsOf(manifest: ManifestLike): Knob[];
export function presetsOf(manifest: ManifestLike): Preset[];
export function booleanOptionsOf(manifest: ManifestLike): string[];
export function presetBooleansOf(manifest: ManifestLike): string[];
export function effectiveKnobs(manifest: ManifestLike, shape: string | undefined, options: unknown): Record<string, string>;
export function effectivePresetBooleans(manifest: ManifestLike, shape: string | undefined, options: unknown): Record<string, boolean>;
export function presetFor(manifest: ManifestLike, values: Record<string, unknown>): Preset | null;
export function presetNameFor(manifest: ManifestLike, values: Record<string, unknown>): string;
export function knobDeclarationProblems(manifest: ManifestLike): string[];
