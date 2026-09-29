---
order: 2
summary: "Bootstrap features with title · webpixels/features-6 · features-1c · 预设 Side intro = introPosition left · introAlign left · introImage none · itemsLayout grid · itemsColumns 2 · itemsImage none · itemStyle card · itemAlign left · itemIcon top · itemImage none · itemConnector none"
source: Bootstrap features with title · webpixels/features-6 · features-1c
layout_intent:
  media: none
  columns: two
  align: stretch
  ratio: even
  media_side: none
---

# features-new · side-intro

**预设名：** Side intro（`blocks/features-new/manifest.json` 的 `presets`）

**长什么样：** 块头在左一列（桌面 sticky），右边两列卡片

**旋钮：** introPosition left · introAlign left · introImage none · itemsLayout grid · itemsColumns 2 · itemsImage none · itemStyle card · itemAlign left · itemIcon top · itemImage none · itemConnector none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** Bootstrap features with title · webpixels/features-6 · features-1c（定稿图册 features 段，`docs/reference/webpixels/gallery/gen-features.py` + `build.py`）
