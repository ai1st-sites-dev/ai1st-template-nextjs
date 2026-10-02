---
order: 3
summary: "webpixels/faq-3 · 预设 Open grid = introPosition top · introAlign left · itemsMode open · itemsColumns 3 · itemStyle plain · itemToggle chevron"
source: webpixels/faq-3
layout_intent:
  items: grid
  media: none
  columns: three
  align: start
  ratio: even
  media_side: none
---

# faq · open-grid

**预设名：** Open grid（`blocks/faq/manifest.json` 的 `presets`）

**长什么样：** 块头在上左对齐；问答三列全部展开（问句 + 答案直接写出来，没有开合）

**旋钮：** introPosition top · introAlign left · itemsMode open · itemsColumns 3 · itemStyle plain · itemToggle chevron。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/faq-3（定稿图册 faq 段，`docs/reference/webpixels/gallery/gen-faqs.py` + `build.py`；Chris 2026-09-29）
