# 假块 A / B（#1838，测试专用）

只给测试拼进一份**临时块目录**用（`scripts/lib/block-schema-versions.test.js` §fakeBlocksDir：真 `blocks/` 整份拷过去 + 这两个），
再 `build-blocks.js --blocks-dir <那份> --out <临时目录>` 生成一份临时注册表，`AI1ST_BLOCKS_DIR` / `AI1ST_REGISTRY_PATH`
让 `save` / `editor-data` / `render` 整条改道过去（`scripts/lib/block-paths.js`）。**不进 `blocks/`、不进任何生成物。**

| 块 | 当前版 | 画得了 | 迁移 |
|---|---|---|---|
| `fake-a` | 2 | 1、2 | `1→2`：`data.headline` 改名 `data.title`，`preservesLook: true`（测试会临时把它改成 `false` 再跑一遍） |
| `fake-b` | 3 | 3 | 没有 —— 画布新插它，落库要带 `schemaVersion: 3`（跟真块的 1 分得开） |
