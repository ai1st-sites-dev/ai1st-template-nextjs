---
order: 2
summary: "图册自拼 · 预设 Photo beside = introPosition beside · introAlign left · sidePosition right · form none · formStyle card · image yes · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · locationsLayout list · locationStyle plain · map none"
source: —（图册自拼）
layout_intent:
  items: stack
  media: side
  columns: two
  align: start
  ratio: even
  media_side: end
---

# contact · photo-beside

**预设名：** Photo beside（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 左边块头 + 联系方式 / 地点（一行一条 / 一家一行），右边一张大店面图占满那一列

**旋钮：** introPosition beside · introAlign left · sidePosition right · form none · formStyle card · image yes · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · locationsLayout list · locationStyle plain · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。一个地点 / 多个地点由站点数据决定，不是旋钮（#1978）。

**出处：** —（图册自拼）（定稿图册 contact 一格，Chris 2026-10-20 定稿，#1978）
