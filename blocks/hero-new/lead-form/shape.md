---
order: 3
summary: "webpixels/section-hero-6 · 预设 Lead form = align left · image normal · form stacked"
source: webpixels/section-hero-6
layout_intent:
  media: side
  columns: two
  align: start
  ratio: even
  media_side: end
---

# hero-new · lead-form

**预设名：** Lead form（`blocks/hero-new/manifest.json` 的 `presets`）

**长什么样：** 文字左、图在右，文字块里一张表单（姓名 / 电话 + 需求 + 提交）

**旋钮：** align left · image normal · form stacked。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-6

**表单字段词表 ↔ Customers 列**（`form.fields` 只能从 `manifest.json` 的 `slots.form.choices.fields` 里挑；
提交 POST `/api/leads`，落进 `leads` 表那一行，Customers 页读的就是它）：

| `fields` 里写 | 表单上是 | 落进 `leads` 的哪一列 |
|---|---|---|
| `name` | 姓名输入框 | `name` |
| `phone` | 电话输入框 | `phones` |
| `email` | 邮箱输入框 | `emails` |
| `message` | 留言输入框 | `message` |
| `service` | 需求下拉（选项 = 站内服务列表） | 没有这一列 —— 照 `quote-form` 的做法折进 `message` 的第一行 `Service: …` |

`source` 恒为 `contact-form`（`manager/form_channel.go` 的 `formLeadSources` 是封闭词表，不新造值）。
这张表对五个预设都成立：任何预设把 `form` 旋钮拧到 inline / stacked，用的都是同一个表单部件（`HeroNewForm.tsx`）。
