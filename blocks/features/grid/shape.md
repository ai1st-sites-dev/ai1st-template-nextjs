---
order: 0
summary: "Bootstrap columns with icons · webpixels/features-1 · features-2 · 预设 Grid = introPosition top · introAlign left · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle plain · itemAlign left · itemIcon top · itemImage none · itemConnector none"
source: Bootstrap columns with icons · webpixels/features-1 · features-2
layout_intent:
  media: none
  columns: three
  align: start
  ratio: none
  media_side: none
---

# features · grid

**预设名：** Grid（`blocks/features/manifest.json` 的 `presets`）

**长什么样：** 平铺三列，图标在上、文字在下，块头在上左对齐

**旋钮：** introPosition top · introAlign left · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle plain · itemAlign left · itemIcon top · itemImage none · itemConnector none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** Bootstrap columns with icons · webpixels/features-1 · features-2（定稿图册 features 段，`docs/reference/webpixels/gallery/gen-features.py` + `build.py`）
