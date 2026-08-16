import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface BenefitsListSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: { title: string; description: string }[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1029 — 一份中性 markup，别的什么都没有。阶段 2 批 D。
//
// 四支走了：`alternating`（默认，文字与色块左右交替）、`icon-large`（每条一个 64px 圆形图标 + 分隔线）、
// `numbered-large`（每条压一个 7xl 的浅色两位数序号）、`cards-horizontal`（一条能横向滚的卡片带）。
// 删之前逐支量过字段集：四支读的都是 `data.headline`、可选的 `data.subheadline` 和
// `data.items[].title / .description`，一个字段不多一个不少，**差别全是 Tailwind 类**。
//
// 🔴 默认那一支原来把每条的文字**渲染两遍**（`index % 2 === 0 ? <左边一份> : <右边一份>`），而且每条
// 还额外挂一个空的渐变色块 `<div aria-hidden>`。中性 markup 每条只画一次，左右交替由主题在
// `.benefits-list__item` 上用 `grid-column` / `order` 做 —— 跟 #1028 的 timeline 那条中线是同一处置。
// **词一个没少、出现次数没变**，少的是「用空盒子搭出来的那一半」。
//
// 🔴 三样写在 markup 里的装饰没了，主题表补不回来：那个火花 `<svg>`、`numbered-large` 那个
// `String(index + 1).padStart(2, '0')` 序号、`cards-horizontal` 右边缘那条渐变提示条（一个空的绝对定位
// `<div>`）。契约只放行 `content: ""`（§2），所以 `::before` 能画方块、圆点、背景图，画不出这三样。
// 那条能横着滚的卡片带**本身仍然做得到**：`.benefits-list { display: flex; overflow: auto }` 那几个属性
// 都在放行清单里（#1036 实测过同一组）。
//
// 🔴 每条是块的**直接子元素**，标题和描述是它的直接子元素 —— 各一层，因为 grid / flex 只摆子元素。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('benefits-list', block)`（#998 的 `data-block-layout`，
// `tsc` 看不见它漏没漏）。
export default function BenefitsListSection({ data, block }: BenefitsListSectionProps) {
  return (
    <section {...blockAttrs('benefits-list', block)} className="benefits-list" aria-labelledby="benefits-heading">
      <h2 id="benefits-heading" className="benefits-list__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="benefits-list__sub">{data.subheadline}</p>}
      {data.items?.map((item, index) => (
        <div key={index} className="benefits-list__item">
          <h3 className="benefits-list__title">{item.title}</h3>
          <p className="benefits-list__desc">{item.description}</p>
        </div>
      ))}
    </section>
  );
}
