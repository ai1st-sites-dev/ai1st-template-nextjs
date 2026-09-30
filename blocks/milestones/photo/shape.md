---
order: 2
summary: "图册 Photo（块头带图，同 features 的 Intro photo） · 预设 Photo = blockImage none · introPosition top · introAlign left · introImage left · statsColumns auto · statSize md · statStyle plain · statAlign left"
source: 图册 Photo（块头带图，同 features 的 Intro photo）
layout_intent:
  media: side
  columns: many
  align: start
  ratio: none
  media_side: start
---

# milestones · photo

**预设名：** Photo（`blocks/milestones/manifest.json` 的 `presets`）

**长什么样：** 块头左边一张图，数字一排在下

**旋钮：** blockImage none · introPosition top · introAlign left · introImage left · statsColumns auto · statSize md · statStyle plain · statAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 图册 Photo（块头带图，同 features 的 Intro photo）（定稿图册 milestones 段，`docs/reference/webpixels/gallery/gen-milestones.py` + `build.py`）
