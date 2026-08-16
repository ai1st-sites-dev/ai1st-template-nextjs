import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: FaqItem[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1036 — 一份中性 markup，别的什么都没有。阶段 2 批 G 里**唯一保留行为**的那一块。
//
// 四支走了：`centered`（居中窄栏）、`two-column`（标题在左、问答在右）、`cards`（每条一张卡）、
// `numbered`（每条前面一个两位数序号）。删之前逐支量过字段集：四支读的都是 `data.headline`、可选的
// `data.subheadline` 和 `data.items[].question / .answer`，一个字段不多一个不少。**差别全是 Tailwind 类**。
// 📌 `numbered` 那个序号是写在 markup 里的（`String(index + 1).padStart(2, '0')`），而契约只放行
//    `content: ""`，所以序号不再出现，任何主题表都补不回来 —— 跟 #1027 的 values-grid 是同一笔账，
//    这里照样写在明处。线上 12 个 `numbered` 实例受影响。
//
// 🔴🔴 行为为什么留下来，而且换成原生 `<details>/<summary>`：开合原来写在**四支之上**
// （`useState` + `toggle()` 在组件顶部，四支都调它），所以它从来不是「某一支的选择」—— 没有哪个站
// 在「要不要能开合」上做过选择。而今天那份实现把答案挡在静态 HTML 之外：`{openIndex === index && (…)}`
// 配上初始值 `null`，意味着**服务端渲染出来一条答案都没有**。这个块是 `essential`、线上 51 个实例
// （每站 8.5 个）—— 对一个卖「被搜索和 AI 找到」的产品，那是缺陷不是功能。`<details>` 不用一行 JS、
// 不用一行 CSS 就能开合，而且答案始终在 DOM 里。搬迁顺手把那 51 个块的答案补回页面上。
//
// 🔴 代价说在明处：主题选不到 `[open]` —— 契约 §1 拒绝属性选择器（`details[open]` / `:has()` 都过不了
// `theme-css-lint.js`，实测）。所以「展开时长什么样」由浏览器默认 + 结构层（`globals.css`）决定，
// 主题管不了。收起时长什么样、问句和答案的字体颜色间距，主题照旧全管。
//
// 🔴 `'use client'` 没了，`useState` 也没了 —— 这个块从此是纯服务端组件。这不是顺手清理：它正是
// 「答案回到静态 HTML 里」这件事的另一面。
//
// 🔴 每条问答是 `<details>`，直接挂在块下面，中间没有列表包装 `<div>`。理由跟 #1027 的 values-grid
// 一样：grid 和 flex 只摆**子元素**，隔一层包装主题就一条都摆不动；旧的 `two-column`（标题在左、
// 问答在右）由主题用 grid + 给标题一条 `grid-column: 1 / -1` 复原。
//
// 🔴 `aria-labelledby` + 标题的 id 逐字保留，含重复 id 那股味道 —— 同 #1018 cta-banner 的处置：
// 本票的承诺是「长相搬进 CSS」，不是「无障碍也跟着改」。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// —— 跟 hero / cta-banner 是同一个有意的状态（#1008 AC5 / #1018），别去「修」它。它也从上面的
// props 类型里去掉了：一个声明了却从不读的字段，是在告诉下一个读代码的人「这个字段有用」。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('faq-accordion', block)`，不许写成
// `blockAttrs('faq-accordion')`（#998 的 `data-block-layout`；`tsc` 看不见它，#1008 r1 因此被打回）。
export default function FaqAccordionSection({ data, block }: FaqAccordionSectionProps) {
  return (
    <section {...blockAttrs('faq-accordion', block)} className="faq-accordion" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="faq-accordion__headline">
        {data.headline}
      </h2>
      {data.subheadline && (
        <p className="faq-accordion__sub">{data.subheadline}</p>
      )}
      {data.items?.map((item, index) => (
        <details key={index} className="faq-accordion__item">
          <summary className="faq-accordion__question">{item.question}</summary>
          <p className="faq-accordion__answer">{item.answer}</p>
        </details>
      ))}
    </section>
  );
}
