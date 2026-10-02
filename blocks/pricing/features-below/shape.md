---
order: 3
summary: "webpixels/pricing-5b · 预设 Features below = introPosition top · introAlign center · plansColumns auto · planFeatures below · planStyle card · planAlign left · planCta top · featured background"
source: webpixels/pricing-5b
layout_intent:
  media: none
  columns: many
  align: center
  ratio: even
  media_side: none
---

# pricing · features-below

**预设名：** Features below（`blocks/pricing/manifest.json` 的 `presets`）

**长什么样：** 块头居中在上，卡里只有名字 / 价格 / 说明 / 按钮，功能清单在卡下面；高亮那张铺底色

**旋钮：** introPosition top · introAlign center · plansColumns auto · planFeatures below · planStyle card · planAlign left · planCta top · featured background。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/pricing-5b（定稿图册 pricing 段，`docs/reference/webpixels/gallery/gen-pricing.py` + `build.py`）
