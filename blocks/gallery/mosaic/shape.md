---
order: 3
summary: "webpixels/gallery-2 · 预设 Mosaic = introPosition top · introAlign left · itemsLayout mosaic · itemsColumns 4 · itemShape square · itemCaption overlay"
source: webpixels/gallery-2
layout_intent:
  media: none
  columns: many
  align: start
  ratio: none
  media_side: none
---

# gallery · mosaic

**预设名：** Mosaic（`blocks/gallery/manifest.json` 的 `presets`）

**长什么样：** 块头靠左在上，第一张占 2×2 的大图、其余方图一格，图注压在图底部；点任一张打开大图（Bootstrap Modal + Carousel，从点的那一张开始）

**旋钮：** introPosition top · introAlign left · itemsLayout mosaic · itemsColumns 4 · itemShape square · itemCaption overlay。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/gallery-2（定稿图册 gallery 段，`docs/reference/webpixels/gallery/gen-gallery.py` + `build.py`）
