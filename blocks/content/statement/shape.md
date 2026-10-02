---
order: 4
summary: "webpixels/content-4 · 预设 Statement = headlinePosition top · textAlign left · textStyle statement · image none · frame card"
source: webpixels/content-4
layout_intent:
  media: none
  columns: one
  align: start
  ratio: none
  media_side: none
---

# content · statement

**预设名：** Statement（`blocks/content/manifest.json` 的 `presets`）

**长什么样：** 一张卡里的一段大字陈述：正文放大、标题不缩，靠左

**旋钮：** headlinePosition top · textAlign left · textStyle statement · image none · frame card。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/content-4（定稿图册 content 段，`docs/reference/webpixels/gallery/gen-content.py` + `build.py`）
