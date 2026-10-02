---
order: 3
summary: "webpixels/features-9 · features-10 · features-14 · 预设 Intro photo = introPosition top · introAlign left · introImage right · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle card · itemAlign left · itemIcon top · itemImage none · itemConnector none"
source: webpixels/features-9 · features-10 · features-14
layout_intent:
  media: side
  columns: three
  align: stretch
  ratio: none
  media_side: end
---

# features · intro-photo

**预设名：** Intro photo（`blocks/features/manifest.json` 的 `presets`）

**长什么样：** 块头文字在左、照片在右，下面三列卡片

**旋钮：** introPosition top · introAlign left · introImage right · itemsLayout grid · itemsColumns 3 · itemsImage none · itemStyle card · itemAlign left · itemIcon top · itemImage none · itemConnector none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/features-9 · features-10 · features-14（定稿图册 features 段，`docs/reference/webpixels/gallery/gen-features.py` + `build.py`）
