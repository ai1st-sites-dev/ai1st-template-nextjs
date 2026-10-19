'use client';
// #1833 r2 —— 站的渲染入口声明「这是老板的网站」（`SiteRenderContext`，见 `lib/editor-canvas.ts`）。只有这里面的 Custom HTML 块
// 原样写老板的代码；dashboard 里的任何渲染面（编辑器画布、只读画布、块图册）都不包它 ⟹ 默认净化。
// 用它的：静态发布 / 预览（`render/index.tsx` §renderRoute）、Next 的站页面（首页 / `[...slug]` / blog / blog 详情 / 404）、
// 两处块图册的服务端渲染（演示数据是仓里写的，服务端没有 window，净化那一支跑不了）。
// 'use client'：Next 的服务端组件里不能用 context Provider。
import type { ReactNode } from 'react';
import { SiteRenderContext } from '@template/lib/editor-canvas';

export default function SiteRender({ children }: { children: ReactNode }) {
  return <SiteRenderContext.Provider value>{children}</SiteRenderContext.Provider>;
}
