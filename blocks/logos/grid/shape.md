---
order: 1
summary: "webpixels/logos-2 · 预设 Grid = introPosition top · introAlign center · introSize lg · itemsLayout grid · itemsColumns 3 · itemStyle plain · logoColor mono"
source: webpixels/logos-2
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# logos · grid

**预设名：** Grid（`blocks/logos/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中、正常大标题；logo 按列数等宽格子（1440 三列、手机两列），统一灰度

**旋钮：** introPosition top · introAlign center · introSize lg · itemsLayout grid · itemsColumns 3 · itemStyle plain · logoColor mono。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/logos-2（定稿图册 logos 段，`docs/reference/webpixels/gallery/gen-logos.py` + `build.py`；Chris 2026-09-30）
