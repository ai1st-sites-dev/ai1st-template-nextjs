'use strict';
// #1838 —— 假块 fake-a 的迁移（测试专用，见上一层 README）：v1 的 `data.headline` 在 v2 叫 `data.title`，样子不变。
module.exports = {
  '1→2': {
    preservesLook: true,
    migrate: (block) => {
      const { headline, ...rest } = block.data || {};
      return { ...block, data: { ...rest, ...(headline !== undefined ? { title: headline } : {}) } };
    },
  },
};
