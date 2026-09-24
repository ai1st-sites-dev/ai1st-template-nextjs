'use strict';

// editor-root-fields.js —— 编辑器外壳四样（#1405）的**分派表**：每个 root 字段住在哪个文件的哪个键上、
// 是整站一份还是按语言一份。纯数据、零依赖，因为两边都要读它：
//   · 站里的写盘那一侧（`lib/editor-root.js`，node）照它把字段写回站级文件
//   · 编辑器那一侧（`lib/editor-convert.js` → 浏览器）照它决定 Puck root 里有哪些字段、存盘时比哪几个
// 🔴 这是唯一的一份。少一行 ⟹ 那个字段编辑器里没有、写盘也不认；往返守卫（`editor-root.test.js` ②）
//    按字段名逐个写一遍再读回来，少了谁点谁的名。
//
// 为什么这么分（票正文做什么 4）：
//   layout / headerShape / footerShape 是**整站一份**（三语一起变）；topbarMessage / topbarLink 是文案，
//   **按语言一份**（只变当前语言）。

/** @type {{ field: string, scope: 'site' | 'locale', file: 'page-layout.json' | 'theme.json' | 'navigation.json', key: string[] }[]} */
const ROOT_FIELDS = [
  { field: 'layout', scope: 'site', file: 'page-layout.json', key: ['layoutId'] },
  { field: 'headerShape', scope: 'site', file: 'theme.json', key: ['regionLayout', 'header'] },
  { field: 'footerShape', scope: 'site', file: 'theme.json', key: ['regionLayout', 'footer'] },
  { field: 'topbarMessage', scope: 'locale', file: 'navigation.json', key: ['topbar', 'message'] },
  { field: 'topbarLink', scope: 'locale', file: 'navigation.json', key: ['topbar', 'link'] },
];

module.exports = { ROOT_FIELDS };
