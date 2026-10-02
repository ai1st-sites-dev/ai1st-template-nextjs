---
order: 0
summary: "webpixels/testimonials-4 · testimonials-4b · 预设 Cards = introPosition top · introAlign center · summaryStyle inline · itemsLayout grid · itemsColumns 3 · itemStyle card · quoteSize md · itemAlign left"
source: webpixels/testimonials-4 · testimonials-4b
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# testimonials · cards

**预设名：** Cards（`blocks/testimonials/manifest.json` 的 `presets`）

**长什么样：** 全部摊开的卡片网格，一行三条，块头在上居中

**旋钮：** introPosition top · introAlign center · summaryStyle inline · itemsLayout grid · itemsColumns 3 · itemStyle card · quoteSize md · itemAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/testimonials-4 · testimonials-4b（定稿图册 testimonials 段，`docs/reference/webpixels/gallery/gen-testimonials.py` + `build.py`）
