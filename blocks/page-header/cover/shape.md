---
order: 4
summary: "—（图册自拼） · 预设 Cover = headlinePosition top · textAlign center · image background"
source: —
needs:
  - image
layout_intent:
  media: cover
  columns: one
  align: center
  ratio: none
  media_side: none
---

# page-header · cover

**预设名：** Cover（`blocks/page-header/manifest.json` 的 `presets`）

**长什么样：** 整条铺图 + 深色遮罩，文字居中反白

**旋钮：** headlinePosition top · textAlign center · image background。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** —（图册自拼）（定稿图册 page-header 段，`docs/reference/webpixels/gallery/gen-pageheader.py` + `build.py`）
