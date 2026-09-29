---
order: 3
summary: "webpixels/cta-5（photo） · 预设 Photo = layout centered · frame boxed · textAlign left · image left · form none"
source: webpixels/cta-5
layout_intent:
  media: side
  columns: two
  align: start
  ratio: none
  media_side: start
---

# cta-new · photo

**预设名：** Photo（`blocks/cta-new/manifest.json` 的 `presets`）

**长什么样：** 圆角盒子，图在左（42%），文字与按钮在右（<992 图在上）

**旋钮：** layout centered · frame boxed · textAlign left · image left · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/cta-5（photo）（定稿图册 cta 段，`docs/reference/webpixels/gallery/gen-ctas.py` + `build.py`）
