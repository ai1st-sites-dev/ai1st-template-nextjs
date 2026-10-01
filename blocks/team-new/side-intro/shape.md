---
order: 2
summary: "webpixels/team-3 · 预设 Side intro = introPosition left · introAlign left · membersColumns 2 · memberPhoto top · photoShape square · memberStyle plain · memberAlign left"
source: webpixels/team-3
layout_intent:
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# team-new · side-intro

**预设名：** Side intro（`blocks/team-new/manifest.json` 的 `presets`）

**长什么样：** 块头在左一列（sticky），成员两列在右，方图、字靠左

**旋钮：** introPosition left · introAlign left · membersColumns 2 · memberPhoto top · photoShape square · memberStyle plain · memberAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/team-3（定稿图册 team 段，`docs/reference/webpixels/gallery/gen-team.py` + `build.py`）
