---
order: 3
summary: "webpixels/contact-1 · 预设 Map beside = introPosition beside · introAlign left · sidePosition right · form none · formStyle card · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · map beside"
source: webpixels/contact-1
layout_intent:
  items: stack
  media: side
  columns: two
  align: start
  ratio: even
  media_side: end
---

# contact-new · map-beside

**预设名：** Map beside（`blocks/contact-new/manifest.json` 的 `presets`）

**长什么样：** 块头放在联系方式那一列最上面；右边一列是地图（点之前是地址卡 + Open map），两列各半；没有表单

**旋钮：** introPosition beside · introAlign left · sidePosition right · form none · formStyle card · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · map beside。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/contact-1（定稿图册 contact 段，`docs/reference/webpixels/gallery/gen-contact.py` + `build.py`；Chris 2026-09-29）
