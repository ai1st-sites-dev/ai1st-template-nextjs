// #1343 —— `block-catalog.js` 的类型。它是 CommonJS，图册页（TypeScript）也要用它，而 `tsc` 从
// 那份 JSDoc 里只推出了半个返回值（实测：`Property 'manifests' does not exist on type
// '{ blocks: string[]; }'`）。类型写在这里一份，实现那边的 JSDoc 就不再写结构，免得两处各说一套。

export interface BlockShapePair {
  block: string;
  shape: string;
  /** 这个形态**需要**哪些可选槽位填上（manifest 的 `shapes[i].needs`）。 */
  needs: string[];
  /** 块级 `layout_intent` 与形态自己的覆盖合并之后的那一份；形态不在清单里时是 null。 */
  intent: Record<string, string> | null;
}

export interface BlockManifest {
  type: string;
  slots: Record<string, { kind: string; required: boolean; promptOptional: boolean; shape?: string }>;
  shapes: Array<{ name: string; needs: string[]; layout_intent?: Record<string, string> }>;
  layout_intent?: Record<string, string>;
  [key: string]: unknown;
}

export interface BlockShapeCatalog {
  /** 注册表里的块名，**注册表自己声明的顺序**。 */
  blocks: string[];
  /** (块, 形态) 全集。 */
  pairs: BlockShapePair[];
  /** type → manifest 原文。 */
  manifests: Map<string, BlockManifest>;
}

export function blockShapeCatalog(opts?: {
  registryPath?: string;
  blocksDir?: string;
}): BlockShapeCatalog;

export function sampleDataFor(
  manifest: BlockManifest,
  opts?: { minimal?: boolean },
): Record<string, unknown>;

export const REGISTRY_TS: string;
export const PLACEHOLDER_IMAGE: string;
