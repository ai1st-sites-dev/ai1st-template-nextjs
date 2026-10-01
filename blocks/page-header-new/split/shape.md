---
order: 2
summary: "旧 page-header title-side · 预设 Split = headlinePosition left · textAlign left · image none"
source: 旧 page-header title-side
layout_intent:
  media: none
  columns: two
  align: start
  ratio: none
  media_side: none
---

# page-header-new · split

**预设名：** Split（`blocks/page-header-new/manifest.json` 的 `presets`）

**长什么样：** ≥992 标题一列、副标题 + 按钮一列（各半、底边对齐），面包屑在两列之上；小屏上下排

**旋钮：** headlinePosition left · textAlign left · image none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 旧 page-header title-side（定稿图册 page-header 段，`docs/reference/webpixels/gallery/gen-pageheader.py` + `build.py`）
