import { getLabels } from '@/lib/component-labels';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface FeatureComparisonSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    comparisons: { feature: string; us: boolean; them: boolean }[];
    usLabel?: string;
    themLabel?: string;
  };
  locale: string;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1030 — 一份中性 markup，别的什么都没有。阶段 2 批 E。
//
// 四支走了：`table`（默认，一张真 `<table>`）、`cards`（两张卡，一张「他们」一张「我们」）、
// `columns`（三列网格 + 隔行底色）、`stacked`（每条一张卡，两个圆角标签）。删之前逐支量过字段集：
// 四支读的都是 `data.headline` · 可选 `data.subheadline` · `data.comparisons[].feature / .us / .them` ·
// 可选 `data.usLabel / .themLabel`（缺省 `Us` / `Them`）· `getLabels(locale).feature`，一个字段不多
// 一个不少。列的顺序四支各不相同（默认是 功能 / 我们 / 他们，`columns` 是 功能 / 他们 / 我们）——
// 中性 markup 取默认那一支的顺序。
//
// 🔴🔴 **✓ / ✗ 是数据，不是装饰，所以它留在 markup 里，并且带自己的钩子。** 旧代码有两种画法：
// 三支画 `<svg aria-hidden>`（对勾绿、叉红），`stacked` 那支直接写字符 `✓` / `✗`。契约只
// 放行 `content: ""`，画不出那个字形 ⟹ 中性 markup 照 `stacked` 的做法写**字符**。副作用是好的：
// 三支旧变体里这个「有没有」对读屏软件和抓取的机器是**完全不存在**的（`aria-hidden="true"`），
// 现在它是页面上的真文字。
// 🔴 而「这一格是有还是没有」是**数据驱动的状态**，主题选不到它（§1 拒 `nth-child`，也没有属性
// 选择器可用）—— 所以它跟 #1036 的 `.pricing-table__item--featured` 同一处置：一个修饰钩子
// `.feature-comparison__mark--yes` / `--no`，主题爱怎么区分怎么区分（三套表给了两种颜色）。
//
// 🔴🔴 **一处用户看得见的变化：默认那一支的 `<table>` / `<th scope="col">` 语义没了。** 读屏软件在
// 那一支里能按列头念每一格，现在念到的是「功能名 · ✓ · ✗」三段文字，没有列的关系。换来的是这块
// 归主题排（`<thead>` / `<tbody>` / `<tr>` 是标签，契约 §1 拒标签选择器 ⟹ 只要它们还在，主题就
// **永远**够不到表格内部）。写在明处交 PM 裁，不当成纯长相。
//
// 🔴 表头单独一个部件 `.feature-comparison__head`，不复用 `__row`：主题分不出「第一行」
// （§1 拒 `nth-child`），少了它就没法把表头排得跟数据行不一样。
// 🔴 而表头**第一格用的是 `__feature`**（跟数据行同一个类），只有右边两格是 `__label`：这样「功能
// 这一列」在主题眼里从头到尾是同一个钩子，一条规则就能对齐整列。三格全写 `__label` 的话，主题
// 只能把三格排成同一个样子 —— 想让第一格靠左、另外两格居中就没有办法（`:first-child` 同样被 §1 拒）。
//
// 🔴 `columns` 那支的隔行底色（`index % 2 === 0`）没了 —— 同上，主题点不到「偶数行」。
//
// 🔴 每一行是块的**直接子元素**，格子是行的直接子元素 —— 各一层，因为 grid / flex 只摆子元素。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('feature-comparison', block)`（#998 的 `data-block-layout`，
// `tsc` 看不见它漏没漏）。
export default function FeatureComparisonSection({ data, locale, block }: FeatureComparisonSectionProps) {
  const usLabel = data.usLabel || 'Us';
  const themLabel = data.themLabel || 'Them';
  const labels = getLabels(locale);
  const mark = (has: boolean) => (
    <span className={`feature-comparison__mark feature-comparison__mark--${has ? 'yes' : 'no'}`}>
      {has ? '✓' : '✗'}
    </span>
  );

  return (
    <section {...blockAttrs('feature-comparison', block)} className="feature-comparison" aria-labelledby="comparison-heading">
      <h2 id="comparison-heading" className="feature-comparison__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="feature-comparison__sub">{data.subheadline}</p>}
      <div className="feature-comparison__head">
        <span className="feature-comparison__feature">{labels.feature}</span>
        <span className="feature-comparison__label">{usLabel}</span>
        <span className="feature-comparison__label">{themLabel}</span>
      </div>
      {data.comparisons?.map((comparison, index) => (
        <div key={index} className="feature-comparison__row">
          <span className="feature-comparison__feature">{comparison.feature}</span>
          {mark(comparison.us)}
          {mark(comparison.them)}
        </div>
      ))}
    </section>
  );
}
