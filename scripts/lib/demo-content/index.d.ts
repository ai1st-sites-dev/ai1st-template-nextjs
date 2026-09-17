// #1383 —— `demo-content/index.js` 的类型。它是 CommonJS，而图册的两个页面（TypeScript）都要用它。
//
// 🔴 **为什么要有这个文件**：`demoDataFor` 在实现里是 `const out = {}` 一路填出来的，`tsc` 从那份
//    JS 推出来的返回值是 `{}` —— 一个**什么属性都没有**的类型。于是 `data.serviceSlug = …`（图册两个
//    页面都要做的那一手）当场 `Property 'serviceSlug' does not exist on type '{}'`，而失败方向是
//    **整个 `npm run build` 红**：`pageExtensions` 只管这两个页面进不进路由表，`tsc` 照样把它们
//    type check 一遍。做法照 `block-catalog.d.ts` 那一份：**类型写在这里一份**，实现那边的 JSDoc
//    就不再写结构。
import type { BlockManifest } from '../block-catalog';

/** 一个块的演示 `data` —— 键是 manifest 的槽位名。 */
export function demoDataFor(
  manifest: BlockManifest,
  opts?: { minimal?: boolean },
): Record<string, unknown>;

/** 内容包里那个块那一份（原样，不复制）。块不在包里就抛。 */
export function demoContentFor(type: string): Record<string, unknown>;

export const DEMO_CONTENT: Record<string, Record<string, unknown>>;
export const SITE: Record<string, unknown>;
export const IMAGES: Record<string, { url: string; fallback: string }>;
export function imageUrl(key: string): string;

/** 这个槽是不是一份列表（`kind === 'list'` 与 `shape` 以 `[` 开头的并集）。 */
export function isListSlot(spec: unknown): boolean;
/** 这个槽的 shape 自己写着要几项就回那个数，没写回 null。 */
export function declaredMinItems(spec: unknown): number | null;
/** 一个条目里给人读的那些字有多少个（地址、数字、布尔都不计）。 */
export function itemTextLength(item: unknown): number;
/** 这个字符串是不是一个地址（而不是给人读的文字）。 */
export function isAddress(s: string): boolean;
