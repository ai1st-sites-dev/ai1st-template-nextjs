// #978 阶段 0 — 每个渲染出来的 block 带两个定位钩子，theme 的 CSS 只能靠它们点名一个 block。
//
// 契约在 `docs/reference/theme-css-contract.md` §1（#991 立的 v1）：一份 theme 就是一张样式表，
// 它能选中的东西只有钩子，不许写标签选择器、不许 nth-child、不许深挖 DOM 形状。所以钩子必须
// 真的在每个 block 的根元素上 —— 在这个文件落地之前，产物里带 data-block 的只有 hero 的中性
// markup 那一支（#991，而它只在 site/theme.json 带 css 字段时才走 ⟹ 今天的站一个都没有）。
//
// 🔴 为什么是「每个 variant 的根元素各展开一次」而不是在 SectionRenderer 外面包一层：包一层要多一个
// DOM 元素，而本票的承诺是「产物每块多两个属性、视觉逐像素不变」。多出来的那个 <div> 会让 HTML 的
// 差异不再只是两个属性；而且 block 是 <main> 的直接子元素，多一层就把 order 那一层挪走了。
//
// 🔴 为什么每个 variant 都要带：当时 34 个组件一共 134 个根元素（hero 9 个、content-split 6 个，
// 另一个显示一排数字的块也是 6 个 —— 它已在 #1376 按 D19 并进 `social-proof`；每种写法一支早返回）。只给默认那一支加钩子的话，theme 挑了别的写法，那块就没有钩子 ——
// 而这种失败是静默的：页面照样好看，只是 theme 的 CSS 点不到它。`blockRootCoverage()`（978 的 spec）
// 逐支数这件事。
import blockRoles from './block-roles.json';
import type { BlockConfig } from '@/lib/types/config';

export type BlockRole = 'essential' | 'lead' | 'optional';

// 兜底默认表 —— 每种 block 类型一个角色。
//
// 🔴 #998：数据搬到了 `block-roles.json`，这里只剩它的说明和读它的代码。为什么要搬：`create-site.js`
// 写页面 JSON 时要把 `role` 填进去（#998 的 AC1），而那是个 CommonJS 的 node 脚本，读不了 .ts。
// 两边各抄一份表就是「两个地方要记得改」——正是本文件下面那条注释在防的事。JSON 两边都读得了
// （tsconfig 有 resolveJsonModule；node 直接 require），所以表只有一份。
//
// 三个角色的意思（spec §4.2，原话）：
//   essential  不许隐藏。承载结构化数据和 AI 能回答的事实（contact / services / areas / hours / faq）
//   lead       这门生意的主角，不许被挤出前 N 个位置
//   optional   装饰，theme 随便动
//
// 🔴 essential 那 7 个是照上面那句括号里的清单点出来的，不是我按感觉挑的：
//   contact-info    联系方式 + 营业时间（contact / hours）
//   contact-form    客人真正联系我们的那条路（268b 的 POST /api/leads）—— 藏掉它等于关掉获客
//   quote-form      同上，另一种表单
//   services-list   services；而且 `SubPage.tsx:14` 拿「这页有没有它」当 Service 结构化标记的开关
//   services-nav    services（进各服务页的入口）
//   map-area        areas（areaServed）
//   faq-accordion   faq
//
// 🔴 这张表跟那 30 套 theme 真在藏的东西**零交集**，我数过（那次 `rhythm.hide` 的并集是 8 个块：
// announcement-bar · divider · newsletter-signup · logo-carousel · trusted-brands · blog-preview ·
// social-proof，外加那个显示一排数字的块 —— 它已在 #1376 按 D19 并进 `social-proof`，所以这里不再
// 写它的名字；那次读数本身没变，零交集这个结论也没变）。要是有交集，就会出现「预览里挡住了不许藏，Apply 之后 sync-config
// 又真的把它藏了」——两个地方对同一件事给出相反答案，而那正是本票要治的那类假象。
//
// 📌 lead 只有 hero：spec §4.2 说 lead 是「这门生意的主角」，那是**每个生意各不相同**的判断，由建站
// AI 在默认之上加标记（阶段 2 的内容层，spec §4.1 的 `role` 字段）。类型这一层能确定的只有 hero ——
// 它按构造就是开场那一块。本票不对 lead 做任何强制（spec 里「不许挤出前 N」是构建期校验的事）。
export const BLOCK_ROLES: Record<string, BlockRole> = blockRoles as Record<string, BlockRole>;

