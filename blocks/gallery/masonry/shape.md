---
order: 2
summary: "webpixels/gallery-2 / gallery-3 · 预设 Masonry = introPosition top · introAlign center · itemsLayout grid · itemsColumns 3 · itemShape original · itemCaption overlay"
source: webpixels/gallery-2 / gallery-3
layout_intent:
  media: none
  columns: many
  align: center
  ratio: none
  media_side: none
---

# gallery · masonry

**预设名：** Masonry（`blocks/gallery/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，照片三列按原图比例错落排（瀑布流），图注压在图底部；点任一张打开大图（Bootstrap Modal + Carousel，从点的那一张开始）

**旋钮：** introPosition top · introAlign center · itemsLayout grid · itemsColumns 3 · itemShape original · itemCaption overlay。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/gallery-2 / gallery-3（定稿图册 gallery 段，`docs/reference/webpixels/gallery/gen-gallery.py` + `build.py`）
