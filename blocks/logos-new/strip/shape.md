---
order: 0
summary: "webpixels/logos-1 · logos-2 · 预设 Strip = introPosition top · introAlign center · introSize sm · itemsLayout row · itemsColumns 4 · itemStyle plain · logoColor mono"
source: webpixels/logos-1 · logos-2
layout_intent:
  items: row
  media: none
  columns: one
  align: center
  ratio: none
  media_side: none
---

# logos-new · strip

**预设名：** Strip（`blocks/logos-new/manifest.json` 的 `presets`）

**长什么样：** 块头在上居中、一行小字标题 + 小号正文；logo 按各自宽度一行排开、居中、放不下换行，统一灰度

**旋钮：** introPosition top · introAlign center · introSize sm · itemsLayout row · itemsColumns 4 · itemStyle plain · logoColor mono。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/logos-1 · logos-2（定稿图册 logos 段，`docs/reference/webpixels/gallery/gen-logos.py` + `build.py`；Chris 2026-09-30）
