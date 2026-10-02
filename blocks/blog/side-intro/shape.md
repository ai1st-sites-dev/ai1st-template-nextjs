---
order: 4
summary: "图册 Side intro · 预设 Side intro = introPosition left · introAlign left · itemsLayout grid · itemsColumns 2 · itemStyle plain · itemImage top"
source: 图册 Side intro
layout_intent:
  media: above
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# blog · side-intro

**预设名：** Side intro（`blocks/blog/manifest.json` 的 `presets`）

**长什么样：** 块头一列在左（1/3，sticky），文章两列在右，封面在上

**旋钮：** introPosition left · introAlign left · itemsLayout grid · itemsColumns 2 · itemStyle plain · itemImage top。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** 图册 Side intro（定稿图册 blog 段，`docs/reference/webpixels/gallery/gen-blog.py` + `build.py`）
