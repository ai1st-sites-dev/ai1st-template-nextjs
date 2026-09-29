---
order: 2
summary: "webpixels/cta-2b（inline） · 预设 Inline = layout inline · frame boxed · textAlign left · image none · form none"
source: webpixels/cta-2b
layout_intent:
  media: none
  columns: two
  align: start
  ratio: none
  media_side: none
---

# cta-new · inline

**预设名：** Inline（`blocks/cta-new/manifest.json` 的 `presets`）

**长什么样：** 圆角盒子，文字在左、按钮在右一行（<992 上下叠）

**旋钮：** layout inline · frame boxed · textAlign left · image none · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/cta-2b（inline）（定稿图册 cta 段，`docs/reference/webpixels/gallery/gen-ctas.py` + `build.py`）
