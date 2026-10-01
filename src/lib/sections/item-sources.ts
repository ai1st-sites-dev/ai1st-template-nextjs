// #1505 —— 列表槽「引用写法」的带类型入口。实现和两张登记表（有哪些源 · 哪个块的哪个槽接）住在
// `scripts/lib/item-sources.js`（PM 2026-10-01 定的方案 A：`validateSite` 用纯 node 跑，读不了 .ts）。
//
// 🔴 所有调用点都调这里的 `resolveItemSources`：真站 HomePage / SubPage、编辑器画布（EditorApp §CanvasBlock，
//    普通块和共用块两支共用同一个展开结果）、单格页（`/__catalog`，传演示生意那一份 ctx）。不写第二份。
// 🔴 `itemSourceContext` 是唯一一处替展开函数去拿站点数据的地方（`getServices` / `pagesByLocale` / `localeUrl` /
//    「Learn more」）。`scripts/lib/page-deps.js` 的 ACCOUNTED 里登记了这个文件：它读服务目录这件事，按页面数据里
//    有没有 `{source: "services"}` 归属（§blocksUseSource），不是算给所有页面。

import type { BlockConfig, DynamicPageConfig, ServiceConfig } from '@/lib/types/config';
import { defaultLocale, getServices, localeUrl, pagesByLocale } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';
import * as impl from '../../../scripts/lib/item-sources.js';

export interface ItemSourceContext {
  services?: Pick<ServiceConfig, 'id' | 'name' | 'shortDescription' | 'icon'>[];
  pages?: Pick<DynamicPageConfig, 'slug' | 'title' | 'description'>[];
  /** slug → 站内链接（真站是 `localeUrl(slug, locale)`）。 */
  url: (slug: string) => string;
  /** 「Learn more」那几个字（真站取 `component-labels` 的 `learnMore`）。 */
  learnMore?: string;
}

export const SOURCES = impl.SOURCES;
export const BLOCK_SLOTS = impl.BLOCK_SLOTS as Record<string, Record<string, string[]>>;
export const SOURCED_KEY = impl.SOURCED_KEY as '_sourced';
export const isSourceRef = impl.isSourceRef as (v: unknown) => v is { source: string; [k: string]: unknown };
export const blocksUseSource = impl.blocksUseSource as (blocks: BlockConfig[] | undefined, source: string) => boolean;
export const describeRef = impl.describeRef as (ref: unknown) => string;

/** 把一页里写成引用的列表槽展开成条目（别的块原样返回）。 */
export function resolveItemSources(blocks: BlockConfig[], ctx: ItemSourceContext): BlockConfig[] {
  return impl.resolveItemSources(blocks, ctx) as BlockConfig[];
}

/** 这个站、这个语言的展开上下文。 */
export function itemSourceContext(locale: string): ItemSourceContext {
  return {
    services: getServices(locale) || [],
    pages: pagesByLocale[locale] ?? pagesByLocale[defaultLocale] ?? [],
    url: (slug: string) => localeUrl(slug, locale),
    learnMore: getLabels(locale).learnMore,
  };
}
