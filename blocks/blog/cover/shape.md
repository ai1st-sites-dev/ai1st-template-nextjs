---
order: 5
summary: "webpixels/blog section-1c · 预设 Cover = introPosition top · introAlign center · itemsLayout grid · itemsColumns 3 · itemStyle card · itemImage background"
source: webpixels/blog section-1c
layout_intent:
  media: cover
  columns: three
  align: stretch
  ratio: even
  media_side: none
---

# blog · cover

**预设名：** Cover（`blocks/blog/manifest.json` 的 `presets`）

**长什么样：** 封面铺满整张卡，底部深色渐变、白字压在图上

**旋钮：** introPosition top · introAlign center · itemsLayout grid · itemsColumns 3 · itemStyle card · itemImage background。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/blog section-1c（定稿图册 blog 段，`docs/reference/webpixels/gallery/gen-blog.py` + `build.py`）
