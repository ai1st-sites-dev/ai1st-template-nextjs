import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface AnnouncementBarSectionProps {
  data: {
    message: string;
    link?: { label: string; href: string };
    /** 🔴 只有【区】那条路读它 —— 见下面 `asRegion` 那段。块那条路不再读 variant。 */
    variant?: string;
  };
  // #1000 — 同一个组件有两种身份：页面里的**内容块**（默认，带 `data-block` / `data-role`），
  // 和 page layout 库里 `with-topbar` 那个**外壳区**（`asRegion`，带 `data-region-layout`）。
  // 为什么外壳那身不带块属性，三个理由写在 `TopbarRegion.tsx` 的头注里（主题的块选择器 / #992 按
  // `[data-role]` 找的那套不变量 / #1002 枚举 `[data-block]` 的那份基线）——都是能查的，不是偏好。
  asRegion?: boolean;
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 #1036 — 一份中性 markup，别的什么都没有。阶段 2 批 G 的第一块。
//
// 四支走了：`solid`（实底彩条）、`bordered`（白底 + 底部粗边）、`floating`（居中圆角卡片 + 一个圆点）、
// `dismissible`（实底彩条 + 一个关闭按钮）。删之前逐支量过字段集：四支读的都是 `data.message` 和
// 可选的 `data.link`，一个字段不多一个不少。**差别全是 Tailwind 类** —— 也就是长相，长相归主题表
// （spec §4.1、D5）。
//
// 🔴 `dismissible` 那个关闭按钮删掉了，而它是本批唯一一支【带行为】被整支删掉的。判据不是「JS-free
// 做不出来」（checkbox + label 做得出来），是**没有活的用户**：线上 6 个站 9 个实例全是 `solid` / `floating`，
// dismissible 0 个；而它的第二身份（顶栏那条带）同样是死的 —— 30 套主题里 `topbar` 出现 0 次
// （`grep -c topbar scripts/themes.js`），`resolveRegionLayout` 今天恒退回 `solid`。JS-free 复刻要往
// **每个站**的 markup 里塞一个 checkbox + 一个 label，而且跟今天的 `useState` 一样关不过刷新。
// 为一个没人用的按钮给所有站加两个元素，正好是阶段 2 要拆掉的那种 markup。
//
// 🔴 `floating` 那个装饰圆点没有自己的钩子。它是一个空的 `<span aria-hidden>`，主题用
// `.announcement-bar::before` 画同一个点 —— 一个已经存在的元素上的一条属性，不必让每个站的 HTML
// 里长出一个空元素。这跟 cta-banner 删掉 `dark` 那层覆盖 `<div>` 是同一条理由（#1018）。
//
// 🔴 链接从 `<p>` 里面挪出来，成了 message 的**兄弟**。理由跟 page-header 三个部件是兄弟一样（#1019）：
// flex 和 grid 只摆**子元素**，包在段落里的链接，主题一行都摆不动。今天四支里有三支把它排在文字后面
// （行内），`floating` 那支本来就是兄弟 —— 中性 markup 取的是能被主题摆的那种。
//
// 🔴 【区】那条路仍然读 `data.variant`，而且必须读。`asRegion` 时它不是块的变体，是
// `regionLayout.topbar`（`TopbarRegion.tsx:27` 传进来的），落在 `data-region-layout` 上 —— 区那条路
// 归 `scripts/region-layout.js` 管，不在阶段 2 的搬迁范围里。删掉它 = 把顶栏的结构选择弄没了。
// 块那条路不再读它：`variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的 `supports` 覆盖，
// 只是没人读 —— 跟 hero / cta-banner 是同一个有意的状态（#1008 AC5 / #1018），别去「修」它。
//
// 🔴 第三个钩子不是可选的 —— `blockAttrs('announcement-bar', block)`，不许写成
// `blockAttrs('announcement-bar')`（#998 的 `data-block-layout`；`tsc` 看不见它，#1008 r1 因此被打回）。
export default function AnnouncementBarSection({ data, asRegion = false, block }: AnnouncementBarSectionProps) {
  // 一个块只带一种身份的属性：要么是块，要么是区。
  const idAttrs = asRegion
    ? { 'data-region-layout': data.variant || 'solid' }
    : blockAttrs('announcement-bar', block);

  return (
    <div {...idAttrs} className="announcement-bar" role="banner" aria-label="Announcement">
      <p className="announcement-bar__message">{data.message}</p>
      {data.link && (
        <Link href={data.link?.href ?? '#'} className="announcement-bar__link">
          {data.link?.label}
        </Link>
      )}
    </div>
  );
}
