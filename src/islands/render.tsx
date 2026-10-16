// #1798 —— 静态整页 + 岛（只在服务端用）。整页 `renderToStaticMarkup`（没有 React 的注释和属性，最小），
// 每个岛单独 `renderToString`（🔴 React 文档：`renderToStaticMarkup` 的产物不能 `hydrateRoot`，岛必须走这一个）。
//
//   <div data-island="名字" style="display:contents"> …renderToString 出的那一段… </div>
//   <script type="application/json" data-island-props>{…剥过的 props…}</script>
//
// `display:contents`：多出来的这一层不参与排版（块的 flex / grid 直接子元素照旧是组件自己的根）。
// #1802 —— 接进了整页渲染：`render/index.tsx` §renderRoute 对每一页调它（T2a-2 是 #1798 之后合的那张）。
import { randomBytes } from 'crypto';
import type { ReactNode } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { IslandCollectorContext, type IslandCollector } from './island';
import { islandJson } from './json';
import { ISLANDS } from './registry';

export interface RenderedIsland { name: string; props: object; html: string }

// #1802 —— React 19 的服务端渲染遇到不懒加载的 `<img>` 会在**输出的最前面**放一条 `<link rel="preload" as="image">`（首屏图早点下载；
// 在 Next 里它们落进 <head>）。我们是分段渲染的（整页一段、每个岛一段），所以每一段开头都可能挂着几条 ⟹ 摘下来另交（`preloads`），
// 由整页那一层放进 <head>：留在原地的话，整页的那几条落在 <body> 最前面，岛的那几条落在岛的容器里 ——
// 后者跟浏览器里 hydrate 时画出来的对不上（客户端不会画这一条 link）。
const LEADING_PRELOADS = /^(?:<link rel="preload"[^>]*\/>)+/;
function splitPreloads(html: string, into: string[]): string {
  const m = LEADING_PRELOADS.exec(html);
  if (!m) return html;
  for (const link of m[0].match(/<link [^>]*\/>/g) || []) if (!into.includes(link)) into.push(link);
  return html.slice(m[0].length);
}

/** 画一段树，岛位置填好。返回 HTML、这一页的岛清单（测试拿它核 props），以及要放进 <head> 的预加载提示（见 §splitPreloads）。 */
export function renderWithIslands(tree: ReactNode): { html: string; islands: RenderedIsland[]; preloads: string[] } {
  const found: { name: string; props: object }[] = [];
  // #1802 —— 每次渲染一个新记号，只有带这个记号的占位才是岛（见 island.tsx §IslandCollector.token）。
  const token = randomBytes(12).toString('hex');
  const collector: IslandCollector = { add: (name, props) => found.push({ name, props }) - 1, token };
  const preloads: string[] = [];
  const shell = splitPreloads(renderToStaticMarkup(<IslandCollectorContext.Provider value={collector}>{tree}</IslandCollectorContext.Provider>), preloads);
  const islands: RenderedIsland[] = [];
  const placeholder = new RegExp(`<div data-island="([a-z0-9-]+)" data-island-slot="(\\d+)" data-island-token="${token}"></div>`, 'g');
  const html = shell.replace(placeholder, (_m, name: string, slot: string) => {
    const hit = found[Number(slot)];
    const Component = ISLANDS[name];
    if (!hit || hit.name !== name || !Component) throw new Error(`#1798 island "${name}" (slot ${slot}) is not in src/islands/registry.ts`);
    const inner = splitPreloads(renderToString(<Component {...(hit.props as Record<string, unknown>)} />), preloads);
    islands.push({ name, props: hit.props, html: inner });
    return `<div data-island="${name}" style="display:contents">${inner}</div><script type="application/json" data-island-props>${islandJson(hit.props)}</script>`;
  });
  if (islands.length !== found.length) throw new Error(`#1798 ${found.length} islands registered but ${islands.length} placeholders filled`);
  return { html, islands, preloads };
}
