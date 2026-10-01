---
order: 2
summary: "webpixels/content-2 · 预设 Title left = headlinePosition left · textAlign left · textStyle article · image none · frame none"
source: webpixels/content-2
layout_intent:
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# content-new · title-left

**预设名：** Title left（`blocks/content-new/manifest.json` 的 `presets`）

**长什么样：** ≥992 标题单独一列（1/3）、正文一列（2/3）；小屏标题在上

**旋钮：** headlinePosition left · textAlign left · textStyle article · image none · frame none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/content-2（定稿图册 content 段，`docs/reference/webpixels/gallery/gen-content.py` + `build.py`）
