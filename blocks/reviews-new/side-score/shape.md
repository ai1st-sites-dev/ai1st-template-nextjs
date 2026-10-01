---
order: 1
summary: "Chris 2026-09-30 截图 · 预设 Side score = introPosition left · introAlign left · total show · itemsLayout grid · itemStyle card · itemAlign center"
source: Chris 2026-09-30 截图
layout_intent:
  items: grid
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# reviews-new · side-score

**预设名：** Side score（`blocks/reviews-new/manifest.json` 的 `presets`）

**长什么样：** 块头在左侧一列（sticky），正文下面一行总分（大数字 + 五星 + 「405 reviews on 4 platforms」）；右边平台卡片 2 × 2

**旋钮：** introPosition left · introAlign left · total show · itemsLayout grid · itemStyle card · itemAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** Chris 2026-09-30 截图（定稿图册 reviews 段，`docs/reference/webpixels/gallery/gen-reviews.py` + `build.py`；Chris 2026-09-30）
