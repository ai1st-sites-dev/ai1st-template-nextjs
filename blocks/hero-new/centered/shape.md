---
order: 1
summary: "webpixels/section-hero-3 · 预设 Centered = align center · image normal · form none"
source: webpixels/section-hero-3
layout_intent:
  media: below
  columns: one
  align: center
  ratio: none
  media_side: none
---

# hero-new · centered

**预设名：** Centered（`blocks/hero-new/manifest.json` 的 `presets`）

**长什么样：** 文字居中、图在下（21:9）

**旋钮：** align center · image normal · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-3
