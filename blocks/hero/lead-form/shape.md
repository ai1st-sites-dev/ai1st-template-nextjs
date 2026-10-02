---
order: 3
summary: "webpixels/section-hero-6 · 预设 Lead form = textAlign left · image left · form full"
source: webpixels/section-hero-6
layout_intent:
  media: side
  columns: two
  align: start
  ratio: even
  media_side: start
---

# hero · lead-form

**预设名：** Lead form（`blocks/hero/manifest.json` 的 `presets`）

**长什么样：** 文字右、图在左，文字块里一张表单（姓名 / 电话 + 需求 + 提交）

**旋钮：** textAlign left · image left · form full。这是一个**预设**，不是一份单独的 markup：形态目录只决定「旋钮从哪一组值起」，
`options` 里写了的旋钮逐个覆盖它（`scripts/lib/block-knobs.js` §effectiveKnobs）；拧偏了编辑器显示 custom，
`data-shape` 仍是这个目录。

**出处：** webpixels/section-hero-6

**表单字段 ↔ Customers 列**（#1471 起露哪些字段由块选的那张**站级表单**定 —— `site/<locale>/forms.json`，`form` 槽里只有
它的 `id`，空 = 第一张：`teaser` 露那张表单的 `primary`，`full` 露它的全部 `fields`；站没有 forms.json 时用 `BlockLeadForm` 的
内置默认值：`teaser` 露 `phone`，`full` 露 `name` / `phone` / `service`。提交 POST `/api/leads`（带 `meta.formId`），落进 `leads`
表那一行，Customers 页读的就是它）：

| 字段 | 表单上是 | 落进 `leads` 的哪一列 |
|---|---|---|
| `name` | 姓名输入框 | `name` |
| `phone` | 电话输入框 | `phones` |
| `email` | 邮箱输入框 | `emails` |
| `message` | 留言输入框 | `message` |
| `service` | 需求下拉（选项 = 站内服务列表） | 没有这一列 —— 照 `quote-form` 的做法折进 `message` 的第一行 `Service: …` |

`source` 恒为 `contact-form`（`manager/form_channel.go` 的 `formLeadSources` 是封闭词表，不新造值）。
这张表对五个预设都成立：任何预设把 `form` 旋钮拧到 teaser / full，用的都是同一个表单部件（`src/components/BlockLeadForm.tsx`，四个带表单的块共用）。
