---
order: 1
summary: "webpixels/pricing-2 · pricing-3 · 预设 Side intro = introPosition left · introAlign left · plansColumns 2 · planFeatures inside · planStyle card · planAlign left · planCta top · featured outline"
source: webpixels/pricing-2 · pricing-3
layout_intent:
  media: none
  columns: two
  align: start
  ratio: major-end
  media_side: none
---

# pricing · side-intro

**预设名：** Side intro（`blocks/pricing/manifest.json` 的 `presets`）

**长什么样：** 块头在左一列（sticky），套餐两列白卡在右

**旋钮：** introPosition left · introAlign left · plansColumns 2 · planFeatures inside · planStyle card · planAlign left · planCta top · featured outline。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/pricing-2 · pricing-3（定稿图册 pricing 段，`docs/reference/webpixels/gallery/gen-pricing.py` + `build.py`）
