import { blockAttrs } from '@/lib/sections/blockAttrs';
import { vocabularyFor } from '@/lib/sections/blockAliases';
import type { BlockConfig } from '@/lib/types/config';

interface CardGroupItem {
  title: string;
  description?: string;
  /** #1143 —— 从 `service-highlights` 并进来的子项级列表。映射文档 §1.3：它是**子项的一个字段**，
   *  不另立一个槽位。 */
  features?: string[];
}

interface CardGroupSectionProps {
  data: {
    headline: string;
    subheadline?: string;
    items: CardGroupItem[];
  };
  /** #998 — 这个块在页面 JSON 里的那条记录；根元素的第三个钩子从它来。 */
  block?: BlockConfig;
}

// 🔴🔴 通用块「卡片组」的本体。#1132 并进来 `values-grid` + `benefits-list`，#1143 并进来
// `checklist` + `service-highlights`。
//
// ── 2026-08-23 #1162：老块名的兼容层【整层退役了】────────────────────────────────────────────────
// 在此之前，这个组件为**老站**服务过第二套长相：别名把 `type` 换成 `card-group`，同时把老 type 名
// 记在另一个字段里，而这里的每个类名、`data-block`、`itemTag`、乃至 React 的 key 都读那个字段 ——
// 目的是「老站重建出来的 HTML 逐字节不变」（映射文档 §2.2 / §2.6）。Chris 2026-08-23 裁定把它删掉：
// 合并从此是干净改名，后面的合并批不再建兼容。
//
// 🔴 **让这件事安全的不是「反正都是测试站」——那句话是假的**（prod 5 个站里 2 个属于外部人，其中
//    `dexin.ca` 的主人 2026-08-14 起有 3 笔 active 订阅；那 5 个站磁盘上写着老 type 名的块共 43 个）。
//    安全的理由是**平台模板到不了任何已存在的站**，而那是可以逐条量的：`isLocal()` 在 prod 恒 false
//    ⟹ 模板注入的两个点（`manager/sites.go:462` 建站 · `manager/edit.go:93` 打开编辑器/重建存量站）
//    都不成立；模板进站仓只有建站那一刻的 GitHub `/generate` 一条路；而且那 5 个站的仓里一份
//    `block-aliases.json` 都没有 —— 它们的快照比兼容层还早，那 43 个块今天就是各站自己那份合并前的
//    组件在渲染。守这条性质的是 `ai-team/dispatcher/ship-check-template-reachability.sh`（#1162）。
//    ⟹ 谁哪天把 prod 的 `templatePath` 填上、或者加一条「按当前模板重建这个站」的路
//    （`dashboard/src/components/ThemeModal.tsx:724` 今天**只有那句话、没有对应动作**），
//    那道守卫会红 —— 那时这一段就要回来重判。
//
// ⟹ 所以今天这里**只有一套词汇**（`block-aliases.json` 只剩 `card-group` 那一行），三个分支塌成
//    一支、两个 return 塌成一个。塌的时候逐格核过：`card-group` 的 `parts` 是
//    `[headline, sub, item, title, desc, features]` ⟹ 它走的本来就是「有 title、有 features」那一支
//    和「有 sub」那个 return，被删掉的都是另外三个老词汇专用的路。判据不是这段推理，是**产物字节**：
//    同一份含 card-group 的页面，改前后那一节的 md5 相同（#1162 AC7 量的就是它）。
//
// 🔴 **塌完仍然不许把 `{data.subheadline && …}` 那种条件表达式换成分支、也别反过来** —— 这一条是
//    实测出来的，不是风格：条件为假时 JSX 会往 children 里放一个 `false`，React 把它序列化进 RSC
//    载荷（`"children":[…,false,…]`），**产物 DOM 上看不见、`.html` 的字节里看得见**。
//    当年 `values-grid` 的 manifest 没有 `subheadline` 槽位、它的 children 只有两格，所以那一支
//    必须是「那一格根本不存在」；今天卡片组自己有 `sub`，所以留着这个条件表达式是对的
//    （它为假时那个 `false` 本来就在改前的产物里）。改这一行之前先跑 AC7 那个字节对照。
//
// 🔴 条目外面那个标签名从词汇表的 `itemTag` 来，不从 `parts` 推（理由写在 `blockAliases.ts` 头上）。
//    今天只有 `div` 一种 —— `p` / `article` 是 #1143 给两个老名字用的，随本票一起没了。
//
// 🔴 `data` 一个字节都不改。表里那些 `null`（`style` / `variant`）的意思是「继续忽略」——
//    没人读它们（#1027 / #1029 / #1036 的既定状态），而**留在 data 里**是有理由的：
//    `scripts/theme-gallery/verify-applied.mjs` 拿磁盘上的 `data.variant` 跟产物里的对账，删掉它
//    那一格会红在一件没发生的事上。
export default function CardGroupSection({ data, block }: CardGroupSectionProps) {
  const v = vocabularyFor(block);
  const attrs = blockAttrs(v.name, block);
  const Item = v.itemTag;

  return (
    <section {...attrs} className={v.name} aria-labelledby={v.headingId}>
      <h2 id={v.headingId} className={`${v.name}__headline`}>{data.headline}</h2>
      {data.subheadline && <p className={`${v.name}__sub`}>{data.subheadline}</p>}
      {data.items?.map((item, index) => (
        <Item key={index} className={`${v.name}__item`}>
          <h3 className={`${v.name}__title`}>{item.title}</h3>
          <p className={`${v.name}__desc`}>{item.description}</p>
          {item.features && item.features.length > 0 && (
            <ul className={`${v.name}__features`}>
              {item.features.map((feature, fIndex) => (
                <li key={fIndex}>{feature}</li>
              ))}
            </ul>
          )}
        </Item>
      ))}
    </section>
  );
}
