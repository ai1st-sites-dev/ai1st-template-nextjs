import type { SectionConfig } from '@/lib/types/config';
import { sectionRegistry } from '@/lib/sections/registry';

interface SectionRendererProps {
  sections: SectionConfig[];
  locale: string;
}

export default function SectionRenderer({ sections, locale }: SectionRendererProps) {
  return (
    <>
      {sections.map((section, index) => {
        // #962 — the applied theme's rhythm hid this block. It is still in `sections` on purpose
        // (see SectionConfig.hidden): the page keeps its content, and whatever derives structured
        // data from the page's composition keeps seeing it. Only the rendering skips it.
        if (section.hidden) return null;
        const Component = sectionRegistry[section.type];
        if (!Component) {
          console.warn(`Unknown section type: ${section.type}`);
          return null;
        }
        return <Component key={`${section.type}-${index}`} data={section.data || {}} locale={locale} />;
      })}
    </>
  );
}
