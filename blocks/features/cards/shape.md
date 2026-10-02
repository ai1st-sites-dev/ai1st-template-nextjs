---
order: 1
summary: "webpixels/features-5 · features-11 · features-12 · 预设 Cards = introPosition top · introAlign center · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle card · itemAlign left · itemIcon top · itemImage none · itemConnector none"
source: webpixels/features-5 · features-11 · features-12
layout_intent:
  media: none
  columns: three
  align: stretch
  ratio: none
  media_side: none
---

# features · cards

**预设名：** Cards（`blocks/features/manifest.json` 的 `presets`）

**长什么样：** 三列卡片，块头在上居中

**旋钮：** introPosition top · introAlign center · introImage none · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle card · itemAlign left · itemIcon top · itemImage none · itemConnector none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/features-5 · features-11 · features-12（定稿图册 features 段，`docs/reference/webpixels/gallery/gen-features.py` + `build.py`）
