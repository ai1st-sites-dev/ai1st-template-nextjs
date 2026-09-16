import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface LogoCarouselSectionProps {
  data: {
    headline?: string;
    logos: string[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1030 — 一份中性 markup，别的什么都没有。阶段 2 批 E。
//
// 四支走了：`scroll`（默认，一条横向滚动的字幕带）、`grid`（描边格子）、`bordered`（底部一道强调色的
// 卡片）、`dark`（深底六列）。删之前逐支量过字段集：四支读的都是可选的 `data.headline` 和
// `data.logos[]`，一个字段不多一个不少。
//
// 🔴🔴 默认那一支把 logo 列表**画两遍**（`[...logos, ...logos]`），并在 markup 里注入一段
// `<style>{@keyframes scroll}`，靠 `animation` 把两份连起来滚。中性 markup 每个只画一次，那段
// `@keyframes` 和那个 `<style>` 一起没了 —— 主题表补不回来：`animation` / `transform` 都不在契约
// §2 的属性表上（`docs/reference/theme-css-contract.md` §2），`@keyframes` 也不在放行的 at-rule 里
// （只放行 `@media (min-width: …)`）。**滚动这件事本身**主题仍然做得到（`.logo-carousel {
// display: flex; overflow: auto }` —— `overflow` 在属性表上，块上的取值只要保持它是一个格式化
// 上下文即可，`theme-css-lint.js:1384` 判的就是这个），只是不再自己动。
//
// 🔴 `data.logos` 里今天存的是**图片路径的字符串**（夹具里是 `/images/grid-pattern.svg`），而四支
// 一支都没把它当 `<img>` 画 —— 全都直接把这个字符串当文字排。中性 markup 照旧（搬迁票不改这块的
// 数据契约；要把它变成真图片是另一件事，圈外）。
//
// 🔴 每个 logo 是块的**直接子元素**，中间那两层包装盒（`container-width` / `flex`）没了。
//
// 📌 #1341 —— 下面这句话原来的写法是「`variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的
//    `supports` 覆盖」。那条覆盖随内容结构那一维一起退役了：构建期不再往任何块写 `data.variant`，
//    而老站磁盘上残留的这个键在构建读页面时就被丢掉（`scripts/blocks.js` 的 `normalizeListSlots`）
//    ⟹ 它根本到不了组件。
// 🔴 `variant` 只剩在老站磁盘上的页面 JSON 里，没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 那第二个参数不是可选的 —— `blockAttrs('logo-carousel', block)`，不许写成 `blockAttrs('logo-carousel')`。
// #1341 把第三个钩子 `data-block-layout` 退役了，但 `data-role` / `data-shape` /
// `data-has-*` 仍然全从这个参数来；漏掉它 `tsc` 看不见（`registry.ts` 把组件类型写成
// `ComponentType<any>`），#1008 r1 因此被打回。
export default function LogoCarouselSection({ data, block }: LogoCarouselSectionProps) {
  return (
    <section {...blockAttrs('logo-carousel', block)} className="logo-carousel" aria-label="Partners and certifications">
      {data.headline && <p className="logo-carousel__headline">{data.headline}</p>}
      {data.logos?.map((logo, index) => (
        <span key={index} className="logo-carousel__logo">
          {logo}
        </span>
      ))}
    </section>
  );
}
