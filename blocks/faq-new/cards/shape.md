---
order: 2
summary: "webpixels/faq-2 · faq-2b · 预设 Cards = introPosition top · introAlign center · itemsMode accordion · itemsColumns 2 · itemStyle card · itemToggle chevron"
source: webpixels/faq-2 · faq-2b
layout_intent:
  items: grid
  media: none
  columns: two
  align: center
  ratio: even
  media_side: none
---

# faq-new · cards

**预设名：** Cards（`blocks/faq-new/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中；问答两列，每条一张白底描边卡片，点问句展开

**旋钮：** introPosition top · introAlign center · itemsMode accordion · itemsColumns 2 · itemStyle card · itemToggle chevron。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/faq-2 · faq-2b（定稿图册 faq 段，`docs/reference/webpixels/gallery/gen-faqs.py` + `build.py`；Chris 2026-09-29）
