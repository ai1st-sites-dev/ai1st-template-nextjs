---
order: 3
summary: "webpixels/content-3 · 预设 Image right = headlinePosition top · textAlign left · textStyle article · image right · frame none"
source: webpixels/content-3
layout_intent:
  media: side
  columns: two
  align: center
  ratio: major-start
  media_side: end
---

# content-new · image-right

**预设名：** Image right（`blocks/content-new/manifest.json` 的 `presets`）

**长什么样：** 文字在左、图在右（图 45%），小屏图在文字下面

**旋钮：** headlinePosition top · textAlign left · textStyle article · image right · frame none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/content-3（定稿图册 content 段，`docs/reference/webpixels/gallery/gen-content.py` + `build.py`）
