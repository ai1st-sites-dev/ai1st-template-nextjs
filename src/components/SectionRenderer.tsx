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
        // #1132 — key 用 `__legacyType` 那个名字，不用 `type`。别名把 `type` 换成通用块的名字
        // （`scripts/blocks.js` 的 applyAlias），而**没有 `id` 的那些条目**（老站全都没有）key 就是
        // 类型名拼出来的，React 会把它序列化进 RSC 载荷 ⟹ 换了名字，老站重建出来的 .html 就变了。
        // 它是那四道坑里唯一一道「像素比对按构造看不见」的（映射文档 §2.5 坑四：DOM 逐字相同、
        // 类名逐字相同、data-role 也对，22 个 HTML 仍然红 1 个，唯一差异就是这个 key）。
        return (
          <Component
            key={block.id || `${block.__legacyType || block.type}-${index}`}
            data={block.data || {}}
            locale={locale}
            block={block}
          />
        );
      })}
    </>
  );
}
