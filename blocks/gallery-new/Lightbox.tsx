'use client';

// gallery-new 的大图（#1495）：Bootstrap 的 Modal + Carousel 本身由 `src/components/BootstrapJs.tsx` 按需加载，
// markup 在 Section.tsx 里（服务端渲染）。这里只做 Bootstrap 自己没有的那一件事 —— **从点的那一张开始**：
// `show.bs.modal` 事件的 `relatedTarget` 是被点的那个 `<a data-gl-index>`，把第 N 个 `.carousel-item` 和第 N 个
// indicator 设成 active（照图册 `docs/reference/webpixels/gallery/build.py` 里「图册胶水」那几行）。
//
// 🔴 Carousel 的实例要在这里建：`data-bs-ride="false"` 时 Bootstrap 只在第一次点左右箭头时才建实例，而横滑
//    （`touch`）是实例构造时才挂上的 ⟹ 手机上一次箭头都没点过就滑不动（390 上箭头是藏起来的）。
// 🔴 先设好 active 再建实例（实例每次都从 DOM 里的 `.active` 读当前是第几张，不自己记）。

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
    modal.addEventListener('show.bs.modal', onShow);
    return () => modal.removeEventListener('show.bs.modal', onShow);
  }, [modalId]);
  return null;
}
