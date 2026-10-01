'use client';

// gallery-new 的大图（#1495）：Bootstrap 的 Modal + Carousel 本身由 `src/components/BootstrapJs.tsx` 按需加载，
// markup 在 Section.tsx 里（服务端渲染）。这里只做 Bootstrap 自己没有的那一件事 —— **从点的那一张开始**：
// `show.bs.modal` 事件的 `relatedTarget` 是被点的那个 `<a data-gl-index>`，把第 N 个 `.carousel-item` 和第 N 个
// indicator 设成 active（照图册 `docs/reference/webpixels/gallery/build.py` 里「图册胶水」那几行）。
//
// 🔴 Carousel 的实例要在这里建：`data-bs-ride="false"` 时 Bootstrap 只在第一次点左右箭头时才建实例，而横滑
//    （`touch`）是实例构造时才挂上的 ⟹ 手机上一次箭头都没点过就滑不动（390 上箭头是藏起来的）。
// 🔴 先设好 active 再建实例（实例每次都从 DOM 里的 `.active` 读当前是第几张，不自己记）。
// 🔴 还要在 `shown.bs.modal` 里把焦点放进轮播，否则**键盘左右键在点过箭头之前完全不工作**（Chris 2026-10-01 实测）：
//    Bootstrap 把 keydown 挂在**轮播元素自己身上**（`bootstrap/js/dist/carousel.js` 的 `§_addEventListeners`
//    —— `EventHandler.on(this._element, EVENT_KEYDOWN, …)`），而 keydown 从聚焦元素**向上冒泡** ⟹ 只有焦点在轮播
//    【里面】时才命中。Modal 打开时焦点给的是 Modal 自己（`bootstrap/js/dist/modal.js` 的 `§_initializeFocusTrap`（trapElement = .modal）→
//    `bootstrap/js/dist/util/focustrap.js` 的 `§activate`（trapElement.focus()）），轮播是它的**后代** ⟹ 事件往上走，永远到不了那个 handler。
//    点一下 ▶ 之所以"修好"了，是因为焦点落到了轮播的后代按钮上。配套：`Section.tsx` 的 `.carousel` 加了
//    `tabIndex={-1}`（没有它 focus() 不生效）。这同时是无障碍问题，不只是手感。

import { useEffect } from 'react';
import { loadBootstrap } from '@/components/BootstrapJs';

type CarouselCtor = { getOrCreateInstance(el: Element, config?: object): unknown };

export default function GalleryLightbox({ modalId }: { modalId: string }) {
  useEffect(() => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const carouselLoaded = loadBootstrap('carousel') as Promise<{ default: CarouselCtor }>;
    void loadBootstrap('modal');
    const onShow = (e: Event) => {
      const a = (e as Event & { relatedTarget?: HTMLElement | null }).relatedTarget;
      const n = a && a.dataset ? Number(a.dataset.glIndex) : 0;
      const i = Number.isInteger(n) && n >= 0 ? n : 0;
      const car = modal.querySelector('.carousel');
      if (!car) return;
      car.querySelectorAll('.carousel-item').forEach((s, k) => s.classList.toggle('active', k === i));
      car.querySelectorAll('.carousel-indicators [data-bs-slide-to]').forEach((b, k) => {
        b.classList.toggle('active', k === i);
        if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
      void carouselLoaded.then((m) => { m.default.getOrCreateInstance(car, { interval: false, ride: false, touch: true, keyboard: true }); });
    };
    // 焦点要在 Modal 的 focustrap 跑完之后再抢，所以用 shown（不是 show）。
    // 🔴 `preventScroll: true`：我们要的是键盘，不是滚动。`focus()` 默认会把元素滚进视野，而 AC2 量的恰好是
    //    「16 种组合 × 三端没有横向滚动条」⟹ 不加这个参数等于在一条判据的射程里引入一个副作用。
    const onShown = () => { (modal.querySelector('.carousel') as HTMLElement | null)?.focus({ preventScroll: true }); };
    modal.addEventListener('show.bs.modal', onShow);
    modal.addEventListener('shown.bs.modal', onShown);
    return () => {
      modal.removeEventListener('show.bs.modal', onShow);
      modal.removeEventListener('shown.bs.modal', onShown);
    };
  }, [modalId]);
  return null;
}
