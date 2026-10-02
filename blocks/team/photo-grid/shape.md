---
order: 0
summary: "webpixels/team-1 · 预设 Photo grid = introPosition top · introAlign center · membersColumns 4 · memberPhoto top · photoShape square · memberStyle plain · memberAlign left"
source: webpixels/team-1
layout_intent:
  media: none
  columns: many
  align: center
  ratio: none
  media_side: none
---

# team · photo-grid

**预设名：** Photo grid（`blocks/team/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，成员四列，每人一张占满格宽的方图、字靠左

**旋钮：** introPosition top · introAlign center · membersColumns 4 · memberPhoto top · photoShape square · memberStyle plain · memberAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/team-1（定稿图册 team 段，`docs/reference/webpixels/gallery/gen-team.py` + `build.py`）
