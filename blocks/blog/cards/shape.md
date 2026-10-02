---
order: 1
summary: "webpixels/blog section-1b · 预设 Cards = introPosition top · introAlign center · itemsLayout grid · itemsColumns 3 · itemStyle card · itemImage top"
source: webpixels/blog section-1b
layout_intent:
  media: above
  columns: three
  align: stretch
  ratio: even
  media_side: none
---

# blog · cards

**预设名：** Cards（`blocks/blog/manifest.json` 的 `presets`）

**长什么样：** 三张卡：封面在上、白卡描边，块头居中

**旋钮：** introPosition top · introAlign center · itemsLayout grid · itemsColumns 3 · itemStyle card · itemImage top。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/blog section-1b（定稿图册 blog 段，`docs/reference/webpixels/gallery/gen-blog.py` + `build.py`）
