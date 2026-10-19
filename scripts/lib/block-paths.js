'use strict';
// #1838 (SiteAsData T4b) —— 块目录和块注册表在哪：全仓只问这一个函数（设计文档 §8.5「假块进测试不进产品」）。
//
//   blocksDir(rootDir)     `<模板根>/blocks`；设了 `AI1ST_BLOCKS_DIR` ⟹ 用它
//   registryPath(rootDir)  `<模板根>/src/lib/sections/registry.generated.ts`；设了 `AI1ST_REGISTRY_PATH` ⟹ 用它
//
// 两个环境变量只给测试用：假块 A / B（`scripts/fixtures/blocks/`）拼进一份临时块目录、`build-blocks.js --blocks-dir --out`
// 生成一份临时注册表，再让 `save` / `editor-data` / `render` 三条路整条改道过去 —— 假块从不进 `blocks/`、不进生成物。
// 🔴 改道是整个进程一起改：这三条路上读块目录 / 注册表的地方一律经这里，漏一处就是「这条路上有一半在读真块」。
//    `rootDir` 只在没设环境变量时起作用（守卫在临时模板树里跑时传它自己的根）。
const path = require('path');

const TEMPLATE_DIR = path.resolve(__dirname, '..', '..');

function blocksDir(rootDir = TEMPLATE_DIR) {
  const env = process.env.AI1ST_BLOCKS_DIR;
  return env ? path.resolve(env) : path.join(rootDir, 'blocks');
}

function registryPath(rootDir = TEMPLATE_DIR) {
  const env = process.env.AI1ST_REGISTRY_PATH;
  return env ? path.resolve(env) : path.join(rootDir, 'src', 'lib', 'sections', 'registry.generated.ts');
}

module.exports = { blocksDir, registryPath, TEMPLATE_DIR };
