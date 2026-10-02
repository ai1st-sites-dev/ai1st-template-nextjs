---
order: 1
summary: "webpixels/faq-1 · 预设 Side intro = introPosition left · introAlign left · itemsMode accordion · itemsColumns 1 · itemStyle divided · itemToggle plus"
source: webpixels/faq-1
layout_intent:
  items: stack
  headline: side
  media: none
  columns: one
  align: start
  ratio: major-end
  media_side: none
---

# faq · side-intro

**预设名：** Side intro（`blocks/faq/manifest.json` 的 `presets`）

**长什么样：** 块头在左一列（≥992 占 41.67%、sticky），问答在右一列、细线分隔，开合图标是 plus / minus

**旋钮：** introPosition left · introAlign left · itemsMode accordion · itemsColumns 1 · itemStyle divided · itemToggle plus。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/faq-1（定稿图册 faq 段，`docs/reference/webpixels/gallery/gen-faqs.py` + `build.py`；Chris 2026-09-29）
