// #1798 —— 发布出去的网页底部那一份脚本（`runtime.<内容哈希>.js`，esbuild 打成 iife，`scripts/lib/islands-build.js`）：
//   ① Bootstrap 的数据属性那一套：下拉 / 折叠（正文点名）+ 轮播 / 弹窗（评价轮播、图库灯箱在用）。原来由 `BootstrapJs` 按需 import，
//      iife 里按需 import 本来就全打进来。offcanvas / tooltip 不带：没有任何块用它们（`data-bs-toggle` 现取只有 collapse / modal），
//      带上 gzip 多约 4 KB（#1798 交付留言里有三档读数）。
//   ② 每个 `[data-island]`：读紧挨着的 props JSON，`hydrateRoot` 点亮。
// 一个岛点亮失败不拖累别的岛（各自 try）。
import 'bootstrap/js/dist/collapse';
import 'bootstrap/js/dist/dropdown';
import 'bootstrap/js/dist/carousel';
import 'bootstrap/js/dist/modal';
import { hydrateRoot } from 'react-dom/client';
import { ISLANDS } from './registry';

declare const __ISLANDS_NO_HYDRATE__: boolean;

function boot() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-island]'))) {
    const name = el.dataset.island || '';
    try {
      const Component = ISLANDS[name];
      const script = el.nextElementSibling;
      if (!Component || !script || !script.hasAttribute('data-island-props')) throw new Error('no component / props');
      const props = JSON.parse(script.textContent || '{}');
      // 变异臂（`islands-build.js` 的 noHydrate）：去掉这一行 ⟹ 表单 / 价格切换 / 地图那几格必须红。
      if (!__ISLANDS_NO_HYDRATE__) hydrateRoot(el, <Component {...props} />);
    } catch (e) {
      console.error(`[islands] ${name}:`, e);
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
