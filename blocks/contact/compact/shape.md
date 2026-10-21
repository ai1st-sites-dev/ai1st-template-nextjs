---
order: 4
summary: "图册自拼 · 预设 Compact = introPosition top · introAlign center · sidePosition right · form none · formStyle card · image none · itemsLayout grid · itemStyle plain · itemAlign center · itemIcon left · locationsLayout list · locationStyle plain · map none"
source: —（图册自拼）
layout_intent:
  items: grid
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# contact · compact

**预设名：** Compact（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 首页底部的窄条：块头在顶上、居中，一个地点时联系方式排成一行（不带卡）；多个地点时一家一行，那一列够宽时压成一行（名称 · 地址 · 营业时间 · 电话 · 邮箱 · Call）

**旋钮：** introPosition top · introAlign center · sidePosition right · form none · formStyle card · image none · itemsLayout grid · itemStyle plain · itemAlign center · itemIcon left · locationsLayout list · locationStyle plain · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。一个地点 / 多个地点由站点数据决定，不是旋钮（#1978）。

**出处：** —（图册自拼）（定稿图册 contact 一格，Chris 2026-10-20 定稿，#1978）
