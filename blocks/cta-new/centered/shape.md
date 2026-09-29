---
order: 0
summary: "webpixels/cta-1（flat） · 预设 Centered = layout centered · frame none · textAlign center · image none · form none"
source: webpixels/cta-1
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# cta-new · centered

**预设名：** Centered（`blocks/cta-new/manifest.json` 的 `presets`）

**长什么样：** 平铺整段，文字与按钮居中

**旋钮：** layout centered · frame none · textAlign center · image none · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/cta-1（flat）（定稿图册 cta 段，`docs/reference/webpixels/gallery/gen-ctas.py` + `build.py`）
