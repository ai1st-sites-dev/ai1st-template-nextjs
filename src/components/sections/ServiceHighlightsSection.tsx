import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Highlight {
  title: string;
  description: string;
  features?: string[];
}

interface ServiceHighlightsSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    highlights: Highlight[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1036 — 一份中性 markup，别的什么都没有。阶段 2 批 G 里**线上唯一真有人在用交互**的那一块。
//
// 四支走了：`cards-large`（三列大卡，默认）、`split`（左文右功能表）、`tabs`（一排标签页）、
// `accordion`（可开合列表）。四支读的字段完全相同（`headline` · 可选 `subheadline` ·
// `highlights[].title / .description / .features`），差别是 Tailwind 类 —— 除了下面这一条。
//
// 🔴🔴 `tabs` 和 `accordion` 今天把内容挡在静态 HTML 之外，而 `tabs` 线上真有 2 个实例。
// 两支都只把**当前那一条**的 description 和 features 放进 DOM（`data.highlights[activeTab]` /
// `{openIndex === index && (…)}`）。真实站 `fadde524` 的 menu 页就是其中一个：今天 DOM 里只有第 1 条
// 的描述，**另外 3 条的描述根本不在页面上**。搬成全部展开之后，那 3 条当场回到页面上 ——
// 这一块是本批唯一「搬完之后线上内容变【多】」的地方。
//
// 🔴 为什么是「全部展开」而不是 `<details open>`（PM 2026-08-16 裁定）：线上 5 个实例里只有 2 个
// 要折叠感，为这 2 个给全部（以及以后所有）实例长出一个折叠三角，这笔账不划算。`faq-accordion` 用
// `<details>` 是因为一问一答本身就是可折可展的东西；highlights 列表不是。而且本票的方向是「组件只出
// 一份中性 markup」，`<details>` 是一段自带行为的 markup，在没人要的地方加它等于把刚拆掉的东西装回去。
// 真有站要能折叠的 highlights，那时是一个有人提的 `block_layout` 新值 —— 比事后从每个站身上撤掉一个
// 三角便宜得多。
//
// 🔴 两处 markup 里的装饰没了，主题表补不回来，写在明处：
//   · `cards-large` 每张卡顶上那条渐变细带（一个空的 `<div className="h-1 bg-gradient-to-r …">`）——
//     主题用 `.service-highlights__item::before` 画同一条带子，一个已经在的元素上的一条属性，
//     不必让每个站的 HTML 里长出一个空 div（同 #1018 cta-banner 删掉 `dark` 那层覆盖 div）
//   · 每条 feature 前面那个对勾 `<svg>` —— 它是纯装饰（不带任何数据），而契约只放行 `content: ""`、
//     `list-style-*` 也不在属性表里，所以对勾不再出现。列表标记由结构层（`globals.css`）给。
//     这跟 #1027 values-grid 的序号是同一笔账
//
// 🔴 `cards-large` 那个「1 条不分栏 / 2 条两栏 / 3 条以上三栏」的算术也没了 —— 它是 markup 在替主题
// 做版式决定。主题表用 `repeat(auto-fit, minmax(…, 1fr))` 表达同一件事，而且**每套主题可以有自己的
// 断点**，这正是搬迁要的方向。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// —— 同 hero / cta-banner 那个有意的状态（#1008 AC5 / #1018）。`'use client'` 和两个 `useState` 一起没了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('service-highlights', block)`（#998 的 `data-block-layout`；
// `tsc` 看不见它，#1008 r1 因此被打回）。
export default function ServiceHighlightsSection({ data, block }: ServiceHighlightsSectionProps) {
  return (
    <section {...blockAttrs('service-highlights', block)} className="service-highlights" aria-labelledby="highlights-heading">
      <h2 id="highlights-heading" className="service-highlights__headline">
        {data.headline}
      </h2>
      {data.subheadline && (
        <p className="service-highlights__sub">{data.subheadline}</p>
      )}
      {data.highlights?.map((highlight, index) => (
        <article key={index} className="service-highlights__item">
          <h3 className="service-highlights__title">{highlight.title}</h3>
          <p className="service-highlights__desc">{highlight.description}</p>
          {highlight.features && highlight.features.length > 0 && (
            <ul className="service-highlights__features">
              {highlight.features.map((feature, fIndex) => (
                <li key={fIndex}>{feature}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
