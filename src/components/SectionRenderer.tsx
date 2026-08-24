import type { BlockConfig } from '@/lib/types/config';
import { sectionRegistry } from '@/lib/sections/registry';

interface SectionRendererProps {
  blocks: BlockConfig[];
  locale: string;
}

export default function SectionRenderer({ blocks, locale }: SectionRendererProps) {
  return (
    <>
      {blocks.map((block, index) => {
        // The site's own page JSON marked this block hidden — that is its only source since #993
        // (spec D8 took the theme out of block placement). It is still in `blocks` on purpose
        // (see BlockConfig.hidden): the page keeps its content, and whatever derives structured
        // data from the page's composition keeps seeing it. Only the rendering skips it.
        if (block.hidden) return null;
        const Component = sectionRegistry[block.type];
        if (!Component) {
          console.warn(`Unknown block type: ${block.type}`);
          return null;
        }
        // #998 — `block` reaches every component so its root element can carry the third hook
        // (`data-block-layout`) and the block's own `role`. It is a prop and not a module-level
        // "current block" on purpose: React calls a child component AFTER its parent returns, so a
        // variable set while building this list would be read at the wrong time.
        // 🔴 key 里那个类型名会进 RSC 载荷，所以它是**产物 .html 上看得见的字节**（映射文档 §2.5
        // 坑四实测过：DOM 逐字相同、类名逐字相同、`data-role` 也对，22 个 HTML 仍然红 1 个，唯一
        // 差异就是这个 key）。#1132 那会儿它先读别名记下来的**老** type 名再落回 `type` —— 别名把
        // `type` 换成了通用块的名字，而**没有 `id` 的那些条目**（老站全都没有）key 就是类型名拼的。
        // #1162 别名层退役之后那个字段不存在了，这里读 `type` 就是读那个块自己写的名字。
        return (
          <Component
            key={block.id || `${block.type}-${index}`}
            data={block.data || {}}
            locale={locale}
            block={block}
          />
        );
      })}
    </>
  );
}
