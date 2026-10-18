'use strict';
// #1829 (SiteAsData T3a) —— 给 content 里的每一块盖上它这一型的 schemaVersion（设计文档 §8.4 ①）。
// T4b 填实；今天是恒等空壳 —— 接口先定下来，调用方（`site.js create`）先接上，T4b 填实时调用方一个字不改。
//   prev  这一笔之前的 content（建站没有之前，传 null）
//   next  这一笔之后的 content
//   返回  盖过版本号的 next
function stampSchemaVersions(prev, next) { // T4b 填实
  return next;
}

module.exports = { stampSchemaVersions };
