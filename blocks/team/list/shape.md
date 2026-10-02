---
order: 3
summary: "webpixels/team-5 · 预设 List = introPosition top · introAlign left · membersColumns 2 · memberPhoto left · photoShape circle · memberStyle plain · memberAlign left"
source: webpixels/team-5
layout_intent:
  media: none
  columns: many
  align: start
  ratio: none
  media_side: none
---

# team · list

**预设名：** List（`blocks/team/manifest.json` 的 `presets`）

**长什么样：** 块头靠左在上，成员两列横排：圆头像在左、字在右

**旋钮：** introPosition top · introAlign left · membersColumns 2 · memberPhoto left · photoShape circle · memberStyle plain · memberAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/team-5（定稿图册 team 段，`docs/reference/webpixels/gallery/gen-team.py` + `build.py`）
