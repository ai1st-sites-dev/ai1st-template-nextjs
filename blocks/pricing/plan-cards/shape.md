---
order: 0
summary: "webpixels/pricing-1 · pricing-4 · 预设 Plan cards = introPosition top · introAlign center · plansColumns auto · planFeatures inside · planStyle card · planAlign left · planCta top · featured outline"
source: webpixels/pricing-1 · pricing-4
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# pricing · plan-cards

**预设名：** Plan cards（`blocks/pricing/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，套餐一行均分成白卡，高亮那张 2px 描边

**旋钮：** introPosition top · introAlign center · plansColumns auto · planFeatures inside · planStyle card · planAlign left · planCta top · featured outline。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/pricing-1 · pricing-4（定稿图册 pricing 段，`docs/reference/webpixels/gallery/gen-pricing.py` + `build.py`）
