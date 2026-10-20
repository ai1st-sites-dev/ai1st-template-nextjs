// #1918 —— 假块 fake-a 的 v1（只给 preservesLook 尺子的「前」那一侧用，见同目录 README）：画 `data.headline`。
// 跟 `../../blocks/fake-a`（v2，画 `data.title`）画出来的标记一模一样 —— `1→2` 那条迁移只改了字段名。
import BlockSection from '@template/components/BlockSection';
import type { BlockConfig } from '@template/lib/types/config';

export default function FakeASection({ data, block }: { data?: { headline?: unknown }; block?: BlockConfig }) {
  const headline = data && typeof data.headline === 'string' ? data.headline : '';
  return (
    <BlockSection type="fake-a" block={block}>
      <h2 data-fake-title="">{headline}</h2>
    </BlockSection>
  );
}
