---
order: 0
summary: "webpixels/secondary-header-1（旧 stack-left） · 预设 Simple = headlinePosition top · textAlign left · image none"
source: webpixels/secondary-header-1
layout_intent:
  media: none
  columns: one
  align: start
  ratio: none
  media_side: none
---

# page-header · simple

**预设名：** Simple（`blocks/page-header/manifest.json` 的 `presets`）

**长什么样：** 标题在上、副标题和按钮在下，左对齐，没有图

**旋钮：** headlinePosition top · textAlign left · image none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/secondary-header-1（旧 stack-left）（定稿图册 page-header 段，`docs/reference/webpixels/gallery/gen-pageheader.py` + `build.py`）
