import { blockAttrs } from '@/lib/sections/blockAttrs';
import { vocabularyFor } from '@/lib/sections/blockAliases';
import type { BlockConfig } from '@/lib/types/config';

interface CardGroupItem {
  title: string;
  description?: string;
  /** #1143 —— `service-highlights` 带过来的子项级列表。映射文档 §1.3：它是**子项的一个字段**，
   *  不另立一个槽位。老站那条路上只有 `service-highlights` 的词汇画它。 */
  features?: string[];
}

interface CardGroupSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: CardGroupItem[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。
   *  #1132 起它还带着 `__legacyType`：老站的词汇从那里来（见下面那段）。 */
  block?: BlockConfig;
}

// 🔴🔴 #1132 / #1143 —— 通用块「卡片组」的本体。批 1 并进来 `values-grid` + `benefits-list`，
// 批 2（#1143）并进来 `checklist` + `service-highlights`。
//
// 为什么批 1 那两个块本来就是一个：它们在 `scripts/theme-pipeline/sheet-recipes.js` 里的画法配方
// **逐字相同**（各 56 个字符 `{ role: { item: 'card', title: 'title', desc: 'desc' } }`；重取的命令
// 写在 `docs/superpowers/specs/2026-08-18-block-merge-mapping.md` §4 批 1 那一格）。
//
// 🔴 **批 2 这两个不是那样，而且票正文里那半句读数是错的。** 正文写的是「`checklist` 没有配方、
//    走的是兜底」——那是抠配方那条命令按 `'checklist':`（带引号的键）去找造成的，而 `SHAPES` 里
//    `checklist` 这个键**没带引号**。它有配方，逐字是 `{ cols: '1fr 1fr', role: { item: 'ticked' } }`，
//    跟 `service-highlights` 的 `{ role: { item: 'card', title: 'title', desc: 'desc', features: 'list' } }`
//    确实不是同一套 —— 所以正文那个**结论**成立，只是**原因**换了。两条配方都留在原处不动
//    （老站还在吐老类名，83 张表得一直匹配得上），所以「配方不同」这件事对老站的产物**不产生**差异。
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
// 🔴 为什么条目那里是**三个分支**、块那里是**两个 return**，而不是一句 `{v.parts.includes(…) && …}`
//    —— 这是实测出来的，不是风格选择。`values-grid` 的 manifest 从来没有 `subheadline` 这个槽位，
//    被删掉的那个组件里连那行 JSX 都没有 ⟹ 它的 children 只有**两格**（标题 + 那串卡片）。
//    写成一句条件表达式的话，条件为假时 JSX 会往 children 里放一个 `false`，而 React 把它序列化
//    进 RSC 载荷：
//
//      改前："children":[["$","h2",…],[[…卡片…]]]
//      改后："children":[["$","h2",…],false,[[…卡片…]]]
//                                     ^^^^^ 产物 DOM 上看不见，.html 的字节里看得见
//
//    第一版就是那样写的，`about.html` 当场变红 —— 跟坑四同一个形状（差异只在载荷里），也正是
//    §2.6 坚持比字节而不是比像素的理由。`null` 也一样会占一格，所以「那一格根本不存在」只能用
//    分支表达。同一条理由管条目那三支：`checklist` 的条目里**没有**标题和描述那两格，
//    `values-grid` / `benefits-list` 的条目里**没有** features 那一格。
//    三支的根元素都带钩子（`978-theme-preview-layout.spec.ts` 逐支数这件事）。
//
// 🔴 条目外面那个标签名从别名表的 `itemTag` 来，不从 `parts` 推。三种：`div`（卡片组自己 /
//    `values-grid` / `benefits-list`）· `p`（`checklist`，一个条目就是一行字）· `article`
//    （`service-highlights`）。理由写在 `blockAliases.ts` 头上。
//
// 🔴 `data` 一个字节都不改。别名表里那些 `null`（`style` / `variant`）的意思是「继续忽略」——
//    没人读它们（#1027 / #1029 / #1036 的既定状态），而**留在 data 里**是有理由的：
//    `scripts/theme-gallery/verify-applied.mjs` 拿磁盘上的 `data.variant` 跟产物里的对账，删掉它
//    那一格会红在一件没发生的事上。
//    **唯一的例外是 `checklist` 的 `items`**：它磁盘上是 `[string]`，别名把它升成 `[{title}]`
//    （映射文档 §1.3 那条 🔴，做这件事的地方是 `scripts/blocks.js` 的 `normalizeGenericItems`）。
//    升完之后这里画出来的仍然是 `<p class="checklist__item">那一行字</p>`，逐字节不变。
export default function CardGroupSection({ data, block }: CardGroupSectionProps) {
  const v = vocabularyFor(block);
  const attrs = blockAttrs(v.name, block);
  const headline = <h2 id={v.headingId} className={`${v.name}__headline`}>{data.headline}</h2>;
  const Item = v.itemTag;
  let items;
  if (!v.parts.includes('title')) {
    // 叶子形态（`checklist`）：一个条目就是一行字，里面没有元素。
    items = data.items?.map((item, index) => (
      <Item key={index} className={`${v.name}__item`}>{item.title}</Item>
    ));
  } else if (v.parts.includes('features')) {
    // 带子项级列表的形态（`service-highlights`，以及卡片组自己）。
    items = data.items?.map((item, index) => (
      <Item key={index} className={`${v.name}__item`}>
        <h3 className={`${v.name}__title`}>{item.title}</h3>
        <p className={`${v.name}__desc`}>{item.description}</p>
        {item.features && item.features.length > 0 && (
          <ul className={`${v.name}__features`}>
            {item.features.map((feature, fIndex) => (
              <li key={fIndex}>{feature}</li>
            ))}
          </ul>
        )}
      </Item>
    ));
  } else {
    items = data.items?.map((item, index) => (
      <Item key={index} className={`${v.name}__item`}>
        <h3 className={`${v.name}__title`}>{item.title}</h3>
        <p className={`${v.name}__desc`}>{item.description}</p>
      </Item>
    ));
  }

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
