import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Area {
  name: string;
  description?: string;
}

interface MapAreaSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    areas: Area[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1030 — 一份中性 markup，别的什么都没有。阶段 2 批 E。**这块是 `essential`**
// （`src/lib/sections/block-roles.json`）：它是「被找到」的地区词落在页面上的地方，主题不许把它藏掉。
//
// 四支走了：`list`（默认，每条一个对勾 `<svg>` 的三列网格）、`cards`（描边卡片）、`grouped`（对半分
// 成两列的清单）、`badge`（一排圆角胶囊）。
//
// 🔴🔴 **有一处用户看得见的变化：`badge` 那一支原来【不画 `area.description`】**，另外三支都画
// （旧代码里 description 出现在 42 / 103 / 116 / 149 行，`badge` 分支 53–79 行没有它）。中性 markup
// 取**超集**：描述照渲染。所以今天用 `badge` 的站，每个地区的描述会回到静态 HTML 里 —— 跟 #1029 的
// `team-grid` 简介是同一个方向（内容回到页面上，对一个卖「被搜索和 AI 找到」的产品是修缺陷），但它
// 不是纯长相，所以写在明处。
// 🔴 **而且主题表【收不回去】**：#1043 之后，静态那道检查拒收「藏 essential 块里任何一个部件」——
// 实测 `.map-area__desc { display: none }` rc=1 并点名 map-area，同一个钩子上的排版规则 rc=0，
// 而 optional 块的部件（`.trusted-brands__brand`）照样可以藏 rc=0。所以旧的 `badge` 长相
// （只列地区名、不列描述）今天没有合法路径：要那个样子，得是站自己的页面 JSON 不写描述。
// 🔴 三套实证表给这个部件写的是**排版规则** —— 那本来就是 PM 2026-08-16 的裁定 + #1042 的理由
// （一条无条件的 `display:none` 会落在**每一个**穿这张表的站上，藏掉站自己配置里的真内容），
// 同时也躲开另一个红：钩子一条规则都没有时，运行时那道检查会点名它没人管（#1047 就是这么红的）。
//
// 🔴 `grouped` 那两处 `slice` 是排版不是判断：`midpoint = Math.ceil(len/2)` 把清单对半分成两列，
// 条数一条不少 —— 两列由主题用 `grid-template-columns` 表达，`.map-area__area` 是块的直接子元素。
//
// 🔴 默认那一支每条前面那个对勾 `<svg>`、`cards` / `grouped` 每条前面那个小圆点 `<span>` 都没了：
// 契约只放行 `content: ""`，主题能在原位画一个**形状**（三套表都画了），画不出那个字形。
//
// 🔴 每条是块的**直接子元素**，地区名和描述是它的直接子元素 —— 各一层，因为 grid / flex 只摆子元素。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('map-area', block)`（#998 的 `data-block-layout`，
// `tsc` 看不见它漏没漏）。
export default function MapAreaSection({ data, block }: MapAreaSectionProps) {
  return (
    <section {...blockAttrs('map-area', block)} className="map-area" aria-labelledby="areas-heading">
      <h2 id="areas-heading" className="map-area__headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="map-area__sub">{data.subheadline}</p>}
      {data.areas?.map((area, index) => (
        <div key={index} className="map-area__area">
          <span className="map-area__name">{area.name}</span>
          {area.description && <p className="map-area__desc">{area.description}</p>}
        </div>
      ))}
    </section>
  );
}
