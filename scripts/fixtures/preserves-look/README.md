# preservesLook 尺子的夹具（#1918，测试专用）

`scripts/preserves-look.js` ① 尺子自检用。**不进 `blocks/`、不进任何生成物**（同 `../blocks/README.md` 的规矩）。

| 目录 | 是什么 | 给谁用 |
|---|---|---|
| `fake-a-v1/` | 假块 fake-a 的 **v1**：`schemaVersion: 1`、没有 `migrations.js`、画 `data.headline` | 「前」那一侧：拼进解开的 release 包里一份临时块目录，用**包里的** `site.js bundle --blocks-dir` 打包 |

「后」那一侧用 `../blocks/fake-a`（v2，`1→2` 只把 `headline` 改名 `title`，样子不变）：

- **反向格**原样用它 ⟹ 尺子要读绿。
- **标定格**在运行时拷一份、给块根加一条 `background-color`（`preserves-look.js` §lookChanged），迁移照旧标 `true` ⟹ 尺子要读红，并点名 `background-color`。

两份画出来的标记逐字相同（`<h2 data-fake-title="">`）—— v1 改了标记，反向格就会因为结构不同而红，那就不是在测迁移了。
