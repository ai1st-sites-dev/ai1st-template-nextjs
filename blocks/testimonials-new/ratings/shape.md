---
order: 4
summary: "webpixels/reviews-1 · 预设 Ratings = introPosition top · introAlign left · summaryStyle cards · itemsLayout grid · itemsColumns 3 · itemStyle card · quoteSize md · itemAlign left · 带部件 summary"
source: webpixels/reviews-1
layout_intent:
  media: none
  columns: many
  align: start
  ratio: even
  media_side: none
---

# testimonials-new · ratings

**预设名：** Ratings（`blocks/testimonials-new/manifest.json` 的 `presets`，#1500）

**长什么样：** 块头在上靠左；评价上面一排平台卡（logo · 五星 · 「4.9 out of 5」· 「from 312 reviews」），下面是卡片网格，一行三条

**旋钮：** introPosition top · introAlign left · summaryStyle cards · itemsLayout grid · itemsColumns 3 · itemStyle card · quoteSize md · itemAlign left。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**部件：** 这个预设带 `summary`（预设条目的 `parts: ["summary"]`，规则同 team-new 的 Hiring）：`summary` 有内容才判成 Ratings；
点 Ratings 时 `summary` 为空就用槽上的 `demo` 占位填上；点别的预设不删 `summary`。

**出处：** webpixels/reviews-1（定稿图册 testimonials 段，`docs/reference/webpixels/gallery/gen-testimonials.py` + `build.py`）
