import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TrustedBrandsSectionProps {
  data: {
    headline: string;
    brands: string[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
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
// 📌 #1341 —— 下面这句话原来的写法是「`variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的
//    `supports` 覆盖」。那条覆盖随内容结构那一维一起退役了：构建期不再往任何块写 `data.variant`，
//    而老站磁盘上残留的这个键在构建读页面时就被丢掉（`scripts/blocks.js` 的 `normalizeListSlots`）
//    ⟹ 它根本到不了组件。
// 🔴 `variant` 只剩在老站磁盘上的页面 JSON 里，没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 那第二个参数不是可选的 —— `blockAttrs('trusted-brands', block)`，不许写成 `blockAttrs('trusted-brands')`。
// #1341 把第三个钩子 `data-block-layout` 退役了，但 `data-role` / `data-shape` /
// `data-has-*` 仍然全从这个参数来；漏掉它 `tsc` 看不见（`registry.ts` 把组件类型写成
// `ComponentType<any>`），#1008 r1 因此被打回。
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
