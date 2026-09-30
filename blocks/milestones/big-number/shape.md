---
order: 4
summary: "webpixels/milestones-8 · 预设 Big number = blockImage none · introPosition bottom · introAlign center · introImage none · statsColumns 1 · statSize xl · statStyle plain · statAlign center"
source: webpixels/milestones-8
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# milestones · big-number

**预设名：** Big number（`blocks/milestones/manifest.json` 的 `presets`）

**长什么样：** 一个特大数字 + 一行话，块头在下，配深 bg

**旋钮：** blockImage none · introPosition bottom · introAlign center · introImage none · statsColumns 1 · statSize xl · statStyle plain · statAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/milestones-8（定稿图册 milestones 段，`docs/reference/webpixels/gallery/gen-milestones.py` + `build.py`）
