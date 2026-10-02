---
order: 3
summary: "webpixels/secondary-header-image-1 · 预设 Photo = headlinePosition top · textAlign left · image right"
source: webpixels/secondary-header-image-1
layout_intent:
  media: side
  columns: two
  align: start
  ratio: none
  media_side: end
---

# page-header · photo

**预设名：** Photo（`blocks/page-header/manifest.json` 的 `presets`）

**长什么样：** 文字在左，图在右（40%、4:3），垂直居中；小屏图在文字下面

**旋钮：** headlinePosition top · textAlign left · image right。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/secondary-header-image-1（定稿图册 page-header 段，`docs/reference/webpixels/gallery/gen-pageheader.py` + `build.py`）
