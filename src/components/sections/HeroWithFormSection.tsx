import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import HeroLeadForm from './HeroLeadForm';
import type { BlockConfig } from '@/lib/types/config';

// 🔴 `data.form` 是这个块的必填槽（`blocks/hero-with-form.json`），里面两个字段仍然各自可选 ——
// 组件的默认文案（`HeroLeadForm` 里那两句）一字未动。说明写在 interface **外面**是有意的：
// `scripts/block-migration/gen-allblocks.js` 按文本切这份字段表（`fields()`），一条写在里面的
// 注释会被它当成又一个字段名，写进演示站的夹具数据里 —— `HeroSection.tsx` 上面记着这条实测。
interface HeroWithFormSectionProps {
  data: {
    headline: string;
    subheadline: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
    imageUrl?: string;
    form?: { buttonText?: string; successMessage?: string };
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1333 —— 带表单的首屏是**自己一个块类型**，不是 hero 的一种内容结构。
//
// 在这之前它是 `HeroSection.tsx` 里的一支：页面 JSON 写 `block_layout: "with-form"` 时多渲染一个
// `<HeroLeadForm>`。设计文档 D1 / D14（Chris 2026-09-13）立的规矩是「一个块类型 = 一套固定槽位 =
// 一份 HTML，排版只改 CSS；槽位集合不同或行为不同就是另一个块」—— 带表单的首屏多一组槽位
// （`data.form`）、多一个提交行为（POST /api/leads），所以它是另一个块，而且是最先被点名要拆的那个。
//
// 🔴 类名仍然是 `hero__*`，这**不是**偷懒：皮那一层（`public/themes/<id>.css`）按类名写
// （`.hero` / `.hero__form` / …），排版那一层（`public/shapes.css`）按 `[data-block][data-shape]`
// 点名。类名换掉等于让每一套主题都要为这个块再写一遍同样的皮，而它跟 hero 本来就是同一副骨架、
// 同一块底、同一套字号 —— 两者真正的差别是「有没有那个表单」，而那由块类型说，不由类名说。
//
// 🔴 谁把一个块变成这种：`scripts/lib/hero-lead-form.js`（建站时按行业决定）与
// `scripts/lib/site-data-migration.js`（老站升级时把 `type: hero` + `block_layout: with-form`
// 改写过来）。建站的 AI **选不到它** —— 它的 manifest 没有 `prompt` 键（先例 `card-group`），
// 所以提示词里没有它，产出者只有上面那一个出口。
//
// 🔴 表单是 `.hero` 的**直接子元素**，跟 media / body 平级。理由跟 `HeroSection.tsx` 里那条
// 「media 和 body 为什么不套一层」逐字相同：网格只摆得动直接子元素，套一层这个表单就再也换不到
// 别的位置去，而 `form-side` 那种排版的全部意思就是「表单在侧栏」。
export default function HeroWithFormSection({ data, block }: HeroWithFormSectionProps) {
  return (
    <section {...blockAttrs('hero-with-form', block)} className="hero">
      {/* Decorative only, and empty on purpose — same contract as hero: the sheets get
          ::before/::after on this hook to draw with. */}
      <div className="hero__deco" data-role="optional" aria-hidden="true" />
      <div className="hero__media" data-role="optional">
        {data.imageUrl ? (
          <img className="hero__img" src={data.imageUrl} alt={data.headline} />
        ) : null}
      </div>
      <div className="hero__body" data-role="essential">
        <h1 className="hero__title">{data.headline}</h1>
        <p className="hero__sub">{data.subheadline}</p>
        <div className="hero__cta">
          <Link href={data.ctaPrimary?.href ?? '#'} className="btn-accent text-lg">
            {data.ctaPrimary?.label}
          </Link>
          <Link href={data.ctaSecondary?.href ?? '#'} className="btn-secondary text-lg">
            {data.ctaSecondary?.label}
          </Link>
        </div>
      </div>
      <HeroLeadForm data={data.form} />
    </section>
  );
}
