// #1838 —— 测试用的假块 fake-a（只住 scripts/fixtures/blocks/，见同目录 README）。画 `data.title`，页面上是 `data-fake-title` 那一格。
import BlockSection from '@template/components/BlockSection';
import type { BlockConfig } from '@template/lib/types/config';

export default function FakeASection({ data, block }: { data?: { title?: unknown }; block?: BlockConfig }) {
  const title = data && typeof data.title === 'string' ? data.title : '';
  return (
    <BlockSection type="fake-a" block={block}>
      <h2 data-fake-title="">{title}</h2>
    </BlockSection>
  );
}
