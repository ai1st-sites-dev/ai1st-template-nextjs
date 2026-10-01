---
order: 2
summary: "定稿图册 reviews 段 · 预设 Strip = introPosition top · introAlign center · total none · itemsLayout row · itemStyle card · itemAlign center"
source: 定稿图册 reviews 段
layout_intent:
  items: row
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# reviews-new · strip

**预设名：** Strip（`blocks/reviews-new/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中；平台是一行紧凑的小条（logo · 分数 · 星 + 条数叠在右边），按各自宽度排、居中、放不下折行

**旋钮：** introPosition top · introAlign center · total none · itemsLayout row · itemStyle card · itemAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 定稿图册 reviews 段（定稿图册 reviews 段，`docs/reference/webpixels/gallery/gen-reviews.py` + `build.py`；Chris 2026-09-30）
