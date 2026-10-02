---
order: 5
summary: "—（图册自拼） · 预设 Photo cards = introPosition top · introAlign center · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle card · itemAlign left · itemIcon none · itemImage top · itemConnector none"
source: —（图册自拼）
layout_intent:
  media: above
  columns: three
  align: stretch
  ratio: none
  media_side: none
---

# features · photo-cards

**预设名：** Photo cards（`blocks/features/manifest.json` 的 `presets`）

**长什么样：** 三列卡片，每张卡片顶上一张照片（没有图标）

**旋钮：** introPosition top · introAlign center · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle card · itemAlign left · itemIcon none · itemImage top · itemConnector none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** —（图册自拼）（定稿图册 features 段，`docs/reference/webpixels/gallery/gen-features.py` + `build.py`）
