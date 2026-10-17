# site-fixtures —— SiteAsData 的样板站（「库里一行 JSON」的形状，`export-site-json.js` 导出）

| 夹具 | 是什么 | 怎么来的 |
|---|---|---|
| `site-0448c807.json` | SparkleClean，英文单语 | 2026-10-12 spike 导的真站（#1804 起顶栏是 `header.buttons`） |
| `site-bbc4ff97.json` | Petal & Bloom，英文单语 | 同上（#1804 给 home 的 logos 第 6 项补了 alt） |
| `site-multilang.json` | 英 + 法双语 | `make-fixture.sh payload-multilang.json site-multilang` |
| `site-blog.json` | 英文，5 篇博客 + 社交链接 + 顶条链接 + 顶条 / logo 旋钮 | `make-fixture.sh payload-blog.json site-blog`（`payload-blog.patch.json` 补进 skipAI 写不进去的那三样） |
| `site-zh.json` | 中文主语言 + 阿拉伯语 + 繁体中文（#1801：`1660-editor-fill.spec.ts` 原来那个 zh 演示站） | `make-fixture.sh payload-zh.json site-zh` |
| `site-rtl.json` | 阿拉伯语（从右往左） | `make-fixture.sh payload-rtl.json site-rtl` |

**重新造**：在 `templates/nextjs/` 下 `bash scripts/fixtures/site-fixtures/make-fixture.sh <payload> <输出名>`。skipAI 建站（不调 AI、不要 key），在模板树的临时副本里跑，模板根的 `site/` 不碰；同一份 payload 重跑出来逐字节相同。`create-site.js` 的 skipAI 内容变了，重造一遍再提交。

**夹具里的年份是固定的**：页脚版权一律写成 `© 2026`（脚本导出前归一，跨年重造也不变）。`build-report.json` 不进夹具。

**`site_meta.json` 里的 `leadApi` / `siteId` 只是夹具自带的值**（`leadApi` 恒为空），新路渲染时以 `--lead-api` 为准（设计文档 §6.1）。
