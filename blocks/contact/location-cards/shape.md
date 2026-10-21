---
order: 1
summary: "图册自拼 · 预设 Location cards = introPosition top · introAlign center · sidePosition right · form none · formStyle card · image none · itemsLayout grid · itemStyle card · itemAlign center · itemIcon top · locationsLayout grid · locationStyle card · map none"
source: —（图册自拼）
layout_intent:
  items: grid
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# contact · location-cards

**预设名：** Location cards（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 块头在顶上、居中；没有侧列。一个地点时联系方式排成卡片网格（图标在上、居中）；多个地点时每家一张白卡片，一行三张 → 两张 → 一张

**旋钮：** introPosition top · introAlign center · sidePosition right · form none · formStyle card · image none · itemsLayout grid · itemStyle card · itemAlign center · itemIcon top · locationsLayout grid · locationStyle card · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。一个地点 / 多个地点由站点数据决定，不是旋钮（#1978）。

**出处：** —（图册自拼）（定稿图册 contact 一格，Chris 2026-10-20 定稿，#1978）
