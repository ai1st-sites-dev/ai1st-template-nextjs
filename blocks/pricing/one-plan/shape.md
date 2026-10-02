---
order: 4
summary: "webpixels/pricing-6 · pricing-6b · 预设 One plan = introPosition left · introAlign left · plansColumns 1 · planFeatures inside · planStyle card · planAlign left · planCta bottom · featured outline"
source: webpixels/pricing-6 · pricing-6b
layout_intent:
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# pricing · one-plan

**预设名：** One plan（`blocks/pricing/manifest.json` 的 `presets`）

**长什么样：** 块头在左一列，右边一张单套餐宽卡（清单分两列），按钮通栏贴底

**旋钮：** introPosition left · introAlign left · plansColumns 1 · planFeatures inside · planStyle card · planAlign left · planCta bottom · featured outline。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/pricing-6 · pricing-6b（定稿图册 pricing 段，`docs/reference/webpixels/gallery/gen-pricing.py` + `build.py`）
