---
order: 4
summary: "— · 预设 Side intro = introPosition left · introAlign left · itemsLayout grid · itemsColumns 3 · itemShape square · itemCaption below"
source: ours
layout_intent:
  media: none
  columns: many
  align: start
  ratio: none
  media_side: none
---

# gallery · side-intro

**预设名：** Side intro（`blocks/gallery/manifest.json` 的 `presets`）

**长什么样：** 块头在左侧一列（sticky），右边照片三列方图，图注在图下面；点任一张打开大图（Bootstrap Modal + Carousel，从点的那一张开始）

**旋钮：** introPosition left · introAlign left · itemsLayout grid · itemsColumns 3 · itemShape square · itemCaption below。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** —（我们自己的，定稿图册 gallery 段）（定稿图册 gallery 段，`docs/reference/webpixels/gallery/gen-gallery.py` + `build.py`）