export interface BlockAttrs {
  'data-block': string;
  'data-role': BlockRole;
  /** #1349 — 这个块在它那一页里的名字。点选检查器（dashboard 的编辑模式）靠它把「用户点中的那个
   *  DOM 元素」跟「页面 JSON 里的那条记录」对上，后面三张票（形态下拉 / 显隐排序 / 文字直改）
   *  都拿它回头去改那条记录。
   *  🔴 **它是标识，不是画法钩子。** 主题表不许写它的选择器 —— `scripts/theme-css-lint.js` 的
   *  `EDITOR_ATTRS` 点名拒绝，理由与写法在 `docs/reference/theme-css-contract.md` 那一段。
   *  🔴 值不在这里算：`scripts/blocks.js` 的 `generatedBlockId()` 是唯一算它的地方（建站写盘和
   *  构建期归一化两条路都调它），这里跟 `shape` / `has` 一样只负责把写下的值送到 DOM。 */
  'data-block-id'?: string;
  /** #1318 — 这个块排成什么样。`public/shapes.css` 靠 `[data-block][data-shape]` 点名。 */
  'data-shape'?: string;
  /** #1331 — 可选槽位填了没：manifest 里 required:false 且填了的每个槽位一个 `data-has-<槽位>="true"`。 */
  [has: `data-has-${string}`]: 'true' | undefined;
}

// 🔴 表里没有这个类型时给 'essential'，不是 'optional'。两个方向的错法不对称：
// 标成 optional = theme 可以把它藏了，而没人会发现（spec D4 点名的那个静默失败）；
// 标成 essential = theme 动不了它，页面上多一块，肉眼就看得见。所以往安全那边错。
// （真正的防线是 978 spec 里那格「这张表的键集合 == 注册表的键集合」，新加 block 忘了标会当场红。）
//
// #998 加了第二个参数 `block` —— 这个块在页面 JSON 里的那条记录。它带来两件事：
//
//   data-role         页面 JSON 自己写的 `role` 优先，没写才落回上面那张类型级默认表。
//                     spec §4.6：「兜底默认表定底线，建站 AI 只能加不能降级」——「不能降级」那一半
//                     的校验在 #999（建站脚本内），这里只负责让写下的那个值真的到达 DOM。
//
// 🔴 #1341 —— #998 那第三个钩子（「内容结构」：这个块有没有配图 / 带不带表单）**退役了**，这个函数
// 不再输出它，页面 JSON 里那个同名的键也不再被读。那件事今天由另外两样接管：可选槽位填没填由
// `data-has-<槽位>` 说（#1331），带表单的首屏是自己一个块类型 `hero-with-form`（#1333）。老站磁盘上
// 残留的那个键在 `scripts/blocks.js` 读的时候丢掉 —— 不报错，也不落成属性。
// 📌 这几行**有意不写出那个属性名和那个字段名**：验收第 1 条要求这个文件对那条 grep 零命中
//    （「这个文件里一点痕迹都不许剩」是那一条要的读数）。名字本身在 `docs/reference/theme-css-contract.md`
//    §1 那一段和 `scripts/theme-css-lint.js` 的退役钩子规则里，两处都查得到。
export function blockAttrs(type: string, block?: BlockConfig): BlockAttrs {
  const role = block && block.role ? block.role : (BLOCK_ROLES[type] || 'essential');
  const attrs: BlockAttrs = { 'data-block': type, 'data-role': role };
  // #1349 — `data-block-id`。跟下面 `shape` / `has` 两段逐字同一个分工：值由构建期算好写进页面 JSON
  // （`scripts/blocks.js` §generatedBlockId），这里**不再算一遍**。
  // 🔴 没有就一个字符都不多，不造兜底值：造一个的话，一个「其实没人给过 id」的块在编辑器里会得到
  // 一个看起来正常、却指不回任何一条页面 JSON 记录的名字 —— 而那是静默的（点得中、改不动）。
  if (block && typeof block.id === 'string' && block.id) {
    attrs['data-block-id'] = block.id;
  }
  // #1318 — `data-shape`，这个块排成什么样。
  // 📌 #1341 之前它旁边还有 #998 那第三个钩子（内容结构：这个块有没有配图），两个钩子并存、
  //    各说一件事；那一维退役之后只剩这一个。
  //
  // 🔴 `block.shape` 是 `sync-config.js` 在构建时按 spec D18 的三级算好写进页面 JSON 的，这里
  // **不再算一遍**：同一个判据两份实现，分叉的方向是静默的（构建按一份选、DOM 上带的是另一份，
  // 而页面照样打开）。这里只负责让写下的那个值真的到达 DOM —— 跟上面 `role` 那一行同一个分工。
  //
  // 🔴 没写就一个字符都不多，而且不给它造兜底值（#1341 之前退役的那一维也是这条规矩）：
  // 造一个的话 `[data-shape="default"]` 会选中一批「其实没人选过画法」的块，而那是静默的。
  if (block && typeof block.shape === 'string' && block.shape) {
    attrs['data-shape'] = block.shape;
  }
  // #1331 — `data-has-<槽位>="true"`，每个填了的可选槽位一个。名单 `block.has` 是 `sync-config.js` 构建时按
  // manifest（`required: false` + 填了）算好的，这里**不再算**，理由跟上面 `shape` 那段逐字相同。
  // 槽位名原样（`data-has-imageUrl`，不改 kebab）—— shapes.css 与守卫两边靠同一个名字对上。
  if (block && Array.isArray(block.has)) {
    for (const slot of block.has) {
      if (typeof slot === 'string' && slot) attrs[`data-has-${slot}`] = 'true';
    }
  }
  return attrs;
}
