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
