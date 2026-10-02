---
order: 0
summary: "webpixels/reviews-1 · 预设 Cards = introPosition top · introAlign center · total none · itemsLayout grid · itemStyle card · itemAlign center"
source: webpixels/reviews-1
layout_intent:
  items: grid
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# reviews · cards

**预设名：** Cards（`blocks/reviews/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中；平台一排等宽浅灰卡片（有几个平台一行几个，最多 4 个），卡里竖排 logo · 大分数 · 星 · 条数、居中

**旋钮：** introPosition top · introAlign center · total none · itemsLayout grid · itemStyle card · itemAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/reviews-1（定稿图册 reviews 段，`docs/reference/webpixels/gallery/gen-reviews.py` + `build.py`；Chris 2026-09-30）
