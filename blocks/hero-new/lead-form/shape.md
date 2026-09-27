---
order: 3
summary: "webpixels/section-hero-6 · 预设 Lead form = align left · image normal · form stacked"
source: webpixels/section-hero-6
layout_intent:
  media: side
  columns: two
  align: start
  ratio: even
  media_side: end
---

# hero-new · lead-form

**预设名：** Lead form（`blocks/hero-new/manifest.json` 的 `presets`）

**长什么样：** 文字左、图在右，文字块里一张表单（姓名 / 电话 + 需求 + 提交）

**旋钮：** align left · image normal · form stacked。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-6
