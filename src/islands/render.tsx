// #1798 —— 静态整页 + 岛（只在服务端用）。整页 `renderToStaticMarkup`（没有 React 的注释和属性，最小），
// 每个岛单独 `renderToString`（🔴 React 文档：`renderToStaticMarkup` 的产物不能 `hydrateRoot`，岛必须走这一个）。
//
//   <div data-island="名字" style="display:contents"> …renderToString 出的那一段… </div>
//   <script type="application/json" data-island-props>{…剥过的 props…}</script>
//
// `display:contents`：多出来的这一层不参与排版（块的 flex / grid 直接子元素照旧是组件自己的根）。
// 接进 T2a-2 的 renderPage 归两张票里后合的那张（#1798 正文「不做」第一条）。
import type { ReactNode } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { IslandCollectorContext, type IslandCollector } from './island';
import { islandJson } from './json';
import { ISLANDS } from './registry';

export interface RenderedIsland { name: string; props: object; html: string }

/** 画一段树，岛位置填好。返回 HTML 和这一页的岛清单（测试拿它核 props）。 */
export function renderWithIslands(tree: ReactNode): { html: string; islands: RenderedIsland[] } {
  const found: { name: string; props: object }[] = [];
  const collector: IslandCollector = { add: (name, props) => found.push({ name, props }) - 1 };
  const shell = renderToStaticMarkup(<IslandCollectorContext.Provider value={collector}>{tree}</IslandCollectorContext.Provider>);
  const islands: RenderedIsland[] = [];
  const html = shell.replace(/<div data-island="([a-z0-9-]+)" data-island-slot="(\d+)"><\/div>/g, (_m, name: string, slot: string) => {
    const hit = found[Number(slot)];
    const Component = ISLANDS[name];
    if (!hit || hit.name !== name || !Component) throw new Error(`#1798 island "${name}" (slot ${slot}) is not in src/islands/registry.ts`);
    const inner = renderToString(<Component {...(hit.props as Record<string, unknown>)} />);
    islands.push({ name, props: hit.props, html: inner });
    return `<div data-island="${name}" style="display:contents">${inner}</div><script type="application/json" data-island-props>${islandJson(hit.props)}</script>`;
  });
  if (islands.length !== found.length) throw new Error(`#1798 ${found.length} islands registered but ${islands.length} placeholders filled`);
  return { html, islands };
}
