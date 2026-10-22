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
//   电话 / 地址原来只管第一家门店（`locations[0].phone` / `.address` 两行）；#1980 起换成整份 `locations`（每一家都能改）。
//   #1738 —— headerOptions / footerOptions 也是 `site` 档：顶栏 / 页脚的底色 + 旋钮，值是一个对象（形状与校验在
//   `region-options.js`），整份换。空对象 = 删掉那个键（回到主题 / 预设的默认）。预设本身仍是 headerShape / footerShape 那两行。
//   #1759 —— 顶栏 Content 页：logoUrl（`brand.json`，整站一份，空串 = 删掉，顶栏画名字）· headerButtons（#1787：这种语言的
//   `navigation.json` 的 `header.buttons`，值是 `[{label, href}]`，0–3 颗，规则在 `header-buttons.js`）。
//   #1780 —— headerTopbar（这种语言的 `navigation.json` 的 `header.topbarLinks`）：顶栏上面那一行的链接列表 `[{label, href}]`，
//   `href` 是字符串或电话 / 邮箱引用；规则（默认值、能不能存、怎么画）全在 `topbar-links.js`。
//   #1781 —— headerLinks（这种语言的 `navigation.json` 的 `header.links`）：菜单是老板自己的一份列表 `[{label, href}]`，
//   `href` 是字符串或电话 / 邮箱引用；判据在 `editor-root.js` §checkShape（话跟浏览器那一侧 `nav-editor.js` 同一句）。
//   🔴 navigation.json 只许钉这三个键：`navigation-owned.js` 那道门守的是 AI 聊天那条路，编辑器这条路不经过它 ——
//      构建会重写的那几处（页脚第一列 = 菜单的拷贝、`header.knownPages`、页脚有几栏）在这张表里一行都不许有。

const ROOT_FIELDS = [
  { field: 'layout', scope: 'site', file: 'page-layout.json', key: ['layoutId'] },
  { field: 'headerShape', scope: 'site', file: 'theme.json', key: ['regionLayout', 'header'] },
  { field: 'footerShape', scope: 'site', file: 'theme.json', key: ['regionLayout', 'footer'] },
  { field: 'headerOptions', scope: 'site', file: 'theme.json', key: ['regionOptions', 'header'] },
  { field: 'footerOptions', scope: 'site', file: 'theme.json', key: ['regionOptions', 'footer'] },
  { field: 'brandName', scope: 'site', file: 'brand.json', key: ['name', '{locale}'] },
  { field: 'email', scope: 'site', file: 'brand.json', key: ['email'] },
  // #1980 —— Website settings 的 Locations 区：整份地点数组（电话 / 地址从 Name & contact 挪进来，每一家自己一份）。
  //    形状与校验在 `editor-root.js` §locationsProblem；写盘按 id 跟盘上那一家合（§mergeLocations：坐标 / slug / 评价不归编辑器）。
  { field: 'locations', scope: 'site', file: 'brand.json', key: ['locations'] },
  { field: 'logoUrl', scope: 'site', file: 'brand.json', key: ['logoUrl'] },
  { field: 'headerButtons', scope: 'locale', file: 'navigation.json', key: ['header', 'buttons'] },
  { field: 'headerTopbar', scope: 'locale', file: 'navigation.json', key: ['header', 'topbarLinks'] },
  // #1785 —— Website settings 的 Social links：整站一份，一律写成数组 `[{platform, url}]`（空了 = 删掉这个键）。
  { field: 'socialLinks', scope: 'site', file: 'brand.json', key: ['socialLinks'] },
  { field: 'headerLinks', scope: 'locale', file: 'navigation.json', key: ['header', 'links'] },
  // #1945 —— Website settings 的 Search result（首页那一份）：这种语言的 `seo.json`。`seoMode` 只有 `"custom"` 一个值，没有这个键 = 自动。
  //    子页的标题 / 描述 / 模式**不在这张表里**：它们住在那一页自己的 JSON 里，由 `editor-convert.js` §puckToPage 写（那份文件只许一个写者）。
  { field: 'siteTitle', scope: 'locale', file: 'seo.json', key: ['siteTitle'] },
  { field: 'siteDescription', scope: 'locale', file: 'seo.json', key: ['siteDescription'] },
  { field: 'seoMode', scope: 'locale', file: 'seo.json', key: ['seoMode'] },
];

module.exports = { ROOT_FIELDS };
