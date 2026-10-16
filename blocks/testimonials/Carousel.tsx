'use client';

// testimonials 的轮播（#1494）：Bootstrap Carousel。外框和里面的一切 —— 每张 slide、每条评价、圆点、前 / 后按钮 ——
// 都是 `Section.tsx` 在服务端画的；这里只剩挂载后的那段行为，画出来的只有一个空 span（用来找到外框），做两件事：
//   1. 挂载后 `import('bootstrap/js/dist/carousel')`（只这一个模块，按需切出来的 chunk；页面上没有轮播就不加载）
//      再 `Carousel.getOrCreateInstance(el)`。圆点 / 前后按钮靠 Bootstrap 的 data 属性（`data-bs-slide-to` /
//      `data-bs-slide`），这里不写点击处理。
//   2. id 去重：`data-bs-target` 要指着一个 id，服务端按 block.id 拼；老站的块没有 id，同一页两个轮播会撞同一个
//      `tn-carousel` ⟹ 挂载时发现重名就换一个，并改写里面按钮的 `data-bs-target`。
// 🔴 不自动播放：`data-bs-ride="false"` + `data-bs-interval="false"`；建实例时也不传 ride（carousel.js 的 Default 本来就是
//    ride: false）。别写成 `data-bs-ride="carousel"` —— 那是 Bootstrap 自己扫页面自动初始化 + 自动播放的那个开关。
// 🔴 滑动过程中 Bootstrap 会临时挂上 carousel-item-next / carousel-item-prev / carousel-item-start / carousel-item-end
//    这四个类。`site.css` 按源码里出现过的词 purge（`scripts/lib/site-css.js` §PURGE_CONTENT），这一行就是让它们的规则留下来的那一处。

// 🔴 #1798 —— 它不再收 children。原来它是外框本身（`{ id, label, children }`），而发布出去的静态网页上它是一个岛，岛的 props
//    必须是 JSON：children 是整段引言，要么在服务端渲染当中再套一次渲染转成字符串、要么把每条引言在 props 里再存一遍。
//    改成外框归 Section、这里只放一个「挂载后初始化」的小件：props 是空的，页面上的字只出现一次。
import { useEffect, useRef } from 'react';
import { island } from '@/islands/island';

let seq = 0;

function TestimonialsCarouselInit() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current?.closest<HTMLElement>('.carousel');
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

  // 空的 span，不占位置；不加 `hidden` / display:none —— 测试核「服务端 HTML 里没有任何东西被藏起来」（6 条引言都可见）。
  return <span ref={ref} data-part="carousel-init" />;
}

export default island('testimonials-carousel', TestimonialsCarouselInit);
