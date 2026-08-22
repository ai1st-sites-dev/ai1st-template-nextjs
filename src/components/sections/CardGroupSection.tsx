import { blockAttrs } from '@/lib/sections/blockAttrs';
import { vocabularyFor } from '@/lib/sections/blockAliases';
import type { BlockConfig } from '@/lib/types/config';

interface CardGroupSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: { title: string; description: string }[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。
   *  #1132 起它还带着 `__legacyType`：老站的词汇从那里来（见下面那段）。 */
  block?: BlockConfig;
}

// 🔴🔴 #1132 —— 通用块「卡片组」的本体。`values-grid` 和 `benefits-list` 并到这里。
//
// 为什么这两个块本来就是一个：它们在 `scripts/theme-pipeline/sheet-recipes.js` 里的画法配方**逐字
// 相同**（各 56 个字符 `{ role: { item: 'card', title: 'title', desc: 'desc' } }`；重取的命令写在
// `docs/superpowers/specs/2026-08-18-block-merge-mapping.md` §4 批 1 那一格）。删掉的两个组件的
// markup 也只差三处：类名前缀、标题的 id、有没有那行副标题。前两处现在是
// `src/lib/sections/block-aliases.json` 里的一行数据；第三处见下面那段 🔴。
//
// ── 老站那条路上，这五样必须还是老值（映射文档 §2.2）────────────────────────────────────────────
// 别名把 `type` 换成了 `card-group`（`scripts/blocks.js` 的 `applyAlias`），而老站重建出来的 HTML
// 要逐字节不变。两句话同时成立的唯一做法是：**老站永远吐老词汇**。
//
//   1. `data-block`          ← `__legacyType`（下面 `blockAttrs(v.name, block)` 的第一个参数）
//   2. `data-role`           ← 别名显式写的 `role`（= 老类型在 `block-roles.json` 里那个角色）。
//                              不写的话 `blockAttrs` 按新 type 名查表，查不到就落到兜底的
//                              `essential` —— 静默翻脸，映射文档 §2.5 坑一实测过。
//   3. `className`（块根 + 每个部件）← `__legacyType` 当前缀。这一条是**像素**：83 张主题样式表
//                              全部 83 张都在选 `.values-grid__title`。
//   4. React 的 key          ← `SectionRenderer.tsx` 那行改成读 `__legacyType`（坑四：它落在 RSC
//                              载荷里、不落在产物 DOM 的属性上，所以像素比对看不见它）
//   5. `data-block-layout`   ← 别名**不造**一个（`block-aliases.json` 里那一行写着 `null`）
//
// ⟹ 合并的收益发生在**新站**那条路上：新写的块 `type` 就是 `card-group`，用卡片组自己的词汇。
//
// 🔴 为什么是**两个 return**，而不是一句 `{v.parts.includes('sub') && …}` —— 这是实测出来的，不是
//    风格选择。`values-grid` 的 manifest 从来没有 `subheadline` 这个槽位，被删掉的那个组件里连那行
//    JSX 都没有 ⟹ 它的 children 只有**两格**（标题 + 那串卡片）。写成一句条件表达式的话，条件为假
//    时 JSX 会往 children 里放一个 `false`，而 React 把它序列化进 RSC 载荷：
//
//      改前："children":[["$","h2",…],[[…卡片…]]]
//      改后："children":[["$","h2",…],false,[[…卡片…]]]
//                                     ^^^^^ 产物 DOM 上看不见，.html 的字节里看得见
//
//    第一版就是那样写的，`about.html` 当场变红 —— 跟坑四同一个形状（差异只在载荷里），也正是
//    §2.6 坚持比字节而不是比像素的理由。`null` 也一样会占一格，所以「那一格根本不存在」只能用
//    分支表达。两支的根元素都带钩子（`978-theme-preview-layout.spec.ts` 逐支数这件事）。
//
// 🔴 `data` 一个字节都不改。别名表里那些 `null`（`style` / `variant`）的意思是「继续忽略」——
//    没人读它们（#1027 / #1029 的既定状态），而**留在 data 里**是有理由的：
//    `scripts/theme-gallery/verify-applied.mjs` 拿磁盘上的 `data.variant` 跟产物里的对账，删掉它
//    那一格会红在一件没发生的事上。
export default function CardGroupSection({ data, block }: CardGroupSectionProps) {
  const v = vocabularyFor(block);
  const attrs = blockAttrs(v.name, block);
  const headline = <h2 id={v.headingId} className={`${v.name}__headline`}>{data.headline}</h2>;
  const items = data.items?.map((item, index) => (
    <div key={index} className={`${v.name}__item`}>
      <h3 className={`${v.name}__title`}>{item.title}</h3>
      <p className={`${v.name}__desc`}>{item.description}</p>
    </div>
  ));

  if (!v.parts.includes('sub')) {
    return (
      <section {...attrs} className={v.name} aria-labelledby={v.headingId}>
        {headline}
        {items}
      </section>
    );
  }

  return (
    <section {...attrs} className={v.name} aria-labelledby={v.headingId}>
      {headline}
      {data.subheadline && <p className={`${v.name}__sub`}>{data.subheadline}</p>}
      {items}
    </section>
  );
}
