---
order: 1
summary: "旧 page-header centered · 预设 Centered = headlinePosition top · textAlign center · image none"
source: 旧 page-header centered
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# page-header · centered

**预设名：** Centered（`blocks/page-header/manifest.json` 的 `presets`）

**长什么样：** 同 Simple，整块居中（按钮行也居中）

**旋钮：** headlinePosition top · textAlign center · image none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 旧 page-header centered（定稿图册 page-header 段，`docs/reference/webpixels/gallery/gen-pageheader.py` + `build.py`）
