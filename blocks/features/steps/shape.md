---
order: 7
summary: "webpixels/section-process-2 · section-process-3 · 预设 Steps = introPosition top · introAlign left · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle plain · itemAlign left · itemIcon none · itemImage none · itemConnector line"
source: webpixels/section-process-2 · section-process-3
layout_intent:
  media: none
  columns: three
  align: start
  ratio: none
  media_side: none
---

# features · steps

**预设名：** Steps（`blocks/features/manifest.json` 的 `presets`）

**长什么样：** 平铺三列的步骤，每项一个序号徽章（不画图标），相邻两项的序号之间一条横线；块头在上左对齐。
序号来自每项的 `number`，连线只在有序号时画（`Section.tsx` §connector）—— 内容里没写 `number` 时这个预设看起来就是一个无图标的 Grid。

**旋钮：** introPosition top · introAlign left · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle plain · itemAlign left · itemIcon none · itemImage none · itemConnector line。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-process-2 · section-process-3（`docs/reference/webpixels/components.json` 的 process 段；#1490 —— Chris 2026-09-28「不单做 process 块，并进 features」）
