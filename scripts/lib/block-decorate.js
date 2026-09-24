'use strict';

// block-decorate.js —— 归一化之后、写进 config 之前，构建给每个块补的两个字段（#1415 从 sync-config.js 搬出来）。
//
//   · `has`   —— 块 manifest 里 required:false 且填了的槽位（#1331）。`blockAttrs.ts` 把每个名字送成
//                `data-has-<名字>="true"`，给 shapes.css 和守卫用，替代 `:has()`（设计文档 D4）。
//                不看主题：它说的是这个站的内容填了什么，跟穿哪套主题无关。
//   · `shape` —— 这个块戴哪个形态（#1318，三级取值在 `block-shape.js` §shapeForBlock）。选择单从
//                `structureThemeId` 取（「这个站穿的是哪套主题」）：注册表里查不到的 id 回空表而不是
//                打死构建，候选流水线那条路必须活着。
//
// 🔴 为什么要搬出来：编辑器（#1415）在运行时要拿到**跟构建同一份**的块 —— 画布戴哪个形态读的就是块上的
//    `shape`（`editor-convert.js` §pageToPuck），缺了它就落回 manifest 默认，穿 azure-29 的站打开编辑器
//    版式会整片换掉。manager 的探针在站容器里现算，调的就是这个函数。**别在探针或别处再抄一遍这两段**：
//    以后谁改补字段的规则只改一处，编辑器就和构建对不上，而且没有任何东西会红。
//
// 入参 `pagesByLocale` 是 `{ <locale>: 归一化之后的页面数组 }`（sync-config 那份，或者探针只放一种语言），
// 就地改块。`log` 收这一步要说的全部话：两行汇总，外加 §shapeForBlock 的「落回默认」那几行（已带上页名），
// 顺序跟搬家前 sync-config 打的逐行相同（先 `has` 的汇总，再形态那几行）。探针传一个空函数 —— 它的 stdout
// 只许有那一份 JSON。
// 回 `{ carried, shaped }`：补了 `has` / `shape` 的块数。

const { loadBlockManifests } = require('../blocks');
const blockManifest = require('./block-manifest');
const { shapeForBlock } = require('./block-shape');
const { shapesFor } = require('../themes');

function decorateBlocks(pagesByLocale, { rootDir, structureThemeId, log = (line) => console.log(line) } = {}) {
  const manifests = loadBlockManifests(rootDir);
  const locales = Object.keys(pagesByLocale);
  let carried = 0;
  for (const locale of locales) {
    for (const page of pagesByLocale[locale]) {
      for (const block of page.blocks) {
        const m = manifests[block.type];
        if (!m) continue;
        const has = blockManifest.filledOptionalSlots(m, block.data);
        if (has.length > 0) { block.has = has; carried++; }
      }
    }
  }
  log(`  data-has-*: ${carried} block(s) carry at least one filled optional slot`);
  let shaped = 0;
  if (structureThemeId) {
    const selection = shapesFor(structureThemeId);
    for (const locale of locales) {
      for (const page of pagesByLocale[locale]) {
        for (const block of page.blocks) {
          // #1331 —— 落回默认那一行带上页名：同一种块（hero）几页都有，不带页名就说不清是哪一块落回了。
          const shape = shapeForBlock(block, selection, manifests,
            (line) => log(line.replace(/^(\s*⚠️\s*)块 /, `$1页 ${page.slug || locale}: 块 `)));
          if (shape) { block.shape = shape; shaped++; }
        }
      }
    }
    // 🔴 #1121 —— 这行以前写的是「colors + fonts + N section variant(s)」，而颜色和字体已经不
    // 从这里来了。日志说的话必须跟代码做的事一样，否则下一个读构建日志的人会以为覆盖还在。
    // 📌 #1341 —— 「N section variant(s)」那一半也没了：这里原来还按主题的 `supports` 往每个块写
    //    `data.variant`（内容结构那一维），整条退役了。今天这段只写 `shape`。
    log(`  Theme "${structureThemeId}": ${shaped} block shape(s)`
      + ' —— 颜色 / 字体 / 风格设定来自这个站自己的 brand.json，不从注册表来');
  }
  return { carried, shaped };
}

module.exports = { decorateBlocks };
