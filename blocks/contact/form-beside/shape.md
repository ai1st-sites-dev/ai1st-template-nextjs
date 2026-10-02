---
order: 0
summary: "webpixels/contact-2 · 预设 Form beside = introPosition beside · introAlign left · sidePosition right · form full · formStyle card · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · map none"
source: webpixels/contact-2
layout_intent:
  items: stack
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# contact · form-beside

**预设名：** Form beside（`blocks/contact/manifest.json` 的 `presets`）

**长什么样：** 块头放在联系方式那一列最上面、左对齐；联系方式一行一条（图标在左）；右边一列是整张表单，装在白底卡里

**旋钮：** introPosition beside · introAlign left · sidePosition right · form full · formStyle card · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/contact-2（定稿图册 contact 段，`docs/reference/webpixels/gallery/gen-contact.py` + `build.py`；Chris 2026-09-29）
