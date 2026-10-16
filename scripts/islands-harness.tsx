// #1798 —— 岛的浏览器测试（`islands.test.js`）用的服务端入口：把几块真实的块（`SectionRenderer`，跟真站同一条路）
// 画成「静态整页 + 岛」。由 `scripts/lib/islands-build.js` §buildServer 打成 CommonJS 给 node require。
// 只给测试用；接进发布那条整页渲染（renderPage）归 T2a-2 / 本票后合的那张。
import SectionRenderer from '@/components/SectionRenderer';
import SiteShell from '@/components/SiteShell';
import { renderWithIslands } from '@/islands/render';
import { itemSourceContext, resolveItemSources } from '@/lib/sections/item-sources';
import type { BlockConfig, SiteData } from '@/lib/types/config';
import { iconTablesFor } from './lib/icons.js';

export function renderBlocks(site: SiteData, locale: string, blocks: BlockConfig[]) {
  const resolved = resolveItemSources(blocks, itemSourceContext(site, locale));
  return renderWithIslands(
    <main>
      <SectionRenderer site={site} blocks={resolved} locale={locale} iconTables={iconTablesFor(resolved)} />
    </main>,
  );
}

/** 整站外壳（顶栏 + 页脚，跟真站同一个 `SiteShell`），中间那格是空的 `<main>`。 */
export function renderShell(site: SiteData, locale: string) {
  return renderWithIslands(<SiteShell site={site} locale={locale} page="home"><p>shell</p></SiteShell>);
}

export { islandJson } from '@/islands/json';
export { ISLANDS } from '@/islands/registry';
