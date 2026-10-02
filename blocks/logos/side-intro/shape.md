---
order: 3
summary: "webpixels/logos-4 · 预设 Side intro = introPosition left · introAlign left · introSize sm · itemsLayout grid · itemsColumns 3 · itemStyle plain · logoColor mono"
source: webpixels/logos-4
layout_intent:
  media: none
  columns: two
  align: center
  ratio: major-end
  media_side: none
---

# logos · side-intro

**预设名：** Side intro（`blocks/logos/manifest.json` 的 `presets`）

**长什么样：** 块头在左一列（小字标题），logo 三列等宽格子在右，两列垂直居中；统一灰度

**旋钮：** introPosition left · introAlign left · introSize sm · itemsLayout grid · itemsColumns 3 · itemStyle plain · logoColor mono。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/logos-4（定稿图册 logos 段，`docs/reference/webpixels/gallery/gen-logos.py` + `build.py`；Chris 2026-09-30）
