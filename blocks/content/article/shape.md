---
order: 1
summary: "webpixels/content-1 · 预设 Article = headlinePosition top · textAlign left · textStyle article · image none · frame none"
source: webpixels/content-1
layout_intent:
  media: none
  columns: one
  align: start
  ratio: none
  media_side: none
---

# content · article

**预设名：** Article（`blocks/content/manifest.json` 的 `presets`）

**长什么样：** 标题在上、正文占满整列，没有图、没有卡

**旋钮：** headlinePosition top · textAlign left · textStyle article · image none · frame none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/content-1（定稿图册 content 段，`docs/reference/webpixels/gallery/gen-content.py` + `build.py`）
