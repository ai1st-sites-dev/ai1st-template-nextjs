---
order: 4
summary: "webpixels/features-7 · features-8 · 预设 Photo list = introPosition top · introAlign center · introImage none · itemsLayout list · itemsColumns 3 · itemsImage left · itemStyle plain · itemAlign left · itemIcon left · itemImage none · itemConnector none"
source: webpixels/features-7 · features-8
layout_intent:
  media: side
  columns: one
  align: start
  ratio: even
  media_side: start
---

# features-new · photo-list

**预设名：** Photo list（`blocks/features-new/manifest.json` 的 `presets`）

**长什么样：** 块头居中；照片在左，右边一项一行的列表（图标在文字左边）

**旋钮：** introPosition top · introAlign center · introImage none · itemsLayout list · itemsColumns 3 · itemsImage left · itemStyle plain · itemAlign left · itemIcon left · itemImage none · itemConnector none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/features-7 · features-8（定稿图册 features 段，`docs/reference/webpixels/gallery/gen-features.py` + `build.py`）
