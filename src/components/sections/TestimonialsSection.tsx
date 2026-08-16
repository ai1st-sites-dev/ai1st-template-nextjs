import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface Testimonial {
  id: string;
  name: string;
  role: string;
  location: string;
  quote: string;
  rating: number;
  service: string;
}

interface TestimonialsSectionProps {
  data: {
    headline: string;
    subheadline: string;
    items: Testimonial[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1036 — 一份中性 markup，别的什么都没有。阶段 2 批 G。
//
// 五支走了：`grid`（三列卡片，默认）、`featured`（一张大卡 + 三张小卡）、`quote-wall`（深底三列）、
// `minimal`（一栏、分隔线）、`carousel`（一次一条 + 圆点导航）。
//
// 🔴 这一块跟本批别的块不一样：**五支读的字段并不相同**，而少读的那几支是在【少画数据】，不是换长相。
// 逐支量过（删之前）：
//   grid       quote · rating · name · role · location · service    ← 字段最全的一支
//   featured   quote · rating · name · role · location              ← 而且只画 1 + rest.slice(0, 3)
//   quote-wall quote · name · role · location
//   minimal    quote · name · role
//   carousel   quote · name · role · location                        ← 而且一次只画 1 条
// ⟹ 中性 markup 取**并集**（= 旧 `grid` 那一支画的东西），逐条画，一条不落。这不是「多加了功能」：
//    `service` / `rating` / `location` 本来就在每个站的数据里，是那三支自己没画。
//
// 🔴 搬完之后线上会多出来的内容，写在明处（PM 在 6 个站上复算过）：
//   · `carousel` 从「一次 1 条」变成全部进 DOM —— 线上 0 个实例，所以今天没人受影响，但值得写下来
//   · `featured` 的 `rest.slice(0, 3)` 没了：线上 4 个首页各有 6 条评价而只画 4 条，**每页静默丢 2 条、
//     合计 8 条**，搬完全部回到页面上。对一个卖「被搜索和 AI 找到」的产品，那 8 条是白丢的
//   · `quote-wall` / `minimal` 的每一条从此也带上评分和服务名
//
// 🔴 `carousel` 那一支为什么不留成一个开关：主题自己画得出来。实测契约放行 `display:flex` ·
// `overflow:auto` · `gap` · `flex-shrink` · `min-width`，真浏览器里这五个属性就是一条能横滑的条，
// 而**四条内容全在 DOM 里**。所以「轮播」搬完之后是主题的一种长相，不是站要选的形态。
// 📌 不加 `scroll-snap-*`（契约本来就拒它，而且 PM 2026-08-16 裁定不在结构层无条件加）：线上横向
//    滚动的实例今天是 0 个，没人在滑，现在往 `globals.css` 里加一条谁都盖不掉的规则是给不存在的用户
//    建设施。哪套主题真做出一条能滑的横条、真觉得停位难看，那时带真读数开票。
//
// 🔴 头像那个圆圈里的首字母（`name.charAt(0)`）没了。它不是数据，是 markup 现算出来的一个装饰，
// 而名字就在它旁边。跟 #1027 values-grid 的序号是同一笔账：markup 里算出来的东西，主题表补不回来。
//
// 🔴 评分保留成 N 个 `<svg>`，因为**它是数据驱动的结构**（`rating` 决定几颗星），不是长相 ——
// 主题表画不出「N 颗」。这跟 #1027 的 `services-list__icon` 是同一条界线：图形本身给一个钩子，
// 主题管它多大什么颜色，管不了有几个。
//
// 🔴 `variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，只是没人读了
// —— 同 hero / cta-banner 那个有意的状态（#1008 AC5 / #1018）。`'use client'` 和 `useState` 一起没了。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('testimonials', block)`（#998 的 `data-block-layout`；
// `tsc` 看不见它，#1008 r1 因此被打回）。
export default function TestimonialsSection({ data, block }: TestimonialsSectionProps) {
  return (
    <section {...blockAttrs('testimonials', block)} className="testimonials" aria-labelledby="testimonials-heading">
      <h2 id="testimonials-heading" className="testimonials__headline">
        {data.headline}
      </h2>
      <p className="testimonials__sub">{data.subheadline}</p>
      {data.items?.map((testimonial) => (
        <article key={testimonial.id} className="testimonials__item">
          <p className="testimonials__rating" aria-label={`Rated ${testimonial.rating} out of 5`}>
            {Array.from({ length: testimonial.rating }).map((_, i) => (
              <svg key={i} className="testimonials__star" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </p>
          <blockquote className="testimonials__quote">{testimonial.quote}</blockquote>
          <p className="testimonials__name">{testimonial.name}</p>
          <p className="testimonials__meta">
            {testimonial.role} &middot; {testimonial.location}
          </p>
          <p className="testimonials__service">{testimonial.service}</p>
        </article>
      ))}
    </section>
  );
}
