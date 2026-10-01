---
order: 4
summary: "webpixels/team-4 · 预设 Hiring = introPosition top · introAlign center · membersColumns 3 · memberPhoto top · photoShape circle · memberStyle card · memberAlign left · 部件 join"
source: webpixels/team-4
layout_intent:
  media: none
  columns: many
  align: center
  ratio: none
  media_side: none
---

# team-new · hiring

**预设名：** Hiring（`blocks/team-new/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，成员三列白卡，圆头像、字靠左，最后一格是招聘卡（虚线框 + 图标圈 + 描边按钮）

**旋钮：** introPosition top · introAlign center · membersColumns 3 · memberPhoto top · photoShape circle · memberStyle card · memberAlign left。**部件：** join（招聘卡）—— 判「是不是这个预设」时 `join` 也要有内容。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/team-4（定稿图册 team 段，`docs/reference/webpixels/gallery/gen-team.py` + `build.py`）
