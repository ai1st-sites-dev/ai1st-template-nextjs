---
order: 3
summary: "webpixels/milestones-7 · 预设 Photo side = blockImage right · introPosition top · introAlign center · introImage none · statsColumns 2 · statSize md · statStyle card · statAlign center"
source: webpixels/milestones-7
layout_intent:
  media: side
  columns: two
  align: center
  ratio: major-start
  media_side: end
---

# milestones · photo-side

**预设名：** Photo side（`blocks/milestones/manifest.json` 的 `presets`）

**长什么样：** 整块旁边一张图（图在右），块头居中 + 两列卡片

**旋钮：** blockImage right · introPosition top · introAlign center · introImage none · statsColumns 2 · statSize md · statStyle card · statAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/milestones-7（定稿图册 milestones 段，`docs/reference/webpixels/gallery/gen-milestones.py` + `build.py`）
