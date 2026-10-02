---
order: 5
summary: "—（图册自拼） · 预设 Cover = layout inline · frame boxed · textAlign left · image background · form none"
source: —
needs:
  - image
layout_intent:
  media: cover
  columns: two
  align: start
  ratio: none
  media_side: none
---

# cta · cover

**预设名：** Cover（`blocks/cta/manifest.json` 的 `presets`）

**长什么样：** 圆角盒子铺照片 + 55% 深色遮罩，文字反白在左、按钮在右

**旋钮：** layout inline · frame boxed · textAlign left · image background · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** —（图册自拼）（定稿图册 cta 段，`docs/reference/webpixels/gallery/gen-ctas.py` + `build.py`）
