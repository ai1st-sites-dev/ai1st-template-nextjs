---
order: 3
summary: "webpixels/contact-1 · 预设 Map beside = introPosition beside · introAlign left · sidePosition right · form none · formStyle card · image none · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · locationsLayout grid · locationStyle card · map beside"
source: webpixels/contact-1
layout_intent:
  items: stack
  media: side
  columns: two
  align: start
  ratio: even
  media_side: end
---

# contact · map-beside

**预设名：** Map beside（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 一个地点时左边联系方式、右边一张大地图（地址卡，点了才加载）；多个地点时不画大地图，每家一张白卡片、卡里按钮上面一张小地图卡

**旋钮：** introPosition beside · introAlign left · sidePosition right · form none · formStyle card · image none · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · locationsLayout grid · locationStyle card · map beside。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。一个地点 / 多个地点由站点数据决定，不是旋钮（#1978）。

**出处：** webpixels/contact-1（定稿图册 contact 一格，Chris 2026-10-20 定稿，#1978）
