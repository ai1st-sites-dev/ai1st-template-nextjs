---
order: 2
summary: "webpixels/section-hero-3c · 预设 Cover = align left · image background · form none"
source: webpixels/section-hero-3c
needs:
  - image
layout_intent:
  media: cover
  columns: one
  align: start
  ratio: none
  media_side: none
---

# hero-new · cover

**预设名：** Cover（`blocks/hero-new/manifest.json` 的 `presets`）

**长什么样：** 图铺底 + 深色渐变遮罩、文字反白

**旋钮：** align left · image background · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-3c
