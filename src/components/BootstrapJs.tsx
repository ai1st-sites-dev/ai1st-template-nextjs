'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BootstrapJs —— 按需加载 Bootstrap 自带的 JS 模块（#1495 抽出，#1494 testimonials 的 Carousel 复用）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-09-30：弹窗 / 轮播一律用 Bootstrap 自带的 Modal / Carousel，不手写。站点平时不带 Bootstrap 的 JS，
// 只有页面上真有要它的块时才下载：块在自己的客户端组件里挂 `<BootstrapJs modal carousel />`（或直接调
// §loadBootstrap），这里对每个模块各做一次 `import()` —— webpack 把它切成单独的惰性 chunk，**不在**页面的
// 静态 chunk 清单里（所以「这一页有没有加载它」要看浏览器的网络请求，不看 chunk 清单，PM #1495 裁定 1）。
//
// 🔴 只引单个模块（`bootstrap/js/dist/modal` / `carousel`），不引整份 bundle。导入即生效：模块自己在 document 上
//    注册 data-api（`data-bs-toggle="modal"` / `data-bs-slide` / `data-bs-dismiss` 的点击委托、Esc、焦点锁定、
//    关掉后把焦点还给触发它的那个链接）—— 块的 markup 只写 Bootstrap 的 data 属性，不写一行事件处理。
// 🔴 这些类只由 Bootstrap 的 JS 在运行时加上，源码里别处一次都不出现，而 `public/site.css` 是按
//    `blocks/**/*.tsx` + `src/**/*.tsx` 的源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT）——
//    不在这里逐字列一遍，打开弹窗那一刻它们的规则已经被删掉了（弹窗不显示、背景不变暗、轮播不滑）：
//      show fade modal-open modal-backdrop modal-static carousel-item-next carousel-item-prev
//      carousel-item-start carousel-item-end pointer-event active
//    写成常量而不是只写注释，是为了让删这段的人看得见它有用途。

import { useEffect } from 'react';

export const BOOTSTRAP_RUNTIME_CLASSES = [
  'show', 'fade', 'modal-open', 'modal-backdrop', 'modal-static',
  'carousel-item-next', 'carousel-item-prev', 'carousel-item-start', 'carousel-item-end', 'pointer-event', 'active',
] as const;

export type BootstrapModule = 'modal' | 'carousel';

// 🔴 每个模块一条字面的 `import()`：webpack 只认字面路径，拼出来的路径它切不出 chunk。
const LOADERS: Record<BootstrapModule, () => Promise<unknown>> = {
  modal: () => import('bootstrap/js/dist/modal'),
  carousel: () => import('bootstrap/js/dist/carousel'),
};

/** 加载一个 Bootstrap 模块（同一个模块第二次调是同一个 Promise —— 浏览器只下载一次）。 */
export function loadBootstrap(name: BootstrapModule): Promise<unknown> {
  return LOADERS[name]();
}

/** 挂载时加载点名的模块；什么都不渲染。 */
export default function BootstrapJs({ modal = false, carousel = false }: { modal?: boolean; carousel?: boolean }) {
  useEffect(() => {
    if (modal) void loadBootstrap('modal');
    if (carousel) void loadBootstrap('carousel');
  }, [modal, carousel]);
  return null;
}
