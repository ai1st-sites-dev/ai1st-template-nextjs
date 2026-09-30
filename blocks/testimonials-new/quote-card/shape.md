---
order: 3
summary: "webpixels/testimonials-3 · 预设 Quote card = introPosition top · introAlign center · itemsLayout carousel · itemsColumns 2 · itemStyle card · quoteSize lg · itemAlign left"
source: webpixels/testimonials-3
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# testimonials-new · quote-card

**预设名：** Quote card（`blocks/testimonials-new/manifest.json` 的 `presets`）

**长什么样：** 块头居中，两条一屏的大字卡片轮播

**旋钮：** introPosition top · introAlign center · itemsLayout carousel · itemsColumns 2 · itemStyle card · quoteSize lg · itemAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/testimonials-3（定稿图册 testimonials 段，`docs/reference/webpixels/gallery/gen-testimonials.py` + `build.py`）
