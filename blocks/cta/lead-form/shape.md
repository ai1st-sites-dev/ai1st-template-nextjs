---
order: 4
summary: "webpixels/cta-4（form） · 预设 Lead form = layout centered · frame boxed · textAlign center · image none · form full"
source: webpixels/cta-4
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# cta · lead-form

**预设名：** Lead form（`blocks/cta/manifest.json` 的 `presets`）

**长什么样：** 圆角盒子，文字居中，下面整张表单（name / phone / service + 按钮）

**旋钮：** layout centered · frame boxed · textAlign center · image none · form full。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/cta-4（form）（定稿图册 cta 段，`docs/reference/webpixels/gallery/gen-ctas.py` + `build.py`）
