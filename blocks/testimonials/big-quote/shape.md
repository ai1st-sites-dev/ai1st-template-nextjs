---
order: 2
summary: "webpixels/testimonials-2 · testimonials-2b · 预设 Big quote = introPosition top · introAlign center · summaryStyle inline · itemsLayout carousel · itemsColumns 1 · itemStyle plain · quoteSize lg · itemAlign center"
source: webpixels/testimonials-2 · testimonials-2b
layout_intent:
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# testimonials · big-quote

**预设名：** Big quote（`blocks/testimonials/manifest.json` 的 `presets`）

**长什么样：** 一次一条的大字引言轮播，居中，圆点和按钮叠在引言下面

**旋钮：** introPosition top · introAlign center · summaryStyle inline · itemsLayout carousel · itemsColumns 1 · itemStyle plain · quoteSize lg · itemAlign center。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/testimonials-2 · testimonials-2b（定稿图册 testimonials 段，`docs/reference/webpixels/gallery/gen-testimonials.py` + `build.py`）
