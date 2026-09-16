'use client';

// #1345 —— 图册页这一侧的**收端**：admin 的「区块与主题」页（`dashboard/src/pages/admin/CatalogPage.tsx`）
// 把这一页放进 iframe，点左边表里的一行时给它发一条消息，这一页滚到那一格。
//
// 🔴 **第一句就是认源，而且只有那一句。** `if (e.origin !== adminOrigin) return;` ——
//    没有通配、没有后缀匹配、没有 `includes`，只有 `!==`。本票 AC5 的反向臂要挥的就是这一刀：
//    删掉它重跑同一条臂，第三方来源发的消息就会把页面滚走。
//
// 🔴 **不许拿「发送端写了 targetOrigin」当安全边界。** `targetOrigin` 写错时浏览器压根不投递，
//    这一页一行都不跑 ⟹ 「有校验」和「谁发都收」在那种臂上给出**同一个读数**（本票 v1/v2 各被
//    退过一次，PM 与作者各自用三个源的夹具量过四格）。收端自己认源是唯一能分开两种实现的那一句。
//
// 🔴 **谁有资格发，由部署那一层给**（`deploy/cloud-dev/build-showcase-from-main.sh` 的
//    `SHOWCASE_ADMIN_ORIGIN` → `AI1ST_CATALOG_ADMIN_ORIGIN`，跟 `SHOWCASE_FRAME_ANCESTORS` 并排）。
//    没配就整个监听器不挂（`page.dev.tsx` 里那个条件渲染）—— 失败方向是「不滚」，不是「谁都能滚」。
//    这跟 `layout.tsx` 的试穿通道同源：那一条的来源取自 `leadApi`，取不出就一个监听器都不发
//    （`layout.tsx` §previewTrustedOrigin 原话）。这一页取不到 `leadApi`（展示站建出来是空串，
//    现取 `/root/showcase-main/slots/*/src/lib/config-data.ts` = `export const leadApi = "";`），
//    所以它走自己的那条环境变量，不共用那一个。

import { useEffect } from 'react';

/** 协议名。发端在 `dashboard/src/pages/admin/CatalogPage.tsx`，两边是同一个字符串。 */
export const CATALOG_SCROLL_MESSAGE = 'ai1st:catalog-scroll';

interface Props {
  /** 唯一被信任的来源，`===` 比较。空串时 `page.dev.tsx` 根本不渲染这个组件。 */
  adminOrigin: string;
}

export default function CatalogScroll({ adminOrigin }: Props) {
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== adminOrigin) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if ((d as { type?: unknown }).type !== CATALOG_SCROLL_MESSAGE) return;
      const block = typeof (d as { block?: unknown }).block === 'string' ? (d as { block: string }).block : '';
      if (!block) return;
      // `shape` 是**可选**的：admin 那张表一行是一个块（没有按形态分的行），所以它今天不发这个字段，
      // 而协议收得下它 —— 不给形态就滚到这个块的**第一格**，给了就滚到那一格。
      const shape = typeof (d as { shape?: unknown }).shape === 'string' ? (d as { shape: string }).shape : '';
      // 🔴 拿属性比对，不把消息里的串拼进选择器：这条消息来自被信任的来源，但一个能被拼进
      //    `querySelector` 的字符串是另一类问题，没有理由制造它。
      const cells = Array.from(document.querySelectorAll('[data-catalog-cell]'));
      const target = cells.find(
        (el) =>
          el.getAttribute('data-catalog-block') === block &&
          (shape === '' || el.getAttribute('data-catalog-shape') === shape),
      );
      if (!target) return;
      // 瞬时滚动（默认 `behavior:'auto'`）：AC5 两臂都是读一次 `getBoundingClientRect()`，
      // 平滑滚动会让那个读数变成「量到动画的哪一帧」。让开吸顶那两条的距离写在
      // `.catalog-cell { scroll-margin-top }` 上（`page.dev.tsx` 的 CHROME_CSS）。
      target.scrollIntoView({ block: 'start' });
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [adminOrigin]);

  return null;
}
