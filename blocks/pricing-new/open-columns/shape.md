---
order: 2
summary: "webpixels/pricing-5 · 预设 Open columns = introPosition top · introAlign center · plansColumns auto · planFeatures inside · planStyle divided · planAlign left · planCta top · featured background"
source: webpixels/pricing-5
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# pricing-new · open-columns

**预设名：** Open columns（`blocks/pricing-new/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，套餐无框、之间一条竖线，高亮那个铺底色

**旋钮：** introPosition top · introAlign center · plansColumns auto · planFeatures inside · planStyle divided · planAlign left · planCta top · featured background。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/pricing-5（定稿图册 pricing 段，`docs/reference/webpixels/gallery/gen-pricing.py` + `build.py`）
