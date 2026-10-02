---
order: 5
summary: "webpixels/pricing-1 · pricing-4（带颜色） · 预设 Rainbow = introPosition top · introAlign center · plansColumns auto · planFeatures inside · planStyle card · planAlign left · planCta top · featured outline（带颜色）"
source: webpixels/pricing-1 · pricing-4（带颜色）
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# pricing · rainbow

**预设名：** Rainbow（`blocks/pricing/manifest.json` 的 `presets`）

**长什么样：** 同 Plan cards 的排法，整段紫→金渐变底 + 高亮卡渐变描边（唯一带颜色的预设）

**旋钮：** introPosition top · introAlign center · plansColumns auto · planFeatures inside · planStyle card · planAlign left · planCta top · featured outline；颜色 bg = featuredColor = 紫→金渐变（`{stops:['#7d52f4','#f7b733'], angle:135}`）。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。颜色不跟形态走：`bg` / `featuredColor` 是 data 顶层的两个颜色槽，点这个预设时一并设上（§presetColors）。

**出处：** webpixels/pricing-1 · pricing-4（带颜色）（定稿图册 pricing 段，`docs/reference/webpixels/gallery/gen-pricing.py` + `build.py`）
