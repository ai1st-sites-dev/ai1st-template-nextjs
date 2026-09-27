---
order: 0
summary: "webpixels/section-hero-1 · 预设 Split = align left · image normal · form none"
source: webpixels/section-hero-1
layout_intent:
  media: side
  columns: two
  align: start
  ratio: even
  media_side: end
---

# hero-new · split

**预设名：** Split（`blocks/hero-new/manifest.json` 的 `presets`）

**长什么样：** 文字左、图在右（默认）

**旋钮：** align left · image normal · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-1
