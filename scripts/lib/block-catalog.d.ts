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
  /**
   * #1384 —— 这个形态还没被 Chris 点头（manifest 的 `shapes[i].candidate`）。manifest 里没写就是
   * `false`，所以消费者判的是布尔，不是「有没有这个键」。
   *
   * 🔴 **交接给 #1350**：点选检查器那个形态下拉要**过滤掉 `candidate === true` 的项** —— 候选进图册
   *    是为了给 Chris 看，不是给站主挑。本票只把这个读数摆出来，不碰检查器（#1411 起检查器退役，Puck 的形态下拉在 editor-schema 里滤掉候选）。
   */
  candidate: boolean;
}

export interface BlockManifest {
  type: string;
  slots: Record<string, { kind: string; required: boolean; promptOptional: boolean; shape?: string }>;
  shapes: Array<{
    name: string; needs: string[]; layout_intent?: Record<string, string>;
    /** #1384 —— 过了机器检查、等 Chris 点头的形态。缺省 = 不是候选。 */
    candidate?: boolean;
  }>;
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
