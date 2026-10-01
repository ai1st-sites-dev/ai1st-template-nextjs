---
order: 1
summary: "webpixels/testimonials-5 · 预设 Side intro = introPosition left · introAlign left · summaryStyle inline · itemsLayout carousel · itemsColumns 2 · itemStyle card · quoteSize md · itemAlign left"
source: webpixels/testimonials-5
layout_intent:
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# testimonials-new · side-intro

**预设名：** Side intro（`blocks/testimonials-new/manifest.json` 的 `presets`）

**长什么样：** 块头在左侧一列（sticky），右边两条一屏的卡片轮播

**旋钮：** introPosition left · introAlign left · summaryStyle inline · itemsLayout carousel · itemsColumns 2 · itemStyle card · quoteSize md · itemAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/testimonials-5（定稿图册 testimonials 段，`docs/reference/webpixels/gallery/gen-testimonials.py` + `build.py`）
