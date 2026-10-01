---
order: 2
summary: "图册 logos 段（无 Webpixels 对应） · 预设 Cards = introPosition top · introAlign center · introSize lg · itemsLayout grid · itemsColumns 3 · itemStyle card · logoColor original"
source: 图册 logos 段（无 Webpixels 对应）
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# logos-new · cards

**预设名：** Cards（`blocks/logos-new/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中、正常大标题；每个 logo 一张白卡（描边、圆角），三列，原色

**旋钮：** introPosition top · introAlign center · introSize lg · itemsLayout grid · itemsColumns 3 · itemStyle card · logoColor original。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 图册 logos 段（无 Webpixels 对应）（定稿图册 logos 段，`docs/reference/webpixels/gallery/gen-logos.py` + `build.py`；Chris 2026-09-30）
