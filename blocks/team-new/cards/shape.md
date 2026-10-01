---
order: 1
summary: "webpixels/team-2 · 预设 Cards = introPosition top · introAlign center · membersColumns 2 · memberPhoto top · photoShape circle · memberStyle card · memberAlign center"
source: webpixels/team-2
layout_intent:
  media: none
  columns: many
  align: center
  ratio: none
  media_side: none
---

# team-new · cards

**预设名：** Cards（`blocks/team-new/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，成员两列白卡，圆头像、字居中

**旋钮：** introPosition top · introAlign center · membersColumns 2 · memberPhoto top · photoShape circle · memberStyle card · memberAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/team-2（定稿图册 team 段，`docs/reference/webpixels/gallery/gen-team.py` + `build.py`）
