---
order: 2
summary: "图册自拼 · 预设 Stacked = introPosition top · introAlign center · sidePosition bottom · form full · formStyle card · itemsLayout grid · itemStyle card · itemAlign center · itemIcon top · map none"
source: —（图册自拼）
layout_intent:
  items: grid
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# contact · stacked

**预设名：** Stacked（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 块头居中；联系方式排成网格、每条一张卡、内容居中、图标在上；表单在最下面，装在卡里，最宽 40rem、居中

**旋钮：** introPosition top · introAlign center · sidePosition bottom · form full · formStyle card · itemsLayout grid · itemStyle card · itemAlign center · itemIcon top · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 图册自己的组合（没有对应的 Webpixels 原型）（定稿图册 contact 段，`docs/reference/webpixels/gallery/gen-contact.py` + `build.py`；Chris 2026-09-29）
