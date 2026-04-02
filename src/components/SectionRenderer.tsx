import type { SectionConfig } from '@/lib/types/config';
import { sectionRegistry } from '@/lib/sections/registry';

interface SectionRendererProps {
  sections: SectionConfig[];
}

export default function SectionRenderer({ sections }: SectionRendererProps) {
  return (
    <>
      {sections.map((section, index) => {
        const Component = sectionRegistry[section.type];
        if (!Component) {
          console.warn(`Unknown section type: ${section.type}`);
          return null;
        }
        return <Component key={`${section.type}-${index}`} data={section.data} />;
      })}
    </>
  );
}
