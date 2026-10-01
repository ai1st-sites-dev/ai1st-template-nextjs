---
order: 3
summary: "webpixels/blog section-2 · 预设 Featured = introPosition top · introAlign left · itemsLayout featured · itemsColumns 3 · itemStyle plain · itemImage left"
source: webpixels/blog section-2
layout_intent:
  media: above
  columns: two
  align: start
  ratio: major-start
  media_side: none
---

# blog-new · featured

**预设名：** Featured（`blocks/blog-new/manifest.json` 的 `presets`）

**长什么样：** 第一篇大（左 7/12，封面在上），其余在右边一列（封面在左）

**旋钮：** introPosition top · introAlign left · itemsLayout featured · itemsColumns 3 · itemStyle plain · itemImage left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/blog section-2（定稿图册 blog 段，`docs/reference/webpixels/gallery/gen-blog.py` + `build.py`）
