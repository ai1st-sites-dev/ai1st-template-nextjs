---
order: 0
summary: "webpixels/contact-2 · 预设 Form beside = introPosition beside · introAlign left · sidePosition right · form full · formStyle card · image yes · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · locationsLayout list · locationStyle plain · map none"
source: webpixels/contact-2
layout_intent:
  items: stack
  media: side
  columns: two
  align: start
  ratio: major-end
  media_side: end
---

# contact · form-beside

**预设名：** Form beside（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 块头放在联系方式那一列最上面、左对齐；一个地点时联系方式一行一条（图标在左），多个地点时一家一行（分隔线）；右边一列上面一张店面图、下面整张表单（白底卡）

**旋钮：** introPosition beside · introAlign left · sidePosition right · form full · formStyle card · image yes · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · locationsLayout list · locationStyle plain · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。一个地点 / 多个地点由站点数据决定，不是旋钮（#1978）。

**出处：** webpixels/contact-2（定稿图册 contact 一格，Chris 2026-10-20 定稿，#1978）
