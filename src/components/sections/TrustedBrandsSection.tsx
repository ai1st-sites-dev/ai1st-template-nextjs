import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TrustedBrandsSectionProps {
  data: {
    headline: string;
    brands: string[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1030 — 一份中性 markup，别的什么都没有。阶段 2 批 E。
//
// 三支走了：`default`（浅灰底、一行灰色粗体名字）、`pill`（每个名字一个描边胶囊）、`dark`（深底、
// 主色名字）。删之前逐支量过字段集：三支读的都是 `data.headline` 和 `data.brands[]`，一个字段不多
// 一个不少 —— 差别全是 Tailwind 类（底色、字号、胶囊的边框、`gap-3` 与 `gap-8 md:gap-16`）。
//
// 🔴 每个名字是块的**直接子元素** —— grid / flex 只摆子元素，中间那两层 `container-width` /
// `flex flex-wrap` 的包装盒没了，位置由主题在 `.trusted-brands` 上排。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('trusted-brands', block)`（#998 的 `data-block-layout`，
// `tsc` 看不见它漏没漏）。
export default function TrustedBrandsSection({ data, block }: TrustedBrandsSectionProps) {
  return (
    <section {...blockAttrs('trusted-brands', block)} className="trusted-brands" aria-label="Trusted brands">
      <p className="trusted-brands__headline">{data.headline}</p>
      {data.brands?.map((brand) => (
        <span key={brand} className="trusted-brands__brand">
          {brand}
        </span>
      ))}
    </section>
  );
}
