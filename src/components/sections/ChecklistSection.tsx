import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface ChecklistSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: string[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1029 — 一份中性 markup，别的什么都没有。阶段 2 批 D。
//
// 四支走了：`two-column`（默认，两列）、`cards`（每条一张带边框的卡）、`icon-grid`（一格一个大方块图标）、
// `numbered-steps`（一条一行、前面一个圆形序号）。删之前逐支量过字段集：四支读的都是 `data.headline`、
// 可选的 `data.subheadline` 和 `data.items`（`string[]`），一个字段不多一个不少，**差别全是 Tailwind 类**。
//
// 🔴 每条前面那个勾没了，主题表补不回来一模一样的那个。四支各画一个 `<svg>` 的对勾（`icon-grid` 那支
// 还额外套一个 96×96 的圆角底）—— 那是**写在 markup 里的装饰**，而契约只放行 `content: ""`
// （`docs/reference/theme-css-contract.md` §2）。主题能用 `.checklist__item::before` 画一个方块、圆点或
// 背景图当勾，画不出那条贝塞尔曲线。同族的还有 `numbered-steps` 那个序号（`{index + 1}`），
// 跟 #1027 的 values-grid、#1036 的 faq-accordion `numbered` 是同一笔账，照样写在明处。
//
// 🔴 每一条是块的**直接子元素**，中间没有列表包装 `<div>`。理由同 #1027 的 values-grid：grid 和 flex
// 只摆**子元素**，隔一层包装主题就一条都摆不动 —— 老的 `two-column`（两列）、`cards`（三列）、
// `icon-grid`（四列）现在全是主题在 `.checklist` 上写 `grid-template-columns` 的事。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// —— 跟 hero / cta-banner 是同一个有意的状态（#1008 AC5 / #1018），别去「修」它。它也从上面的
// props 类型里去掉了：一个声明了却从不读的字段，是在告诉下一个读代码的人「这个字段有用」。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('checklist', block)`，不许写成 `blockAttrs('checklist')`
// （#998 的 `data-block-layout`；`tsc` 看不见它，#1008 r1 因此被打回）。
export default function ChecklistSection({ data, block }: ChecklistSectionProps) {
  return (
    <section {...blockAttrs('checklist', block)} className="checklist" aria-labelledby="checklist-heading">
      <h2 id="checklist-heading" className="checklist__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="checklist__sub">{data.subheadline}</p>}
      {data.items?.map((item, index) => (
        <p key={index} className="checklist__item">{item}</p>
      ))}
    </section>
  );
}
