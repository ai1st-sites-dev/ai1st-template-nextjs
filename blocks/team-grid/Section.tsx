import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';

interface TeamMember {
  name: string;
  role: string;
  bio?: string;
}

interface TeamGridSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    members: TeamMember[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的 `data-role` / `data-shape` / `data-has-*` 从它来。
   *  （#998 当初加它是为了第三个钩子 `data-block-layout`，#1341 把那个钩子退役了。） */
  block?: BlockConfig;
}

// 🔴🔴 #1029 — 一份中性 markup，别的什么都没有。阶段 2 批 D。
//
// 四支走了：`grid`（默认，灰底三列白卡）、`card-with-social`（卡顶一条渐变条 + 卡底三个灰圆点）、
// `centered`（单列居中、条间分隔线）、`compact`（三列小卡，头像在左、文字在右）。
//
// 🔴 四支里有【一支少画数据】，而这不是长相 —— 它是本块唯一一处「搬完之后页面上会多出东西」。
// `compact` 只画 `name` 和 `role`，**不画 `bio`**；另外三支都画。中性 markup 每个人都画 bio，
// 所以今天用 `compact` 的站，每位成员的简介会回到页面上。跟 #1036 的 faq-accordion 是同一个方向：
// 内容回到静态 HTML 里，对一个卖「被搜索和 AI 找到」的产品是修缺陷，不是加功能。
// 📌 剩下的差别（列数、居中、分隔线、卡的底色和圆角、那条渐变条）全是 Tailwind 类。
//
// 🔴 那个头像圆圈没了，主题表补不回来。四支都画 `<span>{member.name.charAt(0)}</span>` —— 首字母是
// **在 markup 里算出来的一段文字**，而契约只放行 `content: ""`（§2）：主题能在
// `.team-grid__member::before` 摆一个圆形色块占住那个位置，摆不出这个人名字的第一个字母。
// `card-with-social` 那三个灰圆点同理（三个空 `<span>`，本来就不链去任何地方）。
//
// 🔴 每个人是块的**直接子元素**，三个部件是他的直接子元素 —— 各一层，因为 grid / flex 只摆子元素。
// 老的 `compact`（头像在左、文字在右）由主题在 `.team-grid__member` 上写 grid 列复原。
//
// 📌 #1341 —— 下面这句话原来的写法是「`variant` 照旧写在页面 JSON 里、照旧被 sync-config.js 从主题的
//    `supports` 覆盖」。那条覆盖随内容结构那一维一起退役了：构建期不再往任何块写 `data.variant`，
//    而老站磁盘上残留的这个键在构建读页面时就被丢掉（`scripts/blocks.js` 的 `normalizeListSlots`）
//    ⟹ 它根本到不了组件。
// 🔴 `variant` 只剩在老站磁盘上的页面 JSON 里，没人读了
// （#1008 AC5 / #1018 的既定状态，别去「修」它），并且从上面的 props 类型里去掉了。
//
// 🔴 那第二个参数不是可选的 —— `blockAttrs('team-grid', block)`，不许写成 `blockAttrs('team-grid')`。
// #1341 把第三个钩子 `data-block-layout` 退役了，但 `data-role` / `data-shape` /
// `data-has-*` 仍然全从这个参数来；漏掉它 `tsc` 看不见（`registry.generated.ts` 把组件类型写成
// `ComponentType<any>`），#1008 r1 因此被打回。
export default function TeamGridSection({ data, block }: TeamGridSectionProps) {
  return (
    <section {...blockAttrs('team-grid', block)} className="team-grid" aria-labelledby="team-heading">
      <h2 id="team-heading" className="team-grid__headline" data-slot="headline">
        {data.headline}
      </h2>
      {data.subheadline && <p className="team-grid__sub" data-slot="subheadline">{data.subheadline}</p>}
      {data.members?.map((member, index) => (
        <div key={index} className="team-grid__member">
          <h3 className="team-grid__name" data-slot={`members.${index}.name`}>{member.name}</h3>
          <p className="team-grid__role" data-slot={`members.${index}.role`}>{member.role}</p>
          {member.bio && <p className="team-grid__bio" data-slot={`members.${index}.bio`}>{member.bio}</p>}
        </div>
      ))}
    </section>
  );
}
