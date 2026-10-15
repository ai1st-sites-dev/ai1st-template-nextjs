// region-options.js 的类型（#1738）。实现与规矩在 .js 文件头。
export type RegionName = 'header' | 'footer';
export type RegionOptions = Record<string, unknown>;
export const REGIONS: RegionName[];
export function regionOptionsProblems(region: string, v: unknown): string[];
export function cleanRegionOptions(region: string, v: unknown, shape?: string): RegionOptions;
export function readRegionOptions(themeMeta: unknown, shapes?: Partial<Record<RegionName, string>>): Record<RegionName, RegionOptions>;
export function applyRegionOptions<T>(data: T, opts: RegionOptions | undefined | null): T;
export function effectiveRegionKnobs(region: string, shape: string, opts: RegionOptions | undefined): Record<string, unknown>;
export function regionPresetName(region: string, shape: string, opts: RegionOptions | undefined): string;
export function regionPresetPick(region: string, name: string, opts: RegionOptions | undefined): { shape: string; options: RegionOptions } | null;
export function regionKnobChange(region: string, shape: string, opts: RegionOptions | undefined, key: string, value: unknown): RegionOptions;
export function customizeKnobNames(region: string): string[];
/** #1784 —— 不归预设管的旋钮名（没有任何预设写到的）。 */
export function regionFreeKnobNames(region: string): string[];
/** #1784 —— Customize 页的控件分组（旋钮名 / `bool:<开关>`），按 manifest 的 `toolbarGroups`。 */
export function customizeGroups(region: string): string[][];
/** #1784 —— 旋钮 / 开关在面板和存盘记录里的名字（manifest 的 `label`，没写 = 名字首字母大写）。 */
export function regionKnobLabel(region: string, key: string): string;
