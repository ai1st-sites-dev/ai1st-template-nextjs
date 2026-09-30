---
order: 1
summary: "webpixels/contact-3 · 预设 Details beside = introPosition top · introAlign center · sidePosition left · form full · formStyle plain · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · map none"
source: webpixels/contact-3
layout_intent:
  items: stack
  media: none
  columns: two
  align: start
  ratio: major-start
  media_side: none
---

# contact-new · details-beside

**预设名：** Details beside（`blocks/contact-new/manifest.json` 的 `presets`）

**长什么样：** 块头占满顶上一行、居中；下面两列：左边整张表单（不带卡），右边联系方式一行一条

**旋钮：** introPosition top · introAlign center · sidePosition left · form full · formStyle plain · itemsLayout list · itemStyle plain · itemAlign left · itemIcon left · map none。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/contact-3（定稿图册 contact 段，`docs/reference/webpixels/gallery/gen-contact.py` + `build.py`；Chris 2026-09-29）
