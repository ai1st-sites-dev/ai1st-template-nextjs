'use client';

// testimonials-new 的轮播外壳（#1494）：Bootstrap Carousel。块的其余部分是服务端组件 —— 每张 slide、每条评价、圆点、
// 前 / 后按钮全在服务端 HTML 里（children），这一小段只做两件事：
//   1. 挂载后 `import('bootstrap/js/dist/carousel')`（只这一个模块，按需切出来的 chunk；页面上没有轮播就不加载）
//      再 `Carousel.getOrCreateInstance(el)`。圆点 / 前后按钮靠 Bootstrap 的 data 属性（`data-bs-slide-to` /
//      `data-bs-slide`），这里不写点击处理。
//   2. id 去重：`data-bs-target` 要指着一个 id，服务端按 block.id 拼；老站的块没有 id，同一页两个轮播会撞同一个
//      `tn-carousel` ⟹ 挂载时发现重名就换一个，并改写里面按钮的 `data-bs-target`。
// 🔴 不自动播放：`data-bs-ride="false"` + `data-bs-interval="false"`；建实例时也不传 ride（carousel.js 的 Default 本来就是
//    ride: false）。别写成 `data-bs-ride="carousel"` —— 那是 Bootstrap 自己扫页面自动初始化 + 自动播放的那个开关。
// 🔴 滑动过程中 Bootstrap 会临时挂上 carousel-item-next / carousel-item-prev / carousel-item-start / carousel-item-end
//    这四个类。`site.css` 按源码里出现过的词 purge（`scripts/lib/site-css.js` §PURGE_CONTENT），这一行就是让它们的规则留下来的那一处。

import { useEffect, useRef, type ReactNode } from 'react';

let seq = 0;

interface Props {
  id: string;
  label: string;
  children: ReactNode;
}

export default function TestimonialsCarousel({ id, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (document.querySelectorAll(`[id="${el.id}"]`).length > 1) {
      seq += 1;
      const fresh = `${el.id}-${seq}`;
      el.id = fresh;
      el.querySelectorAll('[data-bs-target]').forEach((b) => b.setAttribute('data-bs-target', `#${fresh}`));
    }
    let gone = false;
    let inst: { dispose(): void } | null = null;
    import('bootstrap/js/dist/carousel').then(({ default: Carousel }) => {
      if (gone) return;
      inst = Carousel.getOrCreateInstance(el);
      el.setAttribute('data-ready', '1'); // 读数：模块挂上了（e2e / QA 据它等，别拿它当样式钩子）
    }).catch(() => {
      // 弱网下 chunk 拉不下来：第一张 slide 照常显示、6 条引言都在 HTML 里，只是翻不了页 —— 接住它，别在控制台留一条没人接的错。
    });
    return () => {
      gone = true;
      if (inst) inst.dispose();
      el.removeAttribute('data-ready');
    };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className="carousel slide tn-carousel"
      data-part="carousel"
      data-bs-ride="false"
      data-bs-interval="false"
      data-bs-touch="true"
      data-bs-keyboard="true"
      tabIndex={0}
      aria-label={label}
      aria-roledescription="carousel"
    >
      {children}
    </div>
  );
}
