---
order: 0
summary: "webpixels/milestones-1 · milestones-6 · 预设 Row = blockImage none · introPosition top · introAlign center · introImage none · statsColumns auto · statSize md · statStyle divided · statAlign center"
source: webpixels/milestones-1 · milestones-6
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# milestones · divided-row

**预设名：** Row（`blocks/milestones/manifest.json` 的 `presets`）

**长什么样：** 一排数字、相邻之间竖线分隔，块头在上居中

**旋钮：** blockImage none · introPosition top · introAlign center · introImage none · statsColumns auto · statSize md · statStyle divided · statAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/milestones-1 · milestones-6（定稿图册 milestones 段，`docs/reference/webpixels/gallery/gen-milestones.py` + `build.py`）
