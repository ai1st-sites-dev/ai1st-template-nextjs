'use strict';

// editor-root-fields.js —— 编辑器 Page 面板的 root 字段（#1405 外壳三样；#1425 起公告条那一样退役；#1681 加「Business info」四样）的
// **分派表**：每个 root 字段住在哪个文件的哪个键上、是整站一份还是按语言一份。纯数据、零依赖，因为两边都要读它：
//   · 站里的写盘那一侧（`lib/editor-root.js`，node）照它把字段写回站级文件
//   · 编辑器那一侧（`lib/editor-convert.js` → 浏览器）照它决定 Puck root 里有哪些字段、存盘时比哪几个
// 🔴 这是唯一的一份。少一行 ⟹ 那个字段编辑器里没有、写盘也不认；往返守卫（`editor-root.test.js` ①）
//    按字段名逐个写一遍再读回来，少了谁点谁的名。
//
// 为什么这么分（#1405 票正文做什么 4）：
//   layout / headerShape / footerShape 是**整站一份**（三语一起变）。`scope: 'locale'` 这一档今天没有字段
//   （原来是公告条文字 `topbarMessage` / `topbarLink`，#1425 T3 随公告条那个区退役），写盘那一侧照旧认它。
//   #1681 —— brandName / email / phone / address 也是 `site` 档：`brand.json` 整站只有一份（`site/brand.json`，
//   `sync-config.js` 与 `lib/dress-site-in-theme.js` 都从站根读；每种语言必须有的文件里没有它）。「按语言」的只有
//   网站名字，而它是在**文件里面**按语言（`name` 是一张 `{语言: 名字}` 的表），不在目录上 ⟹ 键里写 `'{locale}'`，
//   由写盘 / 读值那一侧换成这次存盘的语言（扁平站 = 默认语言）。这张表里只放占位符，不放解析它的代码。
//   电话 / 地址只管第一家门店（`locations[0]`）：建站只生成一家（#1681 不做）。

const ROOT_FIELDS = [
  { field: 'layout', scope: 'site', file: 'page-layout.json', key: ['layoutId'] },
  { field: 'headerShape', scope: 'site', file: 'theme.json', key: ['regionLayout', 'header'] },
  { field: 'footerShape', scope: 'site', file: 'theme.json', key: ['regionLayout', 'footer'] },
  { field: 'brandName', scope: 'site', file: 'brand.json', key: ['name', '{locale}'] },
  { field: 'phone', scope: 'site', file: 'brand.json', key: ['locations', 0, 'phone'] },
  { field: 'email', scope: 'site', file: 'brand.json', key: ['email'] },
  { field: 'address', scope: 'site', file: 'brand.json', key: ['locations', 0, 'address'] },
];

module.exports = { ROOT_FIELDS };
