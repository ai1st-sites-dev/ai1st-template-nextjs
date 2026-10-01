---
order: 0
summary: "webpixels/faq-1b · 预设 Accordion = introPosition top · introAlign center · itemsMode accordion · itemsColumns 1 · itemStyle divided · itemToggle chevron"
source: webpixels/faq-1b
layout_intent:
  items: stack
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# faq-new · accordion

**预设名：** Accordion（`blocks/faq-new/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中；问答一列、占满整列，条与条之间一根细线，点问句展开答案（chevron）

**旋钮：** introPosition top · introAlign center · itemsMode accordion · itemsColumns 1 · itemStyle divided · itemToggle chevron。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/faq-1b（定稿图册 faq 段，`docs/reference/webpixels/gallery/gen-faqs.py` + `build.py`；Chris 2026-09-29）
