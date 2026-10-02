import type { BlockConfig } from '@/lib/types/config';
import type { IconTable } from '@/components/InlineIcon';
import type { ContactSiteFacts } from '../../scripts/lib/contact-facts.js';
import { sectionRegistry } from '@/lib/sections/registry.generated';

interface SectionRendererProps {
  blocks: BlockConfig[];
  locale: string;
  /**
   * #1475 —— 与 `blocks` 逐项对齐的图标表（`scripts/lib/icons.js` §iconTablesFor 算的）。画内联 SVG 图标的块
   * （`BLOCK_ICONS` 里登记过的）拿到它那一张；别的块那一格是 undefined，**不挂** `iconTable` 这个 prop。
   * 🔴 这里自己不算：这个组件也在编辑器的客户端画布里用（EditorApp），读不了文件 —— 由服务端的调用方算好传进来。
   */
  iconTables?: (IconTable | undefined)[];
  /**
   * #1489 —— 用这一份站点数据（电话 / 邮箱 / 地址 / 营业时间 / 坐标）代替站自己的。**只有单格页传**：admin 预览用演示生意
   * 的那一份（带坐标，地图才画得出来），地址栏还能删掉坐标 / 营业时间看空的样子。真站的调用点都不传 ⟹ 块读 `@/lib/config`。
   * 挂到每个块上，今天只有 contact 读它（`scripts/lib/contact-facts.js` §siteFactsFrom 的形状）。
   */
  siteFacts?: ContactSiteFacts;
  /**
   * #1502 —— 这一页的 slug（`about` / `services/x` …）。要按页面路径算东西的块（`page-header` 的面包屑，
   * `src/lib/breadcrumbs.ts`）拿它；别的块不读。内页由 `SubPage` 传真 slug，编辑器画布传正在编辑的那一页，
   * 单格页传夹具页；首页不传。没给就**不挂**这个 prop（同 `iconTable`）。
   */
  pageSlug?: string;
}

export default function SectionRenderer({ blocks, locale, iconTables, siteFacts, pageSlug }: SectionRendererProps) {
  return (
    <>
      {blocks.map((block, index) => {
        const Component = sectionRegistry[block.type];
        if (!Component) {
          console.warn(`Unknown block type: ${block.type}`);
          return null;
        }
        // #998 — `block` reaches every component so its root element can carry the block's own
        // `role` (and, since #1318 / #1331, `data-shape` and `data-has-*`). #998's third hook
        // `data-block-layout` was the original reason and #1341 retired it; the rest still need it.
        // It is a prop and not a module-level
        // "current block" on purpose: React calls a child component AFTER its parent returns, so a
        // variable set while building this list would be read at the wrong time.
        // 🔴 key 里那个类型名会进 RSC 载荷，所以它是**产物 .html 上看得见的字节**（映射文档 §2.5
        // 坑四实测过：DOM 逐字相同、类名逐字相同、`data-role` 也对，22 个 HTML 仍然红 1 个，唯一
        // 差异就是这个 key）。#1132 那会儿它先读别名记下来的**老** type 名再落回 `type` —— 别名把
        // `type` 换成了通用块的名字，而**没有 `id` 的那些条目**（老站全都没有）key 就是类型名拼的。
        // #1162 别名层退役之后那个字段不存在了，这里读 `type` 就是读那个块自己写的名字。
        const iconTable = iconTables ? iconTables[index] : undefined;
        return (
          <Component
            key={block.id || `${block.type}-${index}`}
            data={block.data || {}}
            locale={locale}
            block={block}
            {...(iconTable ? { iconTable } : {})}
            {...(siteFacts ? { siteFacts } : {})}
            {...(pageSlug ? { pageSlug } : {})}
          />
        );
      })}
    </>
  );
}
