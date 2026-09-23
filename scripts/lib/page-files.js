'use strict';

// page-files.js —— 一个站的每个页面 JSON 住在哪个文件（#1409 从 sync-config.js 搬出来）。
//
// 🔴 这是「slug → 文件」的**唯一一份**实现，构建和编辑器页共用它。搬出来的理由：编辑器页（#1409）
//    存盘时要把整份页面 JSON 写回**那一个文件**，而 slug 和文件名并不总是同一个东西 ——
//    `pages/` 顶层的页面 slug 取自文件**内容**里的 `slug`，只有子目录里的页面才按路径拼
//    （`services/brakes.json` → `services/brakes`）。两边各写一份的话，编辑器会在某个站上把改动
//    写进一个构建根本不读的文件，而保存照样「成功」。
//
// 行为与搬家之前逐字相同：递归读 `pages/`，任何一层的 `.json` 都是一个页面；子目录里的页面
// 用路径覆盖内容里的 slug；`sourceBySlug` 记下每个 slug 是从哪个文件读出来的（#1026）。

const fs = require('fs');
const path = require('path');

// #1026 —— `sourceBySlug` 记下每个页面是从哪个文件读出来的。sitemap 的 <lastmod> 要问那个文件
// 上次什么时候变的，而这里是唯一还知道文件路径的地方（下面的流程只剩页面对象）。
function readPagesRecursive(dir, prefix, accumulator, sourceBySlug) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      readPagesRecursive(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, accumulator, sourceBySlug);
    } else if (entry.name.endsWith('.json')) {
      const filePath = path.join(dir, entry.name);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (prefix) {
        const baseName = entry.name.replace(/\.json$/, '');
        content.slug = `${prefix}/${baseName}`;
      }
      accumulator.push(content);
      if (sourceBySlug) sourceBySlug.set(content.slug, filePath);
    }
  }
}

module.exports = { readPagesRecursive };
