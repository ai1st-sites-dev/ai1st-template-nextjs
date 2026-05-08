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
        const Component = sectionRegistry[section.type];
        if (!Component) {
          console.warn(`Unknown section type: ${section.type}`);
          return null;
        }
        return <Component key={`${section.type}-${index}`} data={section.data} locale={locale} />;
      })}
    </>
  );
}
