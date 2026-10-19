// #1802 —— Next 外的整页渲染：站点数据进、整套静态网页出。esbuild 把这份入口（连同块 / SiteShell / React 服务端渲染）打成一份
// CommonJS（`scripts/lib/render-bundle.js`），`scripts/site.js render` 每次冷启动只 require 这一个文件。
//
// 这一层只管「画」：站点数据（`SiteData`）由 `site.js` 用 T2a-1 的 `deriveSite` 算好、覆盖完 siteId / leadApi / 地址 / GSC 再递进来；
// 文件写盘、样式表、平台文件都在 `site.js`。
import { pageMeta } from './meta';
import { renderDocument, type PlatformHrefs } from './document';
import { pageRoutes, routeBody, routeFile, routeMetadata, type Route } from './routes';
import { rootTextFiles } from './seo-files';
import { renderWithIslands } from '@/islands/render';
import { rootMetadata } from '@/lib/metadata';
import type { SiteData } from '@/lib/types/config';
import { renderToStaticMarkup } from 'react-dom/server';
import SiteRender from '@/components/SiteRender';
import CatalogCell from '@/components/catalog/CatalogCell';
import { catalogCellModel, queryOf, type CatalogManifest } from '@/lib/catalog/cell';
import type { IconTable } from '@/components/InlineIcon';

export interface RenderOptions {
  target: 'live' | 'preview';
  version: number | string;
  platform: PlatformHrefs;
  siteCssHref: string;
}

export interface RenderedPage { route: Route; file: string; html: string; islands: string[] }

export function renderRoute(site: SiteData, route: Route, opts: RenderOptions): RenderedPage {
  const { page, childSegment, extraRobots } = routeMetadata(site, route);
  const metaTags = pageMeta(rootMetadata(site), page, { childSegment, extraRobots });
  // #1833 r2 —— 这就是老板的网站：只有在 SiteRender 里面，Custom HTML 块才原样写老板的代码（`lib/editor-canvas.ts` §SiteRenderContext）。
  const { html: bodyHtml, islands, preloads } = renderWithIslands(<SiteRender>{routeBody(site, route)}</SiteRender>);
  const html = renderDocument({
    site, metaTags, bodyHtml, version: opts.version, platform: opts.platform, siteCssHref: opts.siteCssHref, headPreloads: preloads,
    refreshTo: route.kind === 'redirect' ? route.target : null,
  });
  return { route, file: routeFile(route), html, islands: islands.map((i) => i.name) };
}

/** 整个站：每一页 + 站根那几份文本。返回 `{ 相对路径: 内容 }`，次序固定。 */
export function renderSite(site: SiteData, opts: RenderOptions): { files: Record<string, string>; pages: RenderedPage[] } {
  const pages = pageRoutes(site).map((r) => renderRoute(site, r, opts));
  const files: Record<string, string> = {};
  for (const p of pages) files[p.file] = p.html;
  Object.assign(files, rootTextFiles(site, opts.target));
  return { files, pages };
}

/**
 * #1828 —— 块图册的一格，画成一段 HTML（`site.js render-catalog` 发版检查用：每个形态画一次，画不出来就是红）。
 * 跟 dashboard 的 `/admin/catalog/<块>/<形态>` 是同一份数据（`src/lib/catalog/cell.ts`）、同一个组件（`CatalogCell`）。
 * (块, 形态) 不在 manifest 的清单里 ⟹ null。块组件抛错原样往外抛（调用方据此判红）。
 */
export function renderCatalogCell({ manifest, block, shape, search = '', themeId = '', iconTable }: {
  manifest: CatalogManifest | undefined; block: string; shape: string; search?: string; themeId?: string;
  iconTable: (block: string, data: unknown) => IconTable;
}): string | null {
  const model = catalogCellModel({ manifest, block, shape, query: queryOf(search) });
  if (!model) return null;
  // #1833 r2 —— 演示数据是仓里写的，而服务端没有 window、Custom HTML 的净化那一支跑不了 ⟹ 按站画（跟 Next 的图册页同一个处置）。
  return renderToStaticMarkup(<SiteRender><CatalogCell model={model} themeId={themeId} iconTable={iconTable} /></SiteRender>);
}

export { pageRoutes, routeFile, pageMeta, renderDocument };
