import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface PricingTier {
  name: string;
  price: string;
  description: string;
  features: string[];
  highlighted?: boolean;
}

interface PricingTableSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    tiers: PricingTier[];
    ctaHref?: string;
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1036 — 一份中性 markup，别的什么都没有。阶段 2 批 G。
//
// 四支走了：`cards`（三张卡，默认）、`comparison`（一张带分隔线的表）、`minimal`（无边框三栏）、
// `toggle`（顶上一个「月付 / 年付」开关）。前三支读的字段完全相同（`headline` · 可选 `subheadline` ·
// `tiers[].name / .price / .description / .features / .highlighted` · 可选 `ctaHref`），差别是 Tailwind 类。
//
// 🔴🔴 `toggle` 那一支【整支删掉】，而理由不是「JS-free 做不出来」（radio 换两套价钱做得出来）：
// **它今天是错的。** 那个开关只把后缀 `/mo` 换成 `/yr`，价钱是同一个值 —— `{tier.price}` 两档逐字相同
// （旧代码 :76 `const suffix = billingPeriod === 'monthly' ? '/mo' : '/yr'`，:112 `{tier.price}{suffix}`）。
// 不用 JS 复刻它，等于复刻一个**把月价标成年价**的界面。要正确地做出来需要 `tiers` 里有第二个价钱，
// 那是改数据形状，不在本票范围里（圈外 ⟹ 谁要谁开票）。线上 3 个实例全是 `cards`，`toggle` 0 个。
// 顺带：那两个后缀 `/mo` `/yr` 也随之消失 —— 别的三支本来就没有它们。
//
// 🔴 `highlighted` 是**数据**，不是长相，所以它保留了自己的钩子：`.pricing-table__item--featured`。
// 主题选不到「第三张卡」这种东西，它只能选类名；旧的四支各自用一套 Tailwind 类表达「这张要突出」，
// 现在换成一个类名，主题爱怎么突出怎么突出。「Most Popular」那行字同样只在 `highlighted` 时出现，
// 是块自己的文案（跟 `Get Started` 一样今天是硬写的英文，本票不动它）。
//
// 🔴 两处 markup 里的装饰没了，主题表补不回来，写在明处：
//   · 每条 feature 前面那个对勾 `<svg>`（纯装饰、不带数据；契约只放行 `content: ""`，
//     `list-style-*` 也不在属性表里）—— 列表标记由结构层（`globals.css`）给
//   · 「2 档两栏 / 否则三栏」那个算术 —— markup 在替主题做版式决定，主题表用
//     `repeat(auto-fit, minmax(…, 1fr))` 表达同一件事，而且每套主题可以有自己的断点
//
// 🔴 按钮保留站自己的 `btn-primary`，外面包一层 `.pricing-table__action` —— 同 #1018 cta-banner 划的
// 那条界线：主题管按钮**外面那个盒子**，按钮长什么样是品牌的（它已经跟着 CSS 变量走）。旧代码按
// `highlighted` 在 `btn-primary` / `btn-secondary` 之间切换，那个区分现在由上面那个 `--featured` 钩子承担。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// —— 同 hero / cta-banner 那个有意的状态（#1008 AC5 / #1018）。`'use client'` 和 `useState` 一起没了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('pricing-table', block)`（#998 的 `data-block-layout`；
// `tsc` 看不见它，#1008 r1 因此被打回）。
export default function PricingTableSection({ data, block }: PricingTableSectionProps) {
  const ctaHref = data.ctaHref || '/quote';
  return (
    <section {...blockAttrs('pricing-table', block)} className="pricing-table" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading" className="pricing-table__headline">
        {data.headline}
      </h2>
      {data.subheadline && (
        <p className="pricing-table__sub">{data.subheadline}</p>
      )}
      {(data.tiers ?? []).map((tier, index) => (
        <article
          key={index}
          className={`pricing-table__item${tier.highlighted ? ' pricing-table__item--featured' : ''}`}
        >
          {tier.highlighted && <p className="pricing-table__badge">Most Popular</p>}
          <h3 className="pricing-table__name">{tier.name}</h3>
          <p className="pricing-table__price">{tier.price}</p>
          <p className="pricing-table__desc">{tier.description}</p>
          <ul className="pricing-table__features">
            {tier.features.map((feature, i) => (
              <li key={i}>{feature}</li>
            ))}
          </ul>
          <div className="pricing-table__action">
            <Link href={ctaHref} className="btn-primary">
              Get Started
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
