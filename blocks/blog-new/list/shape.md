---
order: 2
summary: "webpixels/blog-list-1 · 预设 List = introPosition top · introAlign left · itemsLayout list · itemsColumns 3 · itemStyle plain · itemImage left"
source: webpixels/blog-list-1
layout_intent:
  media: side
  columns: one
  align: start
  ratio: none
  media_side: start
---

# blog-new · list

**预设名：** List（`blocks/blog-new/manifest.json` 的 `presets`）

**长什么样：** 一篇一行、占满整列：封面在左（最宽 20rem），块头靠左

**旋钮：** introPosition top · introAlign left · itemsLayout list · itemsColumns 3 · itemStyle plain · itemImage left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/blog-list-1（定稿图册 blog 段，`docs/reference/webpixels/gallery/gen-blog.py` + `build.py`）
