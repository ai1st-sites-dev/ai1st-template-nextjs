// region-options.js 的类型（#1738）。实现与规矩在 .js 文件头。
export type RegionName = 'header' | 'footer';
export type RegionOptions = Record<string, unknown>;
export const REGIONS: RegionName[];
export function regionOptionsProblems(region: string, v: unknown): string[];
export function cleanRegionOptions(region: string, v: unknown): RegionOptions;
export function readRegionOptions(themeMeta: unknown): Record<RegionName, RegionOptions>;
export function applyRegionOptions<T>(data: T, opts: RegionOptions | undefined | null): T;
export function effectiveRegionKnobs(region: string, shape: string, opts: RegionOptions | undefined): Record<string, unknown>;
export function regionPresetName(region: string, shape: string, opts: RegionOptions | undefined): string;
export function regionPresetPick(region: string, name: string, opts: RegionOptions | undefined): { shape: string; options: RegionOptions } | null;
export function regionKnobChange(region: string, shape: string, opts: RegionOptions | undefined, key: string, value: unknown): RegionOptions;
export function customizeKnobNames(region: string): string[];
