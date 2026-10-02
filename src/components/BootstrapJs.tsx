'use client';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// BootstrapJs —— 按需加载 Bootstrap 自带的 JS 模块（#1495 抽出，#1494 testimonials 的 Carousel 复用，#1514 开成任一模块）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-10-01（总纲 #1422 约束 2 第 3 版）：**HTML 的交互归 bootstrap.js** —— 展开 / 收起 / 滑动 / 关闭这类 DOM
// 行为，Bootstrap 有组件的就用它的（Modal / Carousel / Collapse / Dropdown / Offcanvas / Tooltip），不手写。
// 站点平时不带 Bootstrap 的 JS，只有页面上真有要它的块时才下载：块在自己的客户端组件里挂
// `<BootstrapJs collapse />`（或直接调 §loadBootstrap），这里对每个模块各做一次 `import()` —— webpack 把它切成单独的
// 惰性 chunk，**不在**页面的静态 chunk 清单里（所以「这一页有没有加载它」要看浏览器的网络请求，不看 chunk 清单，
// PM #1495 裁定 1；量法在 `tests/e2e/specs/1494-testimonials-carousel-js.spec.ts` / `1514-bootstrap-js.spec.ts`）。
//
// 🔴 只引单个模块（`bootstrap/js/dist/<模块>`），不引整份 bundle、不引包根（`gallery-render.test.js` 全仓 grep 守着）。导入即生效：模块自己在
//    document 上注册 data-api（`data-bs-toggle="modal|collapse"` / `data-bs-slide` / `data-bs-dismiss` 的点击委托、
//    Esc、焦点锁定、关掉后把焦点还给触发它的那个链接）—— 块的 markup 只写 Bootstrap 的 data 属性，不写事件处理。
//    （Collapse 自己不管 Esc；要 Esc 关的块自己挂一个 keydown 调 `getInstance(el).hide()`，header 就是这么做的。）
// 🔴 不是「只要 Bootstrap 做得了就一定换」：换了会打破一条已成立判据的（contact 的地图：点之前 iframe 不进 DOM
//    才不发站外请求，Collapse 只管 display），写清代价交 PM / Chris 拍（#1514 正文 ②）；Bootstrap 没有对应组件的
//    （pricing 月付 / 年付换的是渲染出来的数字）留 React。
// 🔴 这些类只由 Bootstrap 的 JS 在运行时加上，源码里别处一次都不出现，而 `public/site.css` 是按
//    `blocks/**/*.tsx` + `src/**/*.tsx` 的源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT）——
//    不在这里逐字列一遍，打开弹窗那一刻它们的规则已经被删掉了（弹窗不显示、背景不变暗、轮播不滑、抽屉收不起）：
//      show fade modal-open modal-backdrop modal-static carousel-item-next carousel-item-prev
//      carousel-item-start carousel-item-end pointer-event active collapse collapsing collapsed
//    写成常量而不是只写注释，是为了让删这段的人看得见它有用途。dropdown / offcanvas / tooltip 今天没有块用，
//    它们的运行时类（`dropdown-menu.show` / `offcanvas-backdrop` / `tooltip.show` …）等第一个用到的块来补。

import { useEffect } from 'react';

export const BOOTSTRAP_RUNTIME_CLASSES = [
  'show', 'fade', 'modal-open', 'modal-backdrop', 'modal-static',
  'carousel-item-next', 'carousel-item-prev', 'carousel-item-start', 'carousel-item-end', 'pointer-event', 'active',
  'collapse', 'collapsing', 'collapsed',
] as const;

export type BootstrapModule = 'modal' | 'carousel' | 'collapse' | 'dropdown' | 'offcanvas' | 'tooltip';

// 🔴 每个模块一条字面的 `import()`：webpack 只认字面路径，拼出来的路径它切不出 chunk。
const LOADERS: Record<BootstrapModule, () => Promise<unknown>> = {
  modal: () => import('bootstrap/js/dist/modal'),
  carousel: () => import('bootstrap/js/dist/carousel'),
  collapse: () => import('bootstrap/js/dist/collapse'),
  dropdown: () => import('bootstrap/js/dist/dropdown'),
  offcanvas: () => import('bootstrap/js/dist/offcanvas'),
  tooltip: () => import('bootstrap/js/dist/tooltip'),
};

export const BOOTSTRAP_MODULES = Object.keys(LOADERS) as BootstrapModule[];

/** 加载一个 Bootstrap 模块（同一个模块第二次调是同一个 Promise —— 浏览器只下载一次）。 */
export function loadBootstrap(name: BootstrapModule): Promise<unknown> {
  return LOADERS[name]();
}

/** 挂载时加载点名的模块（`<BootstrapJs modal carousel />` / `<BootstrapJs collapse />`）；什么都不渲染。 */
export default function BootstrapJs(props: Partial<Record<BootstrapModule, boolean>>) {
  const wanted = BOOTSTRAP_MODULES.filter((m) => props[m]).join(' ');
  useEffect(() => {
    for (const m of wanted.split(' ')) if (m) void loadBootstrap(m as BootstrapModule);
  }, [wanted]);
  return null;
}
