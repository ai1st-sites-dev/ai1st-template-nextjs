---
order: 4
summary: "webpixels/section-hero-1 · 预设 Text only = textAlign left · image none · form none"
source: webpixels/section-hero-1
layout_intent:
  media: none
  columns: one
  align: start
  ratio: none
  media_side: none
---

# hero · text-only

**预设名：** Text only（`blocks/hero/manifest.json` 的 `presets`）

**长什么样：** 不渲染图，文字块占 2/3 宽

**旋钮：** textAlign left · image none · form none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-1

**表单：** 把 `form` 旋钮拧到 teaser / full 时，字段词表与 Customers 列的对应见 `../lead-form/shape.md`。
